/**
 * File-level orchestration for the export centre.
 *
 * The snapshot and every model are built by `utils/budgetExport.js`; this
 * module joins them to storage and the device. It re-reads the budget before
 * writing anything and refuses to export when the fingerprint changed while
 * the preview was open — a stale preview cannot become a file.
 */

import Constants from 'expo-constants';

import { storage } from '../storage/adapters/adapter';
import { readBudgetExportSource } from '../storage/repositories/budgetTransferRepository';
import {
  buildBudgetSnapshot,
  buildCsvModel,
  buildExportFileName,
  buildInvoiceModel,
  buildReportModel,
  buildWorkbookModel,
  exportFormat,
} from '../utils/budgetExport';
import {
  mimeTypeForReceiptPath,
  serializeBudgetTransfer,
  stringifyBudgetTransfer,
} from '../utils/budgetTransfer';
import { todayIso } from '../utils/dates';
import { buildPdfBytes } from '../utils/pdf';
import { buildXlsxBytes } from '../utils/xlsx';
import { saveContentToUserFile, shareContent } from './fileService';
import { readReceiptBase64 } from './receiptFiles';

function appVersion() {
  return Constants.expoConfig?.version ?? null;
}

function missingBudgetError() {
  return new Error('That budget could not be found. It may have been archived or deleted.');
}

export async function loadBudgetExportSnapshot(budgetId) {
  const source = await readBudgetExportSource(storage, budgetId);
  if (!source) throw missingBudgetError();
  const currency = (await storage.getSetting('currency', null)) ?? 'PHP';
  return buildBudgetSnapshot(source, { currency, folderName: source.folderName });
}

export async function refreshBudgetExportSnapshot(budgetId) {
  return loadBudgetExportSnapshot(budgetId);
}

function staleError(current) {
  const error = new Error(
    'This budget changed while you were reviewing it. The preview was refreshed — check it again before exporting.',
  );
  error.code = 'STALE_EXPORT';
  error.snapshot = current;
  return error;
}

async function buildTransferJson(budgetId, currency) {
  const source = await readBudgetExportSource(storage, budgetId);
  if (!source) throw missingBudgetError();

  const descriptionById = new Map(
    source.transactions.map((row) => [row.id, row.description?.trim() || 'a transaction']),
  );
  const warnings = [];
  const attachments = [];

  for (const row of source.attachments) {
    const mimeType = mimeTypeForReceiptPath(row.path);
    if (!mimeType) {
      warnings.push('A receipt image has an unknown file type and was left out.');
      continue;
    }
    const data = await readReceiptBase64(row.path);
    if (!data) {
      warnings.push(
        `The receipt for "${descriptionById.get(row.transaction_id) ?? 'a transaction'}" could not be read and was left out.`,
      );
      continue;
    }
    attachments.push({
      id: row.id,
      transaction_id: row.transaction_id,
      mime_type: mimeType,
      data,
    });
  }

  const envelope = serializeBudgetTransfer(
    { ...source, attachments },
    { currency, appVersion: appVersion() },
  );
  return { content: stringifyBudgetTransfer(envelope), warnings, attachments: attachments.length };
}

/**
 * Build and save/share one export. `destination` is `'save'` (folder picker)
 * or `'share'` (platform share sheet). Returns `saved: false` when the user
 * cancels the folder picker; that is not an error and writes nothing.
 */
export async function exportBudgetDocument(
  snapshot,
  formatId,
  config = null,
  { destination = 'save' } = {},
) {
  const format = exportFormat(formatId);
  if (!format) throw new Error('That export format is not available.');

  const current = await loadBudgetExportSnapshot(snapshot.budget.id);
  if (current.fingerprint !== snapshot.fingerprint) throw staleError(current);

  let content;
  let fileName;
  let warnings = [];
  let counts;

  if (formatId === 'json') {
    const json = await buildTransferJson(snapshot.budget.id, snapshot.currency);
    content = json.content;
    warnings = json.warnings;
    fileName = buildExportFileName(current, formatId, todayIso());
    counts = {
      transactions: current.counts.transactions,
      breakdownItems: current.counts.breakdownItems,
      tags: current.counts.tags,
      reminders: current.counts.reminders,
      attachments: json.attachments,
    };
  } else if (formatId === 'csv') {
    const model = buildCsvModel(current);
    content = model.text;
    fileName = buildExportFileName(current, formatId, todayIso());
    counts = { rows: model.count, sheets: 1 };
  } else if (formatId === 'xlsx') {
    const model = buildWorkbookModel(current);
    content = buildXlsxBytes(model);
    fileName = buildExportFileName(current, formatId, todayIso());
    counts = {
      sheets: model.sheets.length,
      rows: model.sheets.reduce((sum, sheet) => sum + sheet.count, 0),
    };
  } else if (formatId === 'invoice') {
    const model = buildInvoiceModel(current, config);
    if (!model.validation.ok) {
      throw new Error(model.validation.issues.slice(0, 6).join('\n'));
    }
    content = buildPdfBytes(model.pages, {
      title: model.meta.title,
      subject: model.meta.subject,
    });
    fileName = buildExportFileName(current, formatId, todayIso(), config);
    counts = { pages: model.pages.length, lines: model.validation.totals.lineCount };
  } else if (formatId === 'report') {
    const model = buildReportModel(current, config);
    if (!model.validation.ok) {
      throw new Error(model.validation.issues.slice(0, 6).join('\n'));
    }
    content = buildPdfBytes(model.pages, {
      title: model.meta.title,
      subject: model.meta.subject,
    });
    fileName = buildExportFileName(current, formatId, todayIso(), config);
    counts = { pages: model.pages.length, transactions: model.filtered.length };
  } else {
    throw new Error('That export format is not available.');
  }

  const saved =
    destination === 'share'
      ? await shareContent(content, fileName, {
          mimeType: format.mimeType,
          uti: format.uti,
          dialogTitle: `Share ${format.label.toLowerCase()}`,
        })
      : await saveContentToUserFile(content, fileName, format.mimeType);

  return {
    fileName: saved?.name ?? fileName,
    saved: saved != null,
    warnings,
    counts,
  };
}
