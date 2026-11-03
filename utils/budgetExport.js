/**
 * Export preparation for one budget: the shared snapshot every format reads,
 * plus the CSV, workbook, invoice and report models built from it.
 *
 * The module is pure. It takes the rows `readBudgetExportSource` already read,
 * never touches storage, and never changes a stored record. Preview and final
 * export both call these builders with the same snapshot and configuration, so
 * the page the user reviews and the file they save cannot disagree.
 */

import { computeSpendByTag, computeTotals } from './calculations';
import { getCurrency, toMinor } from './currency';
import { effectivePaymentStatus } from './paymentStatus';
import { addDaysIso, formatDate, isWithin, todayIso } from './dates';
import { measureText, wrapText } from './pdf';

export const EXPORT_FORMATS = [
  {
    id: 'json',
    label: 'Budgetarian Backup',
    extension: 'json',
    mimeType: 'application/json',
    uti: 'public.json',
    kind: 'backup',
    description: 'A restorable copy of this budget',
    detail:
      'Keeps the budget, its transactions, breakdown items, tags, reminders and receipts. Import it on this or another device.',
    destination: 'preview',
  },
  {
    id: 'xlsx',
    label: 'Excel Workbook',
    extension: 'xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    uti: 'org.openxmlformats.spreadsheetml.sheet',
    kind: 'spreadsheet',
    description: 'Summary, transactions and breakdowns in one workbook',
    detail:
      'Five worksheets with numeric amounts, frozen headers and clear column names. Built for sorting, formulas and charts.',
    destination: 'preview',
  },
  {
    id: 'csv',
    label: 'CSV',
    extension: 'csv',
    mimeType: 'text/csv',
    uti: 'public.comma-separated-values-text',
    kind: 'spreadsheet',
    description: 'One plain table of this budget’s transactions',
    detail:
      'Compatible with Excel, Numbers and Google Sheets. Dates stay ISO, amounts stay numeric and text is escaped.',
    destination: 'preview',
  },
  {
    id: 'invoice',
    label: 'Invoice',
    extension: 'pdf',
    mimeType: 'application/pdf',
    uti: 'com.adobe.pdf',
    kind: 'document',
    description: 'A printable request for payment',
    detail:
      'Choose the billable lines, client and terms. Nothing is added to the budget and no payment status changes.',
    destination: 'configure',
  },
  {
    id: 'report',
    label: 'Financial Report',
    extension: 'pdf',
    mimeType: 'application/pdf',
    uti: 'com.adobe.pdf',
    kind: 'document',
    description: 'A readable summary of the budget’s activity',
    detail:
      'Income, expenses, remaining balance and a dated transaction table. Totals follow the same rules as the app.',
    destination: 'configure',
  },
];

export const DOCUMENT_PAGE_WIDTH = 595.28;
export const DOCUMENT_PAGE_HEIGHT = 841.89;
export const DOCUMENT_MARGIN = 48;
export const DOCUMENT_CONTENT_WIDTH = DOCUMENT_PAGE_WIDTH - DOCUMENT_MARGIN * 2;

const DOCUMENT_BOTTOM = DOCUMENT_PAGE_HEIGHT - DOCUMENT_MARGIN - 34;
const INK = '#1C2A24';
const MUTED = '#5E6B64';
const ACCENT = '#1F4D3A';
const RULE = '#D8E0DB';
const WASH = '#F1F5F2';

export function exportFormat(formatId) {
  return EXPORT_FORMATS.find((format) => format.id === formatId) ?? null;
}

export function isDocumentFormat(formatId) {
  return formatId === 'invoice' || formatId === 'report';
}

function plainText(value) {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

function sortedRows(rows, key) {
  return [...rows].sort((a, b) => {
    const left = key(a);
    const right = key(b);
    return left < right ? -1 : left > right ? 1 : 0;
  });
}

function reference(index, prefix) {
  return `${prefix}-${String(index + 1).padStart(4, '0')}`;
}

/** FNV-1a over the export-relevant rows; cheap, stable and dependency free. */
export function fingerprintValue(value) {
  const text = JSON.stringify(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function sourceFingerprint(source, currency) {
  const transactions = sortedRows(source.transactions ?? [], (row) => `${row.transaction_date}|${row.created_at ?? ''}|${row.id}`);
  const items = sortedRows(source.breakdownItems ?? [], (row) => `${row.transaction_id}|${row.position ?? 0}|${row.id}`);
  const tags = sortedRows(source.tags ?? [], (row) => row.id);
  const reminders = sortedRows(source.reminders ?? [], (row) => `${row.remind_date}|${row.remind_time}|${row.id}`);
  const attachments = sortedRows(source.attachments ?? [], (row) => row.path ?? row.id);

  return fingerprintValue({
    budget: {
      name: source.budget.name,
      start_date: source.budget.start_date,
      end_date: source.budget.end_date,
      color: source.budget.color ?? null,
      folder_id: source.budget.folder_id ?? null,
    },
    currency,
    transactions: transactions.map((row) => ({
      id: row.id,
      type: row.type,
      amount: row.amount,
      tag_id: row.tag_id ?? null,
      description: row.description ?? '',
      transaction_date: row.transaction_date,
      payment_status: row.payment_status ?? null,
      payment_due_date: row.payment_due_date ?? null,
      has_breakdown: row.has_breakdown ?? 0,
      updated_at: row.updated_at ?? null,
    })),
    items: items.map((row) => ({
      id: row.id,
      transaction_id: row.transaction_id,
      description: row.description,
      amount: row.amount,
      position: row.position ?? 0,
      updated_at: row.updated_at ?? null,
    })),
    tags: tags.map((row) => ({
      id: row.id,
      name: row.name,
      emoji: row.emoji ?? null,
      color: row.color ?? null,
      archived: row.archived ?? 0,
    })),
    reminders: reminders.map((row) => ({
      id: row.id,
      transaction_id: row.transaction_id,
      enabled: row.enabled ?? 0,
      status: row.status ?? null,
      remind_date: row.remind_date,
      remind_time: row.remind_time,
      updated_at: row.updated_at ?? null,
    })),
    attachments: attachments.map((row) => ({
      id: row.id,
      transaction_id: row.transaction_id,
      path: row.path ?? null,
    })),
  });
}

/**
 * A normalised, read-only view of one budget. Every export format consumes this
 * object, so formatting differences can never become calculation differences.
 */
export function buildBudgetSnapshot(source, options = {}) {
  if (!source?.budget) throw new Error('There is no budget to export.');

  const currency = options.currency ?? 'PHP';
  const currencyMeta = getCurrency(currency);
  const tags = sortedRows(source.tags ?? [], (row) => `${row.name}|${row.id}`);
  const tagsById = new Map(tags.map((tag) => [tag.id, tag]));
  const itemsByTransaction = new Map();
  for (const item of source.breakdownItems ?? []) {
    const group = itemsByTransaction.get(item.transaction_id) ?? [];
    group.push(item);
    itemsByTransaction.set(item.transaction_id, group);
  }

  const transactions = sortedRows(
    source.transactions ?? [],
    (row) => `${row.transaction_date}|${row.created_at ?? ''}|${row.id}`,
  ).map((row, index) => ({
    ...row,
    reference: reference(index, 'TXN'),
    tag: row.tag_id ? tagsById.get(row.tag_id) ?? null : null,
    breakdownItems: [...(itemsByTransaction.get(row.id) ?? [])].sort(
      (a, b) => (a.position ?? 0) - (b.position ?? 0) || String(a.id).localeCompare(String(b.id)),
    ),
    paymentStatus: effectivePaymentStatus(row),
  }));

  const breakdownItems = sortedRows(
    source.breakdownItems ?? [],
    (row) => `${row.transaction_id}|${String(row.position ?? 0).padStart(4, '0')}|${row.id}`,
  ).map((row, index) => ({ ...row, reference: reference(index, 'ITM') }));

  const reminders = sortedRows(
    source.reminders ?? [],
    (row) => `${row.remind_date}|${row.remind_time}|${row.id}`,
  ).map((row, index) => ({ ...row, reference: reference(index, 'REM') }));

  const attachments = sortedRows(source.attachments ?? [], (row) => `${row.transaction_id}|${row.id}`);
  const totals = computeTotals(transactions);
  // `totals.expense` is settled spend and `totals.expectedExpense` is the
  // outstanding obligation, so the payment split comes straight from the one
  // calculation rather than re-reading statuses here.
  const paidExpense = totals.expense;
  const unpaidExpense = totals.expectedExpense;
  const spendByTag = computeSpendByTag(transactions, tags)
    .filter((entry) => entry.spent > 0)
    .sort((a, b) => b.spent - a.spent || String(a.tag.name).localeCompare(String(b.tag.name)));

  return {
    budget: { ...source.budget },
    folderName: options.folderName ?? source.folderName ?? null,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    currency,
    currencyMeta: {
      code: currencyMeta.code,
      symbol: currencyMeta.symbol,
      minorUnits: currencyMeta.minorUnits,
    },
    transactions,
    breakdownItems,
    tags,
    reminders,
    attachments: attachments.map((row) => ({
      id: row.id,
      transaction_id: row.transaction_id,
      path: row.path ?? null,
    })),
    totals,
    payment: {
      paidExpense,
      unpaidExpense,
      paidIncome: totals.income,
      unpaidIncome: totals.expectedIncome,
    },
    spendByTag,
    counts: {
      transactions: transactions.length,
      breakdownItems: breakdownItems.length,
      tags: tags.length,
      reminders: reminders.length,
      activeReminders: reminders.filter((row) => row.enabled && row.status === 'active').length,
      attachments: attachments.length,
    },
    fingerprint: sourceFingerprint(source, currency),
  };
}

/** Minor units as a plain machine-readable decimal, no symbol or grouping. */
export function plainAmount(minorUnits, currency = 'PHP') {
  const meta = getCurrency(currency);
  const safe = Number.isFinite(minorUnits) ? Math.trunc(minorUnits) : 0;
  const negative = safe < 0 ? '-' : '';
  const absolute = Math.abs(safe);
  const divisor = 10 ** meta.minorUnits;
  if (meta.minorUnits <= 0) return `${negative}${Math.floor(absolute / divisor)}`;
  const whole = Math.floor(absolute / divisor);
  const fraction = String(absolute % divisor).padStart(meta.minorUnits, '0');
  return `${negative}${whole}.${fraction}`;
}

/** Printable amount with grouping and the ISO code, safe for WinAnsi PDF text. */
export function documentAmount(minorUnits, currency = 'PHP') {
  const meta = getCurrency(currency);
  const safe = Number.isFinite(minorUnits) ? Math.trunc(minorUnits) : 0;
  const negative = safe < 0 ? '-' : '';
  const absolute = Math.abs(safe);
  const divisor = 10 ** meta.minorUnits;
  const whole = String(Math.floor(absolute / divisor)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fraction =
    meta.minorUnits > 0 ? `.${String(absolute % divisor).padStart(meta.minorUnits, '0')}` : '';
  return `${negative}${meta.code} ${whole}${fraction}`;
}

/** Spreadsheet text is user-controlled: never let it start a formula. */
export function guardSpreadsheetText(value) {
  const text = plainText(value);
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function buildCsvModel(snapshot) {
  const columns = [
    { key: 'date', label: 'Date' },
    { key: 'description', label: 'Description' },
    { key: 'type', label: 'Type' },
    { key: 'tag', label: 'Category' },
    { key: 'payment', label: 'Payment status' },
    { key: 'amount', label: 'Amount' },
    { key: 'currency', label: 'Currency' },
    { key: 'breakdown', label: 'Breakdown items' },
    { key: 'reference', label: 'Reference' },
  ];

  const rows = snapshot.transactions.map((row) => [
    row.transaction_date,
    guardSpreadsheetText(row.description),
    row.type === 'income' ? 'Income' : 'Expense',
    guardSpreadsheetText(row.tag?.name ?? ''),
    row.paymentStatus === 'unpaid' ? 'Unpaid' : 'Paid',
    plainAmount(row.amount, snapshot.currency),
    snapshot.currencyMeta.code,
    row.breakdownItems.length,
    row.reference,
  ]);

  const lines = [columns.map((column) => csvCell(column.label)).join(',')];
  for (const row of rows) lines.push(row.map(csvCell).join(','));
  const body = lines.join('\r\n');

  return {
    columns,
    rows,
    count: rows.length,
    text: `\uFEFF${body}\r\n`,
    scope: 'Transactions for this budget',
    excluded: 'Receipts, reminder notes and workbook-only sheets are not part of a CSV.',
  };
}

function cell(value, kind = 'text') {
  return { value, kind };
}

export function buildWorkbookModel(snapshot) {
  const summaryRows = [
    [cell('Budget', 'label'), cell(snapshot.budget.name)],
    [cell('Period', 'label'), cell(`${snapshot.budget.start_date} to ${snapshot.budget.end_date}`)],
    [cell('Folder', 'label'), cell(snapshot.folderName ?? 'No folder')],
    [cell('Currency', 'label'), cell(snapshot.currencyMeta.code)],
    [cell('Received income', 'label'), cell(Number(plainAmount(snapshot.totals.income, snapshot.currency)), 'money')],
    [cell('Paid expenses', 'label'), cell(Number(plainAmount(snapshot.totals.expense, snapshot.currency)), 'money')],
    [cell('Remaining', 'label'), cell(Number(plainAmount(snapshot.totals.remaining, snapshot.currency)), 'money')],
    [cell('Expected income', 'label'), cell(Number(plainAmount(snapshot.totals.expectedIncome, snapshot.currency)), 'money')],
    [cell('Unpaid expenses', 'label'), cell(Number(plainAmount(snapshot.payment.unpaidExpense, snapshot.currency)), 'money')],
    [cell('Transactions', 'label'), cell(snapshot.counts.transactions)],
    [cell('Breakdown items', 'label'), cell(snapshot.counts.breakdownItems)],
    [cell('Tags', 'label'), cell(snapshot.counts.tags)],
    [cell('Reminders', 'label'), cell(snapshot.counts.reminders)],
    [cell('Generated', 'label'), cell(snapshot.generatedAt)],
  ];

  const transactionRows = snapshot.transactions.map((row) => [
    cell(row.reference),
    cell(row.transaction_date),
    cell(row.description),
    cell(row.type === 'income' ? 'Income' : 'Expense'),
    cell(row.tag?.name ?? ''),
    cell(row.paymentStatus === 'unpaid' ? 'Unpaid' : 'Paid'),
    cell(row.payment_due_date ?? ''),
    cell(Number(plainAmount(row.amount, snapshot.currency)), 'money'),
    cell(snapshot.currencyMeta.code),
    cell(row.breakdownItems.length),
  ]);

  const itemRows = snapshot.breakdownItems.map((row) => {
    const parent = snapshot.transactions.find((transaction) => transaction.id === row.transaction_id);
    return [
      cell(row.reference),
      cell(parent?.reference ?? ''),
      cell(row.purchase_date ?? parent?.transaction_date ?? ''),
      cell(row.description),
      cell(Number(plainAmount(row.amount, snapshot.currency)), 'money'),
      cell(snapshot.currencyMeta.code),
      cell(row.notes ?? ''),
    ];
  });

  const tagRows = snapshot.tags.map((tag) => {
    const used = snapshot.transactions.filter((row) => row.tag_id === tag.id);
    const spent = used
      .filter((row) => row.type === 'expense')
      .reduce((sum, row) => sum + row.amount, 0);
    return [
      cell(tag.name),
      cell(tag.emoji ?? ''),
      cell(tag.color ?? ''),
      cell(tag.archived ? 'Archived' : 'Active'),
      cell(used.length),
      cell(Number(plainAmount(spent, snapshot.currency)), 'money'),
      cell(snapshot.currencyMeta.code),
    ];
  });

  const reminderRows = snapshot.reminders.map((row) => {
    const parent = snapshot.transactions.find((transaction) => transaction.id === row.transaction_id);
    return [
      cell(row.reference),
      cell(parent?.reference ?? ''),
      cell(row.remind_date),
      cell(row.remind_time),
      cell(row.enabled ? 'On' : 'Off'),
      cell(row.status ?? 'active'),
      cell(row.notes ?? ''),
    ];
  });

  return {
    sheets: [
      {
        name: 'Budget Summary',
        columns: [
          { label: 'Metric', width: 24 },
          { label: 'Value', width: 38 },
        ],
        rows: summaryRows,
        count: summaryRows.length,
      },
      {
        name: 'Transactions',
        columns: [
          { label: 'Reference', width: 12 },
          { label: 'Date', width: 12 },
          { label: 'Description', width: 34 },
          { label: 'Type', width: 10 },
          { label: 'Category', width: 18 },
          { label: 'Payment status', width: 14 },
          { label: 'Due date', width: 12 },
          { label: 'Amount', width: 14 },
          { label: 'Currency', width: 10 },
          { label: 'Breakdown items', width: 16 },
        ],
        rows: transactionRows,
        count: transactionRows.length,
      },
      {
        name: 'Breakdown Items',
        columns: [
          { label: 'Reference', width: 12 },
          { label: 'Transaction', width: 12 },
          { label: 'Date', width: 12 },
          { label: 'Description', width: 34 },
          { label: 'Amount', width: 14 },
          { label: 'Currency', width: 10 },
          { label: 'Notes', width: 30 },
        ],
        rows: itemRows,
        count: itemRows.length,
      },
      {
        name: 'Tags',
        columns: [
          { label: 'Name', width: 22 },
          { label: 'Emoji', width: 8 },
          { label: 'Colour', width: 12 },
          { label: 'Status', width: 10 },
          { label: 'Transactions', width: 12 },
          { label: 'Expense total', width: 14 },
          { label: 'Currency', width: 10 },
        ],
        rows: tagRows,
        count: tagRows.length,
      },
      {
        name: 'Reminders',
        columns: [
          { label: 'Reference', width: 12 },
          { label: 'Transaction', width: 12 },
          { label: 'Date', width: 12 },
          { label: 'Time', width: 8 },
          { label: 'Enabled', width: 8 },
          { label: 'Status', width: 10 },
          { label: 'Notes', width: 34 },
        ],
        rows: reminderRows,
        count: reminderRows.length,
      },
    ],
    limitations:
      'Receipt image bytes are not embedded in the workbook. Worksheet dates are ISO (YYYY-MM-DD); amounts are numeric in major units.',
  };
}

// ---------------------------------------------------------------------------
// Invoice
// ---------------------------------------------------------------------------

/**
 * Billable lines come from expenses only. A breakdown supplies the lines when
 * one exists, otherwise the transaction itself is the line. Income is never an
 * invoice line and no export writes to the budget.
 */
export function buildInvoiceLineSources(snapshot) {
  const sources = [];
  for (const transaction of snapshot.transactions) {
    if (transaction.type !== 'expense') continue;
    if (transaction.breakdownItems.length > 0) {
      for (const item of transaction.breakdownItems) {
        sources.push({
          id: `item:${item.id}`,
          transactionId: transaction.id,
          reference: item.reference ?? transaction.reference,
          date: item.purchase_date ?? transaction.transaction_date,
          description: item.description ?? 'Item',
          amount: item.amount,
        });
      }
    } else {
      sources.push({
        id: `tx:${transaction.id}`,
        transactionId: transaction.id,
        reference: transaction.reference,
        date: transaction.transaction_date,
        description: transaction.description || 'Expense',
        amount: transaction.amount,
      });
    }
  }
  return sources.sort((a, b) => a.date.localeCompare(b.date) || a.reference.localeCompare(b.reference));
}

export function defaultInvoiceNumber(date = todayIso()) {
  return `INV-${String(date).replace(/-/g, '')}-001`;
}

export function createInvoiceConfig(snapshot) {
  return {
    number: defaultInvoiceNumber(),
    issueDate: todayIso(),
    dueDate: addDaysIso(todayIso(), 14),
    clientName: '',
    clientContact: '',
    clientAddress: '',
    title: `Invoice for ${snapshot.budget.name}`,
    notes: '',
    terms: 'Payment due by the date shown above.',
    taxRate: '0',
    discount: '0.00',
    lineItems: buildInvoiceLineSources(snapshot).map((source) => ({
      id: source.id,
      reference: source.reference,
      date: source.date,
      description: source.description,
      quantity: '1',
      unitPrice: plainAmount(source.amount, snapshot.currency),
      selected: false,
    })),
  };
}

/** Keep user edits when the snapshot underneath is refreshed. */
export function reconcileInvoiceConfig(config, snapshot) {
  const sources = buildInvoiceLineSources(snapshot);
  const existing = new Map((config?.lineItems ?? []).map((line) => [line.id, line]));
  return {
    ...(config ?? createInvoiceConfig(snapshot)),
    lineItems: sources.map((source) => {
      const line = existing.get(source.id);
      return line
        ? { ...line, reference: source.reference, date: source.date }
        : {
            id: source.id,
            reference: source.reference,
            date: source.date,
            description: source.description,
            quantity: '1',
            unitPrice: plainAmount(source.amount, snapshot.currency),
            selected: false,
          };
    }),
  };
}

export function computeInvoiceTotals(config, currency = 'PHP') {
  const lines = (config?.lineItems ?? []).filter((line) => line.selected);
  let subtotal = 0;
  for (const line of lines) {
    const quantity = Number.parseFloat(String(line.quantity ?? '').replace(',', '.'));
    const safeQuantity = Number.isFinite(quantity) && quantity > 0 ? quantity : 0;
    subtotal += Math.round(toMinor(line.unitPrice, currency) * safeQuantity);
  }
  const discountRaw = toMinor(config?.discount, currency);
  const discount = Math.min(Math.max(discountRaw, 0), subtotal);
  const rate = Number.parseFloat(String(config?.taxRate ?? '').replace(',', '.'));
  const safeRate = Number.isFinite(rate) ? Math.min(Math.max(rate, 0), 100) : 0;
  const taxable = subtotal - discount;
  const tax = Math.round((taxable * safeRate) / 100);
  return {
    lineCount: lines.length,
    subtotal,
    discount,
    taxRate: safeRate,
    tax,
    total: taxable + tax,
  };
}

export function validateInvoiceConfig(config, snapshot) {
  const issues = [];
  if (!plainText(config?.number).trim()) issues.push('Enter an invoice number.');
  if (!plainText(config?.clientName).trim()) issues.push('Enter the client or bill-to name.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(plainText(config?.issueDate))) issues.push('Choose a valid issue date.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(plainText(config?.dueDate))) issues.push('Choose a valid due date.');
  if (
    /^\d{4}-\d{2}-\d{2}$/.test(plainText(config?.issueDate)) &&
    /^\d{4}-\d{2}-\d{2}$/.test(plainText(config?.dueDate)) &&
    config.dueDate < config.issueDate
  ) {
    issues.push('The due date cannot be before the issue date.');
  }

  const selected = (config?.lineItems ?? []).filter((line) => line.selected);
  if (selected.length === 0) issues.push('Select at least one billable line.');
  for (const line of selected) {
    if (!plainText(line.description).trim()) issues.push('Every selected line needs a description.');
    const quantity = Number.parseFloat(String(line.quantity ?? '').replace(',', '.'));
    if (!Number.isFinite(quantity) || quantity <= 0) issues.push(`"${line.description || 'A line'}" needs a quantity above zero.`);
    const price = toMinor(line.unitPrice, snapshot.currency);
    if (price < 0) issues.push(`"${line.description || 'A line'}" cannot have a negative price.`);
  }

  const totals = computeInvoiceTotals(config, snapshot.currency);
  if (totals.lineCount === 0) issues.push('The invoice total is empty.');
  if (totals.total < 0) issues.push('The invoice total cannot be negative.');

  return {
    ok: issues.length === 0,
    issues,
    totals,
    warnings: [
      !plainText(config?.notes).trim() ? 'No notes will appear on the invoice.' : null,
      !plainText(config?.terms).trim() ? 'No payment terms will appear on the invoice.' : null,
      !plainText(config?.clientAddress).trim() ? 'No client address will appear on the invoice.' : null,
    ].filter(Boolean),
  };
}

// ---------------------------------------------------------------------------
// PDF layout (top-left coordinates; the PDF writer flips them once)
// ---------------------------------------------------------------------------

function textItem(text, x, top, options = {}) {
  return {
    type: 'text',
    text: plainText(text),
    x,
    top,
    size: options.size ?? 10,
    bold: options.bold ?? false,
    color: options.color ?? INK,
    align: options.align ?? 'left',
    width: options.width ?? DOCUMENT_CONTENT_WIDTH,
  };
}

function rectItem(x, top, width, height, color) {
  return { type: 'rect', x, top, width, height, color };
}

function lineItem(x1, top1, x2, top2, color = RULE, lineWidth = 0.7) {
  return { type: 'line', x1, top1, x2, top2, color, width: lineWidth };
}

function block(items, text, x, top, width, options = {}) {
  const size = options.size ?? 10;
  const lineHeight = options.lineHeight ?? size * 1.35;
  const lines = wrapText(plainText(text), size, options.bold ?? false, width);
  lines.forEach((line, index) => {
    items.push(
      textItem(line, x, top + index * lineHeight, {
        ...options,
        size,
        width,
      }),
    );
  });
  return top + lines.length * lineHeight;
}

function pageBase(pageNumber) {
  return { number: pageNumber, items: [], footer: null };
}

export function buildInvoiceModel(snapshot, config) {
  const validation = validateInvoiceConfig(config, snapshot);
  const currency = snapshot.currency;
  const totals = validation.totals;
  const selected = (config?.lineItems ?? []).filter((line) => line.selected);
  const pages = [];
  let page = pageBase(1);
  let top = DOCUMENT_MARGIN;

  const startPage = (continued) => {
    page = pageBase(pages.length + 1);
    pages.push(page);
    top = DOCUMENT_MARGIN;
    page.items.push(textItem('BUDGETARIAN', DOCUMENT_MARGIN, top, { size: 12, bold: true, color: ACCENT }));
    page.items.push(
      textItem(continued ? `Invoice ${plainText(config.number)} · continued` : 'INVOICE', DOCUMENT_MARGIN, top, {
        size: continued ? 10 : 22,
        bold: true,
        align: 'right',
        width: DOCUMENT_CONTENT_WIDTH,
        color: continued ? MUTED : INK,
      }),
    );
    top += continued ? 24 : 32;
    page.items.push(lineItem(DOCUMENT_MARGIN, top, DOCUMENT_PAGE_WIDTH - DOCUMENT_MARGIN, top));
    top += 18;
  };

  startPage(false);

  // Parties and invoice facts.
  const partyTop = top;
  page.items.push(textItem('BILL TO', DOCUMENT_MARGIN, top, { size: 8, bold: true, color: MUTED }));
  let leftTop = top + 16;
  leftTop = block(page.items, plainText(config.clientName), DOCUMENT_MARGIN, leftTop, 240, {
    size: 11,
    bold: true,
  });
  if (plainText(config.clientAddress).trim()) {
    leftTop = block(page.items, config.clientAddress, DOCUMENT_MARGIN, leftTop + 2, 240, {
      size: 9,
      color: MUTED,
    });
  }
  if (plainText(config.clientContact).trim()) {
    leftTop = block(page.items, config.clientContact, DOCUMENT_MARGIN, leftTop + 2, 240, {
      size: 9,
      color: MUTED,
    });
  }

  const metaX = 360;
  const metaWidth = DOCUMENT_PAGE_WIDTH - DOCUMENT_MARGIN - metaX;
  const metaRows = [
    ['Invoice number', plainText(config.number)],
    ['Issue date', formatDate(config.issueDate, { style: 'medium' })],
    ['Due date', formatDate(config.dueDate, { style: 'medium' })],
  ];
  let metaTop = partyTop;
  for (const [label, value] of metaRows) {
    page.items.push(textItem(label, metaX, metaTop, { size: 8, color: MUTED, width: 100 }));
    page.items.push(textItem(value, metaX + 100, metaTop, { size: 9, bold: true, width: metaWidth - 100, align: 'right' }));
    metaTop += 15;
  }

  top = Math.max(leftTop, metaTop) + 20;
  if (plainText(config.title).trim()) {
    top = block(page.items, config.title, DOCUMENT_MARGIN, top, DOCUMENT_CONTENT_WIDTH, {
      size: 13,
      bold: true,
    });
    top += 12;
  }

  const columns = [
    { label: 'DESCRIPTION', x: DOCUMENT_MARGIN, width: 236 },
    { label: 'QTY', x: 292, width: 42, align: 'right' },
    { label: 'UNIT PRICE', x: 340, width: 92, align: 'right' },
    { label: 'AMOUNT', x: 438, width: 109, align: 'right' },
  ];

  const tableHeader = () => {
    page.items.push(rectItem(DOCUMENT_MARGIN, top, DOCUMENT_CONTENT_WIDTH, 22, WASH));
    for (const column of columns) {
      page.items.push(
        textItem(column.label, column.x, top + 7, {
          size: 7.5,
          bold: true,
          color: MUTED,
          align: column.align ?? 'left',
          width: column.width,
        }),
      );
    }
    top += 26;
  };

  tableHeader();

  for (const line of selected) {
    const quantity = Number.parseFloat(String(line.quantity ?? '').replace(',', '.'));
    const safeQuantity = Number.isFinite(quantity) && quantity > 0 ? quantity : 0;
    const unit = toMinor(line.unitPrice, currency);
    const amount = Math.round(unit * safeQuantity);
    const descriptionLines = wrapText(plainText(line.description), 9.5, false, columns[0].width);
    const rowHeight = Math.max(24, descriptionLines.length * 12 + 12);

    if (top + rowHeight > DOCUMENT_BOTTOM - 130) {
      page.footer = 'continued';
      startPage(true);
      tableHeader();
    }

    descriptionLines.forEach((text, index) => {
      page.items.push(textItem(text, columns[0].x, top + 6 + index * 12, { size: 9.5, width: columns[0].width }));
    });
    page.items.push(textItem(String(safeQuantity), columns[1].x, top + 6, { size: 9.5, align: 'right', width: columns[1].width }));
    page.items.push(textItem(documentAmount(unit, currency), columns[2].x, top + 6, { size: 9.5, align: 'right', width: columns[2].width }));
    page.items.push(textItem(documentAmount(amount, currency), columns[3].x, top + 6, { size: 9.5, align: 'right', width: columns[3].width }));
    top += rowHeight;
    page.items.push(lineItem(DOCUMENT_MARGIN, top - 2, DOCUMENT_PAGE_WIDTH - DOCUMENT_MARGIN, top - 2, RULE, 0.4));
  }

  if (top + 170 > DOCUMENT_BOTTOM) {
    startPage(true);
  }

  // Totals block.
  const totalsTop = top + 12;
  const labelX = 340;
  const valueX = 438;
  const rows = [
    ['Subtotal', documentAmount(totals.subtotal, currency)],
    ['Discount', totals.discount ? `-${documentAmount(totals.discount, currency)}` : documentAmount(0, currency)],
    [`Tax (${totals.taxRate}%)`, documentAmount(totals.tax, currency)],
  ];
  let rowTop = totalsTop;
  for (const [label, value] of rows) {
    page.items.push(textItem(label, labelX, rowTop, { size: 9, color: MUTED, width: 90 }));
    page.items.push(textItem(value, valueX, rowTop, { size: 9, align: 'right', width: 109 }));
    rowTop += 15;
  }
  page.items.push(lineItem(labelX, rowTop + 2, DOCUMENT_PAGE_WIDTH - DOCUMENT_MARGIN, rowTop + 2, ACCENT, 0.8));
  rowTop += 8;
  page.items.push(textItem('TOTAL DUE', labelX, rowTop, { size: 9, bold: true, width: 90, color: ACCENT }));
  page.items.push(
    textItem(documentAmount(totals.total, currency), valueX, rowTop, {
      size: 12,
      bold: true,
      align: 'right',
      width: 109,
      color: ACCENT,
    }),
  );

  top = rowTop + 30;
  if (plainText(config.terms).trim()) {
    if (top + 40 > DOCUMENT_BOTTOM) startPage(true);
    page.items.push(textItem('PAYMENT TERMS', DOCUMENT_MARGIN, top, { size: 7.5, bold: true, color: MUTED }));
    top = block(page.items, config.terms, DOCUMENT_MARGIN, top + 12, DOCUMENT_CONTENT_WIDTH - 160, {
      size: 9,
      color: MUTED,
    });
    top += 8;
  }
  if (plainText(config.notes).trim()) {
    if (top + 40 > DOCUMENT_BOTTOM) startPage(true);
    page.items.push(textItem('NOTES', DOCUMENT_MARGIN, top, { size: 7.5, bold: true, color: MUTED }));
    top = block(page.items, config.notes, DOCUMENT_MARGIN, top + 12, DOCUMENT_CONTENT_WIDTH - 160, {
      size: 9,
      color: MUTED,
    });
  }

  return {
    pages,
    totals,
    validation,
    currency,
    meta: {
      title: `Invoice ${plainText(config.number)}`,
      subject: `Invoice for ${plainText(config.clientName)}`,
      fileName: buildExportFileName(snapshot, 'invoice', todayIso(), config),
    },
  };
}

// ---------------------------------------------------------------------------
// Financial report
// ---------------------------------------------------------------------------

export function createReportConfig(snapshot) {
  return {
    from: snapshot.budget.start_date,
    to: snapshot.budget.end_date,
    includeDetails: true,
    includeSummary: true,
  };
}

export function validateReportConfig(config) {
  const issues = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(plainText(config?.from))) issues.push('Choose a valid start date.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(plainText(config?.to))) issues.push('Choose a valid end date.');
  if (
    /^\d{4}-\d{2}-\d{2}$/.test(plainText(config?.from)) &&
    /^\d{4}-\d{2}-\d{2}$/.test(plainText(config?.to)) &&
    config.from > config.to
  ) {
    issues.push('The end date cannot be before the start date.');
  }
  return { ok: issues.length === 0, issues };
}

export function filterTransactionsByRange(transactions, from, to) {
  return transactions.filter((row) => isWithin(row.transaction_date, from, to));
}

export function buildReportModel(snapshot, config) {
  const validation = validateReportConfig(config);
  const filtered = filterTransactionsByRange(snapshot.transactions, config.from, config.to);
  const totals = computeTotals(filtered);
  const currency = snapshot.currency;
  const pages = [];
  let page = pageBase(1);
  let top = DOCUMENT_MARGIN;

  const startPage = (continued) => {
    page = pageBase(pages.length + 1);
    pages.push(page);
    top = DOCUMENT_MARGIN;
    page.items.push(textItem('BUDGETARIAN', DOCUMENT_MARGIN, top, { size: 10, bold: true, color: ACCENT }));
    page.items.push(
      textItem(continued ? `${snapshot.budget.name} · continued` : 'FINANCIAL REPORT', DOCUMENT_MARGIN, top, {
        size: continued ? 9 : 18,
        bold: true,
        align: 'right',
        width: DOCUMENT_CONTENT_WIDTH,
        color: continued ? MUTED : INK,
      }),
    );
    top += continued ? 22 : 28;
    page.items.push(lineItem(DOCUMENT_MARGIN, top, DOCUMENT_PAGE_WIDTH - DOCUMENT_MARGIN, top));
    top += 16;
  };

  startPage(false);

  if (!config.includeSummary) {
    page.items.push(
      textItem(
        `${formatDate(config.from, { style: 'medium' })} – ${formatDate(config.to, { style: 'medium' })}`,
        DOCUMENT_MARGIN,
        top,
        { size: 9, color: MUTED },
      ),
    );
    top += 18;
  }

  if (config.includeSummary) {
    top = block(page.items, snapshot.budget.name, DOCUMENT_MARGIN, top, DOCUMENT_CONTENT_WIDTH, {
      size: 16,
      bold: true,
    });
    page.items.push(
      textItem(
        `${formatDate(config.from, { style: 'medium' })} – ${formatDate(config.to, { style: 'medium' })} · ${currency}`,
        DOCUMENT_MARGIN,
        top + 2,
        { size: 9, color: MUTED },
      ),
    );
    top += 26;

    const summary = [
      ['Received income', documentAmount(totals.income, currency)],
      ['Paid expenses', documentAmount(totals.expense, currency)],
      ['Remaining', documentAmount(totals.remaining, currency)],
      ['Expected income', documentAmount(totals.expectedIncome, currency)],
      ['Unpaid expenses', documentAmount(totals.expectedExpense, currency)],
    ];
    const columnWidth = DOCUMENT_CONTENT_WIDTH / 3;
    const boxTop = top;
    page.items.push(rectItem(DOCUMENT_MARGIN, boxTop, DOCUMENT_CONTENT_WIDTH, 104, WASH));
    summary.forEach(([label, value], index) => {
      const column = index % 3;
      const row = Math.floor(index / 3);
      const x = DOCUMENT_MARGIN + 12 + column * columnWidth;
      const y = boxTop + 14 + row * 44;
      page.items.push(textItem(label, x, y, { size: 7.5, color: MUTED, width: columnWidth - 20 }));
      page.items.push(
        textItem(value, x, y + 13, {
          size: 11,
          bold: true,
          width: columnWidth - 20,
          color: label === 'Remaining' && totals.remaining < 0 ? '#9C3B2E' : INK,
        }),
      );
    });
    top = boxTop + 118;

    if (snapshot.spendByTag.length > 0) {
      page.items.push(textItem('SPENDING BY CATEGORY', DOCUMENT_MARGIN, top, { size: 7.5, bold: true, color: MUTED }));
      top += 12;
      const lines = snapshot.spendByTag
        .slice(0, 8)
        .map((entry) => `${entry.tag.emoji ?? ''} ${entry.tag.name}  ${documentAmount(entry.spent, currency)}`.trim());
      top = block(page.items, lines.join('   ·   '), DOCUMENT_MARGIN, top, DOCUMENT_CONTENT_WIDTH, {
        size: 9,
        color: MUTED,
        lineHeight: 13,
      });
      top += 14;
    }
  }

  page.items.push(
    textItem(`TRANSACTIONS (${filtered.length})`, DOCUMENT_MARGIN, top, {
      size: 8,
      bold: true,
      color: MUTED,
    }),
  );
  top += 16;

  const columns = [
    { label: 'DATE', x: DOCUMENT_MARGIN, width: 58 },
    { label: 'DESCRIPTION', x: 112, width: 220 },
    { label: 'TYPE', x: 338, width: 48 },
    { label: 'STATUS', x: 390, width: 50 },
    { label: 'AMOUNT', x: 444, width: 103, align: 'right' },
  ];

  const tableHeader = () => {
    page.items.push(rectItem(DOCUMENT_MARGIN, top, DOCUMENT_CONTENT_WIDTH, 20, WASH));
    for (const column of columns) {
      page.items.push(
        textItem(column.label, column.x, top + 6, {
          size: 7.5,
          bold: true,
          color: MUTED,
          align: column.align ?? 'left',
          width: column.width,
        }),
      );
    }
    top += 24;
  };

  tableHeader();

  if (filtered.length === 0) {
    page.items.push(
      textItem('No transactions fall inside this date range.', DOCUMENT_MARGIN, top + 6, {
        size: 9.5,
        color: MUTED,
      }),
    );
  }

  for (const row of filtered) {
    const detailLines =
      config.includeDetails && row.breakdownItems.length > 0
        ? row.breakdownItems.map(
            (item) =>
              `- ${item.description}  ${documentAmount(item.amount, currency)}`,
          )
        : [];
    const descriptionLines = wrapText(row.description || 'Transaction', 9, false, columns[1].width);
    const rowHeight = 18 + Math.max(0, descriptionLines.length - 1) * 11 + detailLines.length * 11;

    if (top + rowHeight > DOCUMENT_BOTTOM) {
      page.footer = 'continued';
      startPage(true);
      tableHeader();
    }

    page.items.push(textItem(row.transaction_date.slice(5), columns[0].x, top, { size: 8.5, color: MUTED, width: columns[0].width }));
    descriptionLines.forEach((line, index) => {
      page.items.push(
        textItem(line, columns[1].x, top + index * 11, {
          size: 9,
          width: columns[1].width,
          bold: index === 0,
        }),
      );
    });
    page.items.push(
      textItem(row.type === 'income' ? 'Income' : 'Expense', columns[2].x, top, {
        size: 8.5,
        color: MUTED,
        width: columns[2].width,
      }),
    );
    page.items.push(
      textItem(row.paymentStatus === 'unpaid' ? 'Unpaid' : 'Paid', columns[3].x, top, {
        size: 8.5,
        color: row.paymentStatus === 'unpaid' ? '#9C6B1E' : MUTED,
        width: columns[3].width,
      }),
    );
    page.items.push(
      textItem(
        `${row.type === 'expense' ? '-' : '+'}${documentAmount(row.amount, currency)}`,
        columns[4].x,
        top,
        {
          size: 9,
          align: 'right',
          width: columns[4].width,
          color: row.type === 'income' ? ACCENT : INK,
        },
      ),
    );
    let detailTop = top + 13 + Math.max(0, descriptionLines.length - 1) * 11;
    for (const detail of detailLines) {
      page.items.push(
        textItem(detail, columns[1].x, detailTop, {
          size: 8,
          color: '#7A867F',
          width: columns[1].width + 60,
        }),
      );
      detailTop += 11;
    }
    top = detailTop + 5;
    page.items.push(lineItem(DOCUMENT_MARGIN, top - 2, DOCUMENT_PAGE_WIDTH - DOCUMENT_MARGIN, top - 2, RULE, 0.4));
  }

  if (config.includeSummary) {
    if (top + 40 > DOCUMENT_BOTTOM) startPage(true);
    page.items.push(lineItem(DOCUMENT_MARGIN, top + 6, DOCUMENT_PAGE_WIDTH - DOCUMENT_MARGIN, top + 6, ACCENT, 0.8));
    page.items.push(
      textItem('REPORT TOTAL', DOCUMENT_MARGIN, top + 14, { size: 8, bold: true, color: MUTED }),
    );
    page.items.push(
      textItem(
        `Income ${documentAmount(totals.income, currency)}   Expenses ${documentAmount(
          totals.expense,
          currency,
        )}   Remaining ${documentAmount(totals.remaining, currency)}`,
        DOCUMENT_MARGIN,
        top + 28,
        { size: 9, width: DOCUMENT_CONTENT_WIDTH },
      ),
    );
  }

  return {
    pages,
    totals,
    filtered,
    validation,
    currency,
    meta: {
      title: `Financial report · ${snapshot.budget.name}`,
      subject: `${config.from} to ${config.to}`,
      fileName: buildExportFileName(snapshot, 'report', todayIso(), config),
    },
  };
}

// ---------------------------------------------------------------------------
// Naming
// ---------------------------------------------------------------------------

function safeSegment(value, fallback = 'Budget') {
  return (
    plainText(value)
      .trim()
      .replace(/[^A-Za-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || fallback
  );
}

export function buildExportFileName(snapshot, formatId, date = todayIso(), config = null) {
  const format = exportFormat(formatId);
  if (!format) throw new Error('Unknown export format.');
  const budget = safeSegment(snapshot?.budget?.name);
  if (formatId === 'invoice') {
    return `Invoice-${safeSegment(config?.number, 'Draft')}-${date}.pdf`;
  }
  if (formatId === 'report') {
    return `Budgetarian-Report-${budget}-${date}.pdf`;
  }
  return `Budgetarian-${budget}-${date}.${format.extension}`;
}

export { measureText };
