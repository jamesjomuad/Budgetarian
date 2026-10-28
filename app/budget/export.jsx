import { Stack, useLocalSearchParams, router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Switch,
  StyleSheet,
  View,
} from 'react-native';

import { DocumentPreview } from '../../components/budgets/DocumentPreview';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { DatePicker } from '../../components/dates/DatePicker';
import { Chip } from '../../components/ui/Chip';
import { Icon } from '../../components/ui/Icon';
import { Screen, SectionHeader } from '../../components/ui/Screen';
import { Text } from '../../components/ui/Text';
import { TextField } from '../../components/ui/TextField';
import { useTheme } from '../../components/ui/ThemeProvider';
import { fileService } from '../../services/fileService';
import { useBudgetExportStore } from '../../stores/budgetExportStore';
import { BUDGET_TRANSFER_FORMAT_VERSION } from '../../utils/budgetTransfer';
import {
  EXPORT_FORMATS,
  buildCsvModel,
  buildExportFileName,
  buildInvoiceModel,
  buildReportModel,
  buildWorkbookModel,
  computeInvoiceTotals,
  isDocumentFormat,
  validateInvoiceConfig,
  validateReportConfig,
} from '../../utils/budgetExport';
import { formatCurrency, sanitizeAmount } from '../../utils/currency';
import { formatDateRange, todayIso } from '../../utils/dates';

const FORMAT_ICONS = {
  json: 'archive',
  xlsx: 'database',
  csv: 'list',
  invoice: 'bills',
  report: 'pie',
};

const KIND_LABELS = {
  backup: 'Backup',
  spreadsheet: 'Spreadsheet',
  document: 'Document',
};

/** Rows a CSV/XLSX preview shows before "Show more". */
const PREVIEW_PAGE_ROWS = 25;

/**
 * Single-budget export center. One snapshot feeds every format: the preview
 * below renders exactly the model the exporter writes, and the store refuses
 * to export if the budget changed since the preview was reviewed.
 *
 * Flow: format picker → (configure for invoice/report) → mandatory preview →
 * Save or Share. Back walks the same path in reverse without losing input.
 */
export default function BudgetExportScreen() {
  const { id } = useLocalSearchParams();
  const budgetId = typeof id === 'string' ? id : '';

  const open = useBudgetExportStore((state) => state.open);
  const close = useBudgetExportStore((state) => state.close);
  const retry = useBudgetExportStore((state) => state.retry);

  useEffect(() => {
    open(budgetId);
    return close;
  }, [open, close, budgetId]);

  return (
    <>
      <Stack.Screen options={{ title: 'Export budget' }} />
      <ExportBody budgetId={budgetId} onRetry={retry} />
    </>
  );
}

function ExportBody({ budgetId, onRetry }) {
  const { colors, spacing } = useTheme();
  const status = useBudgetExportStore((state) => state.status);
  const error = useBudgetExportStore((state) => state.error);

  if (status === 'loading' || status === 'idle') {
    return (
      <Screen topInset>
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text variant="body" tone="muted" style={{ marginTop: spacing.md }}>
            Reading this budget…
          </Text>
        </View>
      </Screen>
    );
  }

  if (status === 'error') {
    return (
      <Screen topInset>
        <Card style={{ gap: spacing.sm }}>
          <Text variant="heading">This budget cannot be exported</Text>
          <Text variant="body" tone="muted">
            {error?.message ?? 'It may have been archived or deleted.'}
          </Text>
          <View style={{ marginTop: spacing.sm, gap: spacing.sm }}>
            <Button label="Try again" icon="refresh" onPress={onRetry} />
            <Button label="Back" variant="secondary" onPress={() => router.back()} />
          </View>
        </Card>
      </Screen>
    );
  }

  return <ExportFlow />;
}

function ExportFlow() {
  const { colors, radius, spacing } = useTheme();
  const snapshot = useBudgetExportStore((state) => state.snapshot);
  const formatId = useBudgetExportStore((state) => state.format);
  const step = useBudgetExportStore((state) => state.step);
  const error = useBudgetExportStore((state) => state.error);
  const clearError = useBudgetExportStore((state) => state.clearError);
  const goToFormat = useBudgetExportStore((state) => state.goToFormat);

  if (step === 'format') {
    return <FormatStep />;
  }

  const format = EXPORT_FORMATS.find((entry) => entry.id === formatId);

  return (
    <Screen topInset>
      {error ? (
        <Card
          style={{
            borderColor: colors.expense,
            borderRadius: radius.md,
            marginBottom: spacing.lg,
          }}
        >
          <View style={[styles.inline, { gap: spacing.sm }]}>
            <Icon name="warning" size={18} color={colors.expense} />
            <View style={{ flex: 1 }}>
              <Text variant="body" tone="expense">
                {error.title}
              </Text>
              <Text variant="caption" tone="muted" style={{ marginTop: 2 }}>
                {error.message}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Dismiss export error"
              hitSlop={10}
              onPress={clearError}
            >
              <Icon name="close" size={16} color={colors.textMuted} />
            </Pressable>
          </View>
        </Card>
      ) : null}

      {step === 'configure' && formatId === 'invoice' ? <InvoiceConfigure /> : null}
      {step === 'configure' && formatId === 'report' ? <ReportConfigure /> : null}
      {step === 'preview' ? <PreviewStep format={format} snapshot={snapshot} /> : null}

      {step === 'preview' ? null : (
        <View style={{ marginTop: spacing.lg }}>
          <Button label="Choose another format" variant="secondary" onPress={goToFormat} />
        </View>
      )}
    </Screen>
  );
}

/* ------------------------------------------------------------------ *
 * Step 1: format picker
 * ------------------------------------------------------------------ */

function FormatStep() {
  const { spacing } = useTheme();
  const snapshot = useBudgetExportStore((state) => state.snapshot);
  const isBusy = useBudgetExportStore((state) => state.isBusy);
  const chooseFormat = useBudgetExportStore((state) => state.chooseFormat);

  const kinds = ['backup', 'spreadsheet', 'document'];

  return (
    <Screen topInset>
      <View style={{ marginBottom: spacing.lg }}>
        <Text variant="title">{snapshot.budget.name}</Text>
        <Text variant="caption" tone="muted" style={{ marginTop: 2 }}>
          {formatDateRange(snapshot.budget.start_date, snapshot.budget.end_date)} ·{' '}
          {snapshot.counts.transactions} transactions
        </Text>
      </View>

      {!fileService.supported ? (
        <Text variant="caption" tone="warning" style={{ marginBottom: spacing.lg }}>
          Export is not available in the browser preview — run Budgetarian on your device to
          save a file.
        </Text>
      ) : null}

      {kinds.map((kind) => {
        const formats = EXPORT_FORMATS.filter((entry) => entry.kind === kind);
        if (formats.length === 0) return null;
        return (
          <View key={kind} style={{ marginBottom: spacing.lg }}>
            <SectionHeader title={kindLabel(kind)} />
            <View style={{ gap: spacing.sm }}>
              {formats.map((entry) => (
                <FormatCard
                  key={entry.id}
                  format={entry}
                  disabled={!fileService.supported || isBusy}
                  onPress={() => chooseFormat(entry.id)}
                />
              ))}
            </View>
          </View>
        );
      })}

      <Text variant="caption" tone="faint">
        Every export previews its exact contents first. Nothing leaves this device unless you
        save or share it yourself.
      </Text>
      <View style={{ marginTop: spacing.lg }}>
        <Button label="Cancel" variant="secondary" onPress={() => router.back()} />
      </View>
    </Screen>
  );
}

function kindLabel(kind) {
  if (kind === 'backup') return 'Restore into Budgetarian';
  if (kind === 'spreadsheet') return 'Analyze elsewhere';
  return 'Print & share';
}

function FormatCard({ format, disabled, onPress }) {
  const { colors, radius, spacing } = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${format.label}. ${format.detail}`}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.inline,
        {
          alignItems: 'flex-start',
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderRadius: radius.lg,
          borderWidth: StyleSheet.hairlineWidth,
          gap: spacing.md,
          opacity: disabled ? 0.55 : pressed ? 0.85 : 1,
          padding: spacing.lg,
        },
      ]}
    >
      <View
        style={[
          styles.formatIcon,
          { backgroundColor: colors.surfaceMuted },
        ]}
      >
        <Icon name={FORMAT_ICONS[format.id] ?? 'folder'} size={20} color={colors.primaryInk} />
      </View>
      <View style={{ flex: 1 }}>
        <Text variant="body">{format.label}</Text>
        <Text variant="caption" tone="muted" style={{ marginTop: 2 }}>
          {format.description}
        </Text>
        <Text variant="caption" tone="faint" style={{ marginTop: 2 }}>
          {format.detail}
        </Text>
      </View>
      <Text variant="caption" tone="faint">
        {format.extension}
      </Text>
    </Pressable>
  );
}

/* ------------------------------------------------------------------ *
 * Step 2a: invoice configuration
 * ------------------------------------------------------------------ */

function InvoiceConfigure() {
  const { colors, radius, spacing } = useTheme();
  const snapshot = useBudgetExportStore((state) => state.snapshot);
  const invoice = useBudgetExportStore((state) => state.invoice);
  const updateInvoice = useBudgetExportStore((state) => state.updateInvoice);
  const updateInvoiceLine = useBudgetExportStore((state) => state.updateInvoiceLine);
  const toggleInvoiceLine = useBudgetExportStore((state) => state.toggleInvoiceLine);
  const goToPreview = useBudgetExportStore((state) => state.goToPreview);

  const validation = useMemo(
    () => validateInvoiceConfig(invoice, snapshot),
    [invoice, snapshot],
  );
  const totals = useMemo(
    () => computeInvoiceTotals(invoice, snapshot.currency),
    [invoice, snapshot.currency],
  );
  const formatOpts = { currency: snapshot.currency };

  return (
    <>
      <InvoiceSection title="Invoice details">
        <TextField
          label="Invoice number"
          value={invoice.number}
          onChangeText={(value) => updateInvoice({ number: value })}
        />
        <TextField
          label="Title"
          value={invoice.title}
          onChangeText={(value) => updateInvoice({ title: value })}
          hint="Shown under the INVOICE heading."
        />
        <View style={styles.inline}>
          <View style={{ flex: 1, paddingRight: spacing.sm }}>
            <DatePicker
              label="Issue date"
              value={invoice.issueDate}
              onChange={(value) => updateInvoice({ issueDate: value })}
            />
          </View>
          <View style={{ flex: 1, paddingLeft: spacing.sm }}>
            <DatePicker
              label="Due date"
              value={invoice.dueDate}
              minimumDate={invoice.issueDate}
              onChange={(value) => updateInvoice({ dueDate: value })}
            />
          </View>
        </View>
      </InvoiceSection>

      <InvoiceSection title="Bill to">
        <TextField
          label="Client name"
          value={invoice.clientName}
          onChangeText={(value) => updateInvoice({ clientName: value })}
          placeholder="Who is being invoiced?"
        />
        <TextField
          label="Contact"
          value={invoice.clientContact}
          onChangeText={(value) => updateInvoice({ clientContact: value })}
          placeholder="Email or phone (optional)"
        />
        <TextField
          label="Address"
          value={invoice.clientAddress}
          onChangeText={(value) => updateInvoice({ clientAddress: value })}
          multiline
          numberOfLines={3}
          inputStyle={styles.multiline}
          placeholder="Billing address (optional)"
        />
      </InvoiceSection>

      <InvoiceSection
        title="Line items"
        caption="Starts empty on purpose — an invoice asks for payment for chosen charges, not for every transaction in the budget. Toggle what to bill; amounts come from the budget and stay editable."
      >
        {invoice.lineItems.length === 0 ? (
          <Text variant="caption" tone="muted">
            This budget has no expenses to bill yet.
          </Text>
        ) : null}
        <View style={{ gap: spacing.sm }}>
          {invoice.lineItems.map((line) => (
            <InvoiceLineRow
              key={line.id}
              line={line}
              currency={snapshot.currency}
              onToggle={() => toggleInvoiceLine(line.id)}
              onPatch={(patch) => updateInvoiceLine(line.id, patch)}
            />
          ))}
        </View>
      </InvoiceSection>

      <InvoiceSection title="Adjustments">
        <View style={styles.inline}>
          <View style={{ flex: 1, paddingRight: spacing.sm }}>
            <TextField
              label="Discount"
              value={invoice.discount}
              onChangeText={(value) => updateInvoice({ discount: sanitizeAmount(value, 2) })}
              keyboardType="decimal-pad"
              hint={`Off the subtotal (${snapshot.currency}).`}
            />
          </View>
          <View style={{ flex: 1, paddingLeft: spacing.sm }}>
            <TextField
              label="Tax rate"
              value={invoice.taxRate}
              onChangeText={(value) => updateInvoice({ taxRate: sanitizeAmount(value, 2) })}
              keyboardType="decimal-pad"
              hint="% applied after discount."
            />
          </View>
        </View>
        <TextField
          label="Notes"
          value={invoice.notes}
          onChangeText={(value) => updateInvoice({ notes: value })}
          multiline
          numberOfLines={3}
          inputStyle={styles.multiline}
          placeholder="Anything the client should read (optional)"
        />
        <TextField
          label="Payment terms"
          value={invoice.terms}
          onChangeText={(value) => updateInvoice({ terms: value })}
        />
      </InvoiceSection>

      <Card style={{ gap: spacing.xs }}>
        <TotalRow
          label={`Selected lines (${totals.lineCount})`}
          value={formatCurrency(totals.subtotal, formatOpts)}
        />
        {totals.discount > 0 ? (
          <TotalRow
            label="Discount"
            value={`- ${formatCurrency(totals.discount, formatOpts)}`}
          />
        ) : null}
        {totals.tax > 0 ? (
          <TotalRow
            label={`Tax (${invoice.taxRate || '0'}%)`}
            value={formatCurrency(totals.tax, formatOpts)}
          />
        ) : null}
        <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border }} />
        <TotalRow label="Total due" value={formatCurrency(totals.total, formatOpts)} strong />
      </Card>

      {!validation.ok ? (
        <Card
          style={{
            borderColor: colors.warning,
            borderRadius: radius.md,
            gap: 4,
            marginTop: spacing.md,
          }}
        >
          {validation.issues.map((issue, index) => (
            // Issues are fixed-position warnings from the validator.
            <Text key={`${index}-${issue}`} variant="caption" tone="warning">
              {issue}
            </Text>
          ))}
        </Card>
      ) : null}

      <View style={{ marginTop: spacing.lg }}>
        <Button
          label="Preview invoice"
          icon="chevronRight"
          disabled={!validation.ok}
          onPress={goToPreview}
        />
      </View>
      <Text variant="caption" tone="faint" style={{ marginTop: spacing.sm }}>
        Exporting an invoice never records income or changes any transaction.
      </Text>
    </>
  );
}

function InvoiceSection({ title, caption, children }) {
  const { spacing } = useTheme();

  return (
    <View style={{ marginBottom: spacing.lg }}>
      <SectionHeader title={title} />
      {caption ? (
        <Text variant="caption" tone="muted" style={{ marginBottom: spacing.md }}>
          {caption}
        </Text>
      ) : null}
      {children}
    </View>
  );
}

function InvoiceLineRow({ line, currency, onToggle, onPatch }) {
  const { colors, radius, spacing } = useTheme();
  const [expanded, setExpanded] = useState(false);

  return (
    <View
      style={{
        borderColor: line.selected ? colors.primary : colors.border,
        borderRadius: radius.md,
        borderWidth: StyleSheet.hairlineWidth,
        paddingHorizontal: spacing.md,
      }}
    >
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: line.selected }}
        accessibilityLabel={`${line.selected ? 'Remove' : 'Bill'} ${line.description}`}
        onPress={onToggle}
        style={({ pressed }) => [
          styles.inline,
          { gap: spacing.md, opacity: pressed ? 0.8 : 1, paddingVertical: spacing.md },
        ]}
      >
        <View
          style={[
            styles.checkbox,
            {
              backgroundColor: line.selected ? colors.primary : 'transparent',
              borderColor: line.selected ? colors.primary : colors.textFaint,
            },
          ]}
        >
          {line.selected ? <Icon name="check" size={14} color={colors.onPrimary} /> : null}
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="body" numberOfLines={1}>
            {line.description}
          </Text>
          <Text variant="caption" tone="faint" style={{ marginTop: 1 }}>
            {line.date} · {line.reference}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={expanded ? 'Hide line item fields' : 'Edit line item'}
          hitSlop={10}
          onPress={() => setExpanded((open) => !open)}
        >
          <Icon name={expanded ? 'chevronUp' : 'chevronDown'} size={16} color={colors.textMuted} />
        </Pressable>
      </Pressable>

      {expanded ? (
        <View style={{ paddingBottom: spacing.sm }}>
          <TextField
            label="Description on the invoice"
            value={line.description}
            onChangeText={(value) => onPatch({ description: value })}
          />
          <View style={styles.inline}>
            <View style={{ flex: 1, paddingRight: spacing.sm }}>
              <TextField
                label="Quantity"
                value={line.quantity}
                onChangeText={(value) => onPatch({ quantity: sanitizeAmount(value, 2) })}
                keyboardType="decimal-pad"
              />
            </View>
            <View style={{ flex: 1, paddingLeft: spacing.sm }}>
              <TextField
                label={`Unit price (${currency})`}
                value={line.unitPrice}
                onChangeText={(value) => onPatch({ unitPrice: sanitizeAmount(value, 2) })}
                keyboardType="decimal-pad"
              />
            </View>
          </View>
        </View>
      ) : null}
    </View>
  );
}

function TotalRow({ label, value, strong = false }) {
  return (
    <View style={[styles.rowBetween]}>
      <Text variant={strong ? 'body' : 'caption'} tone={strong ? 'default' : 'muted'}>
        {label}
      </Text>
      <Text variant={strong ? 'heading' : 'caption'} tone={strong ? 'primary' : 'default'}>
        {value}
      </Text>
    </View>
  );
}

/* ------------------------------------------------------------------ *
 * Step 2b: report configuration
 * ------------------------------------------------------------------ */

function ReportConfigure() {
  const { colors, radius, spacing } = useTheme();
  const snapshot = useBudgetExportStore((state) => state.snapshot);
  const report = useBudgetExportStore((state) => state.report);
  const updateReport = useBudgetExportStore((state) => state.updateReport);
  const goToPreview = useBudgetExportStore((state) => state.goToPreview);

  const validation = useMemo(() => validateReportConfig(report), [report]);

  return (
    <>
      <InvoiceSection
        title="Period"
        caption={`Defaults to the whole budget (${formatDateRange(
          snapshot.budget.start_date,
          snapshot.budget.end_date,
        )}).`}
      >
        <View style={styles.inline}>
          <View style={{ flex: 1, paddingRight: spacing.sm }}>
            <DatePicker
              label="From"
              value={report.from}
              onChange={(value) => updateReport({ from: value })}
            />
          </View>
          <View style={{ flex: 1, paddingLeft: spacing.sm }}>
            <DatePicker
              label="To"
              value={report.to}
              minimumDate={report.from}
              onChange={(value) => updateReport({ to: value })}
            />
          </View>
        </View>
      </InvoiceSection>

      <InvoiceSection title="Contents">
        <SwitchRow
          label="Transaction details"
          caption="List every transaction in the period after the summaries."
          value={report.includeDetails}
          onChange={(value) => updateReport({ includeDetails: value })}
        />
        <SwitchRow
          label="Summary sections"
          caption="Income, expenses, remaining and spending by category."
          value={report.includeSummary}
          onChange={(value) => updateReport({ includeSummary: value })}
        />
      </InvoiceSection>

      {!validation.ok ? (
        <Card
          style={{
            borderColor: colors.warning,
            borderRadius: radius.md,
            gap: 4,
            marginBottom: spacing.md,
          }}
        >
          {validation.issues.map((issue, index) => (
            <Text key={`${index}-${issue}`} variant="caption" tone="warning">
              {issue}
            </Text>
          ))}
        </Card>
      ) : null}

      <Button
        label="Preview report"
        icon="chevronRight"
        disabled={!validation.ok}
        onPress={goToPreview}
      />
      <Text variant="caption" tone="faint" style={{ marginTop: spacing.sm }}>
        Totals follow the same rules as the app: unpaid income is shown as expected, never as
        received.
      </Text>
    </>
  );
}

function SwitchRow({ label, caption, value, onChange }) {
  const { colors, spacing } = useTheme();

  return (
    <View style={[styles.inline, { gap: spacing.md, paddingVertical: spacing.sm }]}>
      <View style={{ flex: 1 }}>
        <Text variant="body">{label}</Text>
        {caption ? (
          <Text variant="caption" tone="muted" style={{ marginTop: 1 }}>
            {caption}
          </Text>
        ) : null}
      </View>
      <Switch
        accessibilityRole="switch"
        accessibilityLabel={label}
        value={value}
        onValueChange={onChange}
        trackColor={{ false: colors.border, true: colors.primary }}
        thumbColor={colors.surface}
        ios_backgroundColor={colors.border}
      />
    </View>
  );
}

/* ------------------------------------------------------------------ *
 * Step 3: mandatory preview + save/share
 * ------------------------------------------------------------------ */

function PreviewStep({ format, snapshot }) {
  const { colors, radius, spacing } = useTheme();
  const invoice = useBudgetExportStore((state) => state.invoice);
  const report = useBudgetExportStore((state) => state.report);
  const stale = useBudgetExportStore((state) => state.stale);
  const isExporting = useBudgetExportStore((state) => state.isExporting);
  const goBack = useBudgetExportStore((state) => state.goBack);
  const performExport = useBudgetExportStore((state) => state.performExport);
  const refreshPreview = useBudgetExportStore((state) => state.refreshPreview);
  const markPreviewReviewed = useBudgetExportStore((state) => state.markPreviewReviewed);

  const config = format.id === 'invoice' ? invoice : format.id === 'report' ? report : null;
  const fileName = useMemo(
    () => buildExportFileName(snapshot, format.id, todayIso(), config),
    [snapshot, format.id, config],
  );

  const save = useCallback(() => performExport('save'), [performExport]);
  const share = useCallback(() => performExport('share'), [performExport]);

  return (
    <>
      <Card style={{ gap: 2 }}>
        <View style={[styles.rowBetween, { alignItems: 'flex-start' }]}>
          <View style={{ flex: 1, paddingRight: spacing.md }}>
            <Text variant="caption" tone="faint">
              {KIND_LABELS[format.kind]} · {format.extension}
            </Text>
            <Text variant="heading" numberOfLines={1} style={{ marginTop: 2 }}>
              {snapshot.budget.name}
            </Text>
          </View>
          <View style={styles.inline}>
            <Icon name={FORMAT_ICONS[format.id] ?? 'folder'} size={18} color={colors.primaryInk} />
          </View>
        </View>
        <Text variant="caption" tone="muted" numberOfLines={1} style={{ marginTop: 4 }}>
          {fileName}
        </Text>
      </Card>

      {stale ? (
        <Card
          style={{
            borderColor: colors.warning,
            borderRadius: radius.md,
            gap: spacing.sm,
            marginTop: spacing.md,
          }}
        >
          <View style={styles.inline}>
            <Icon name="warning" size={18} color={colors.warning} />
            <Text variant="body" style={{ flex: 1 }}>
              This budget changed while you were previewing.
            </Text>
          </View>
          <Text variant="caption" tone="muted">
            The preview below now shows the latest data. Review it, then continue — nothing is
            exported from a stale view.
          </Text>
          <Button label="I reviewed the update" icon="check" onPress={markPreviewReviewed} />
        </Card>
      ) : null}

      <View style={{ marginTop: spacing.md }}>
        {format.id === 'json' ? <JsonPreview snapshot={snapshot} /> : null}
        {format.id === 'csv' ? <CsvPreview snapshot={snapshot} /> : null}
        {format.id === 'xlsx' ? <WorkbookPreview snapshot={snapshot} /> : null}
        {isDocumentFormat(format.id) ? (
          <DocumentFormatPreview
            key={`${format.id}:${snapshot.fingerprint}`}
            snapshot={snapshot}
            formatId={format.id}
            config={config}
          />
        ) : null}
      </View>

      <View style={{ gap: spacing.sm, marginTop: spacing.lg }}>
        <Button label="Save file" icon="folder" disabled={isExporting || stale} onPress={save} />
        <Button
          label="Share"
          icon="share"
          variant="secondary"
          disabled={isExporting || stale}
          onPress={share}
        />
        <Button label="Back" variant="secondary" onPress={goBack} />
      </View>
      {isExporting ? (
        <View style={[styles.inline, { justifyContent: 'center', marginTop: spacing.md }]}>
          <ActivityIndicator color={colors.primary} />
          <Text variant="caption" tone="muted" style={{ marginLeft: spacing.sm }}>
            Building {fileName}…
          </Text>
        </View>
      ) : (
        <Text variant="caption" tone="faint" style={{ marginTop: spacing.md }}>
          Save picks a folder on your device; Share opens the system send sheet.
        </Text>
      )}
      <Pressable
        accessibilityRole="button"
        onPress={refreshPreview}
        hitSlop={8}
        style={{ marginTop: spacing.sm }}
      >
        <Text variant="caption" tone="primary">
          Re-check the budget for changes
        </Text>
      </Pressable>
    </>
  );
}

/** JSON: a compact manifest, never raw file bytes. */
function JsonPreview({ snapshot }) {
  const { spacing } = useTheme();

  return (
    <View style={{ gap: spacing.md }}>
      <Card style={{ gap: spacing.xs }}>
        <Text variant="label" tone="muted">
          Budgetarian budget v{BUDGET_TRANSFER_FORMAT_VERSION} · restorable backup
        </Text>
        <ManifestRow label="Transactions" value={snapshot.counts.transactions} />
        <ManifestRow label="Breakdown items" value={snapshot.counts.breakdownItems} />
        <ManifestRow label="Tags used" value={snapshot.counts.tags} />
        <ManifestRow
          label="Reminders"
          value={`${snapshot.counts.reminders} (${snapshot.counts.activeReminders} active)`}
        />
        <ManifestRow
          label="Receipts"
          value={
            snapshot.counts.attachments > 0
              ? `${snapshot.counts.attachments} image${snapshot.counts.attachments === 1 ? '' : 's'}`
              : 'none'
          }
        />
        <ManifestRow
          label="Money in this budget"
          value={`${formatCurrency(snapshot.totals.recordedIncome, {
            currency: snapshot.currency,
          })} in · ${formatCurrency(snapshot.totals.expense, {
            currency: snapshot.currency,
          })} out`}
        />
      </Card>
      <Text variant="caption" tone="muted">
        Includes this budget only — no folders, no other budgets, no app settings. Receipt
        images are embedded in the file and are re-saved into app storage on import.
      </Text>
      <Text variant="caption" tone="faint">
        Import restores it as a new budget with fresh IDs. Amounts keep their stored values;
        the file records {snapshot.currency} as the exported currency but never changes your
        app&apos;s currency.
      </Text>
    </View>
  );
}

function ManifestRow({ label, value }) {
  return (
    <View style={styles.rowBetween}>
      <Text variant="caption" tone="muted">
        {label}
      </Text>
      <Text variant="caption" style={styles.mono}>
        {String(value)}
      </Text>
    </View>
  );
}

/** CSV / XLSX: the same row arrays the writers receive. */
function TablePreview({ columns, rows, count, emptyLabel }) {
  const { colors, radius, spacing } = useTheme();
  const [limit, setLimit] = useState(PREVIEW_PAGE_ROWS);

  const shown = rows.slice(0, limit);

  return (
    <Card padded={false} style={{ borderColor: colors.border, borderRadius: radius.md }}>
      <ScrollView horizontal bounces={false} showsHorizontalScrollIndicator={false}>
        <View>
          <View style={[styles.tableRow, { backgroundColor: colors.surfaceMuted }]}>
            {columns.map((column) => (
              <Text
                key={column.key ?? column.label}
                variant="label"
                tone="muted"
                numberOfLines={1}
                style={{ width: columnWidth(column), paddingHorizontal: spacing.md }}
              >
                {column.label}
              </Text>
            ))}
          </View>
          {shown.map((row, rowIndex) => (
            <View
              key={rowIndex}
              style={[
                styles.tableRow,
                rowIndex === shown.length - 1
                  ? null
                  : { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
              ]}
            >
              {row.map((cell, cellIndex) => (
                <Text
                  key={cellIndex}
                  variant="caption"
                  numberOfLines={1}
                  style={{ width: columnWidth(columns[cellIndex]), paddingHorizontal: spacing.md }}
                >
                  {formatCell(cell)}
                </Text>
              ))}
            </View>
          ))}
          {rows.length === 0 ? (
            <Text variant="caption" tone="muted" style={{ padding: spacing.lg }}>
              {emptyLabel ?? 'Nothing to show in this table.'}
            </Text>
          ) : null}
        </View>
      </ScrollView>
      {count > shown.length ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => setLimit((current) => current + PREVIEW_PAGE_ROWS)}
          style={({ pressed }) => [
            styles.moreRow,
            { borderTopColor: colors.border, opacity: pressed ? 0.6 : 1 },
          ]}
        >
          <Text variant="caption" tone="primary">
            Show more ({shown.length} of {count} rows shown)
          </Text>
        </Pressable>
      ) : null}
    </Card>
  );
}

function columnWidth(column) {
  const base = column.width ? Math.round(column.width * 7.2) + 14 : 0;
  const estimated = Math.min(260, Math.max(96, String(column.label ?? '').length * 9 + 34));
  return base || estimated;
}

function formatCell(cell) {
  if (cell == null) return '';
  if (typeof cell === 'object') return formatCell(cell.value);
  return String(cell);
}

function CsvPreview({ snapshot }) {
  const { spacing } = useTheme();
  const model = useMemo(() => buildCsvModel(snapshot), [snapshot]);

  return (
    <View style={{ gap: spacing.md }}>
      <Text variant="caption" tone="muted">
        {model.scope} — {model.count} rows, UTF-8, comma separated.
      </Text>
      <TablePreview columns={model.columns} rows={model.rows} count={model.count} />
      <Text variant="caption" tone="faint">
        {model.excluded} A CSV is one flat table: amounts are plain numbers (
        {snapshot.currency}) and dates are YYYY-MM-DD so spreadsheets read them as you expect.
      </Text>
    </View>
  );
}

function WorkbookPreview({ snapshot }) {
  const { spacing } = useTheme();
  const model = useMemo(() => buildWorkbookModel(snapshot), [snapshot]);
  const [activeName, setActiveName] = useState(model.sheets[0]?.name);

  const active = model.sheets.find((sheet) => sheet.name === activeName) ?? model.sheets[0];

  return (
    <View style={{ gap: spacing.md }}>
      <ScrollView
        horizontal
        bounces={false}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: spacing.sm }}
      >
        {model.sheets.map((sheet) => (
          <Chip
            key={sheet.name}
            label={`${sheet.name} (${sheet.count})`}
            active={sheet.name === active?.name}
            onPress={() => setActiveName(sheet.name)}
          />
        ))}
      </ScrollView>
      {active ? (
        <TablePreview
          columns={active.columns.map((column, index) => ({
            key: index,
            label: column.label,
            width: column.width,
          }))}
          rows={active.rows}
          count={active.count}
        />
      ) : null}
      <Text variant="caption" tone="faint">
        Data preview — column widths, frozen headers and number formats are applied in the
        workbook itself. {model.limitations}
      </Text>
    </View>
  );
}

/** Invoice / report: the actual paginated document, page by page. */
function DocumentFormatPreview({ snapshot, formatId, config }) {
  const { colors, spacing, radius } = useTheme();
  const model = useMemo(
    () =>
      formatId === 'invoice'
        ? buildInvoiceModel(snapshot, config)
        : buildReportModel(snapshot, config),
    [snapshot, formatId, config],
  );

  const [previewWidth, setPreviewWidth] = useState(0);
  const [pageIndex, setPageIndex] = useState(0);

  const pages = model.pages;
  const safeIndex = Math.min(pageIndex, pages.length - 1);
  const page = pages[safeIndex];

  return (
    <View style={{ gap: spacing.md }}>
      {!model.validation.ok ? (
        <Card style={{ borderColor: colors.warning, borderRadius: radius.md, gap: 4 }}>
          {model.validation.issues.map((issue, index) => (
            <Text key={`${index}-${issue}`} variant="caption" tone="warning">
              {issue}
            </Text>
          ))}
        </Card>
      ) : null}

      <View onLayout={(event) => setPreviewWidth(event.nativeEvent.layout.width)}>
        {page && previewWidth > 0 ? (
          <DocumentPreview page={page} width={previewWidth} totalPages={pages.length} />
        ) : (
          <View
            style={{
              backgroundColor: colors.surfaceMuted,
              borderRadius: radius.md,
              height: 320,
            }}
          />
        )}
      </View>

      {pages.length > 1 ? (
        <View style={[styles.rowBetween, { gap: spacing.sm }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Previous page"
            disabled={safeIndex === 0}
            onPress={() => setPageIndex((index) => Math.max(0, index - 1))}
            style={({ pressed }) => [
              styles.pagerButton,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
                borderRadius: radius.pill,
                opacity: safeIndex === 0 ? 0.4 : pressed ? 0.7 : 1,
              },
            ]}
          >
            <Icon name="chevronLeft" size={18} color={colors.text} />
          </Pressable>
          <Text variant="caption" tone="muted">
            Page {safeIndex + 1} of {pages.length}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Next page"
            disabled={safeIndex >= pages.length - 1}
            onPress={() => setPageIndex((index) => Math.min(pages.length - 1, index + 1))}
            style={({ pressed }) => [
              styles.pagerButton,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
                borderRadius: radius.pill,
                opacity: safeIndex >= pages.length - 1 ? 0.4 : pressed ? 0.7 : 1,
              },
            ]}
          >
            <Icon name="chevronRight" size={18} color={colors.text} />
          </Pressable>
        </View>
      ) : null}

      {formatId === 'invoice' ? (
        <Card style={{ gap: spacing.xs }}>
          <TotalRow label="Subtotal" value={documentMoney(model.totals.subtotal, model.currency)} />
          {model.totals.discount > 0 ? (
            <TotalRow label="Discount" value={`- ${documentMoney(model.totals.discount, model.currency)}`} />
          ) : null}
          {model.totals.tax > 0 ? (
            <TotalRow
              label={`Tax (${model.totals.taxRate}%)`}
              value={documentMoney(model.totals.tax, model.currency)}
            />
          ) : null}
          <TotalRow label="Total due" value={documentMoney(model.totals.total, model.currency)} strong />
          <Text variant="caption" tone="faint" style={{ marginTop: 2 }}>
            The preview above is the page that prints — totals here match it exactly.
          </Text>
        </Card>
      ) : null}

      {formatId === 'report' ? (
        <Text variant="caption" tone="muted">
          {model.filtered.length} transactions in {config?.from} to {config?.to} · expenses{' '}
          {documentMoney(model.totals.expense, model.currency)} · remaining{' '}
          {documentMoney(model.totals.remaining, model.currency)}
        </Text>
      ) : null}
    </View>
  );
}

function documentMoney(minor, currency) {
  return formatCurrency(minor, { currency });
}

const styles = StyleSheet.create({
  centered: { alignItems: 'center', flex: 1, justifyContent: 'center', padding: 24 },
  checkbox: {
    alignItems: 'center',
    borderColor: 'transparent',
    borderRadius: 6,
    borderWidth: 1.5,
    height: 22,
    justifyContent: 'center',
    width: 22,
  },
  formatIcon: {
    alignItems: 'center',
    borderRadius: 10,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  inline: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  mono: {
    fontVariant: ['tabular-nums'],
  },
  moreRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingVertical: 12,
  },
  multiline: {
    minHeight: 84,
    textAlignVertical: 'top',
  },
  pagerButton: {
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  rowBetween: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  tableRow: {
    alignItems: 'center',
    flexDirection: 'row',
    minHeight: 36,
    paddingVertical: 8,
  },
});
