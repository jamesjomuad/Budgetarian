import { create } from 'zustand';

import {
  exportBudgetDocument,
  loadBudgetExportSnapshot,
  refreshBudgetExportSnapshot,
} from '../services/budgetExportService';
import {
  createInvoiceConfig,
  createReportConfig,
  exportFormat,
  reconcileInvoiceConfig,
} from '../utils/budgetExport';
import { showToast } from './toastStore';

/**
 * State for the export centre. Screens never build a file themselves: they
 * choose a format, edit its configuration and ask this store to export. The
 * store owns the one snapshot the preview renders, so preview and file always
 * share their source data.
 */
function initialState() {
  return {
    budgetId: null,
    snapshot: null,
    status: 'idle',
    error: null,
    format: null,
    step: 'format',
    invoice: null,
    report: null,
    isBusy: false,
    isExporting: false,
    stale: false,
  };
}

export const useBudgetExportStore = create((set, get) => ({
  ...initialState(),

  open: async (budgetId) => {
    set({ ...initialState(), budgetId, status: 'loading', isBusy: true });
    try {
      const snapshot = await loadBudgetExportSnapshot(budgetId);
      if (get().budgetId !== budgetId) return;
      set({ snapshot, status: 'ready', isBusy: false, error: null });
    } catch (error) {
      if (get().budgetId !== budgetId) return;
      set({
        status: 'error',
        isBusy: false,
        error: {
          title: 'Could not open this budget',
          message: error?.message ?? 'Nothing was changed.',
        },
      });
    }
  },

  retry: async () => {
    const { budgetId } = get();
    if (budgetId) await get().open(budgetId);
  },

  close: () => set(initialState()),

  clearError: () => set({ error: null }),

  chooseFormat: (formatId) => {
    const format = exportFormat(formatId);
    if (!format) return;
    const { snapshot, invoice, report } = get();
    if (!snapshot) return;
    set({
      format: formatId,
      error: null,
      stale: false,
      step: format.destination === 'configure' ? 'configure' : 'preview',
      invoice: formatId === 'invoice' ? invoice ?? createInvoiceConfig(snapshot) : invoice,
      report: formatId === 'report' ? report ?? createReportConfig(snapshot) : report,
    });
  },

  goToFormat: () => set({ step: 'format', error: null }),

  goBack: () => {
    const { step, format } = get();
    if (step === 'preview') {
      set({ step: format === 'invoice' || format === 'report' ? 'configure' : 'format', error: null });
    } else if (step === 'configure') {
      set({ step: 'format', error: null });
    }
  },

  goToPreview: () => set({ step: 'preview', error: null }),

  /** The user has looked at the refreshed data; exporting may proceed. */
  markPreviewReviewed: () => set({ stale: false }),

  updateInvoice: (patch) =>
    set((state) => ({
      invoice: { ...(state.invoice ?? {}), ...patch },
      stale: false,
      error: null,
    })),

  updateInvoiceLine: (id, patch) =>
    set((state) => ({
      invoice: state.invoice
        ? {
            ...state.invoice,
            lineItems: state.invoice.lineItems.map((line) =>
              line.id === id ? { ...line, ...patch } : line,
            ),
          }
        : null,
      stale: false,
      error: null,
    })),

  toggleInvoiceLine: (id) =>
    set((state) => ({
      invoice: state.invoice
        ? {
            ...state.invoice,
            lineItems: state.invoice.lineItems.map((line) =>
              line.id === id ? { ...line, selected: !line.selected } : line,
            ),
          }
        : null,
      stale: false,
      error: null,
    })),

  updateReport: (patch) =>
    set((state) => ({
      report: { ...(state.report ?? {}), ...patch },
      stale: false,
      error: null,
    })),

  /** Re-read the budget and rebuild the preview from it. */
  refreshPreview: async () => {
    const { budgetId, snapshot } = get();
    if (!budgetId || !snapshot) return null;
    set({ isBusy: true, error: null });
    try {
      const current = await refreshBudgetExportSnapshot(budgetId);
      set((state) => ({
        snapshot: current,
        stale: false,
        invoice: state.invoice ? reconcileInvoiceConfig(state.invoice, current) : null,
        report: state.report ?? createReportConfig(current),
        isBusy: false,
      }));
      return current;
    } catch (error) {
      set({
        isBusy: false,
        error: {
          title: 'Could not refresh the preview',
          message: error?.message ?? 'Nothing was changed.',
        },
      });
      return null;
    }
  },

  performExport: async (destination = 'save') => {
    const { snapshot, format, invoice, report, isExporting } = get();
    if (!snapshot || !format || isExporting) return null;

    set({ isExporting: true, error: null });
    try {
      const result = await exportBudgetDocument(
        snapshot,
        format,
        format === 'invoice' ? invoice : format === 'report' ? report : null,
        { destination },
      );

      if (result.saved) {
        const verb = destination === 'share' ? 'Shared' : 'Saved';
        if (result.warnings.length) {
          showToast(
            `${verb} "${result.fileName}" · ${result.warnings.length} warning${
              result.warnings.length === 1 ? '' : 's'
            }`,
            'warning',
          );
        } else {
          showToast(`${verb} "${result.fileName}"`, 'success');
        }
      }
      return result;
    } catch (error) {
      if (error?.code === 'STALE_EXPORT' && error.snapshot) {
        set((state) => ({
          snapshot: error.snapshot,
          stale: true,
          invoice: state.invoice ? reconcileInvoiceConfig(state.invoice, error.snapshot) : null,
          report: state.report ?? createReportConfig(error.snapshot),
        }));
        showToast('This budget changed — review the refreshed preview', 'warning');
        return { stale: true };
      }
      set({
        error: {
          title: 'Could not export',
          message: error?.message ?? 'Nothing was written.',
        },
      });
      showToast('The file could not be exported', 'error');
      return null;
    } finally {
      set({ isExporting: false });
    }
  },
}));
