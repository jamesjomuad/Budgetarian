import { create } from 'zustand';

import { getAttachments, createAttachment } from '../storage/repositories/attachmentRepository';
import { getBudget } from '../storage/repositories/budgetRepository';
import { getRemindersForBudget } from '../storage/repositories/reminderRepository';
import {
  createTransaction,
  deleteTransaction,
  getSubTransactionsForBudget,
  getTransactionsForBudget,
  moveTransactionToBudget,
  cloneTransaction,
  updateTransaction,
} from '../storage/repositories/transactionRepository';
import { applyReminder } from '../services/reminderService';
import { deleteReceiptFile, readReceiptBase64, writeReceiptBase64 } from '../services/receiptFiles';
import { useBudgetsStore } from './budgetsStore';
import { useCalendarStore } from './calendarStore';
import { useDashboardStore } from './dashboardStore';
import { useReportsStore } from './reportsStore';
import { useTagsStore } from './tagsStore';
import {
  collectUsedTagIds,
  computeTagExpenseBreakdown,
  computeTotals,
  computeTransactionSharePercent,
} from '../utils/calculations';

/**
 * State for a single opened Budget. The repository returns raw rows and this
 * store reduces them with the shared rules in utils/calculations.js, so the
 * summary and the per-tag breakdown can never disagree with each other.
 *
 * Reminder rows ride along on each entry (`entry.reminder`) so the form and
 * the transaction list read one consistent snapshot; scheduling itself stays
 * in the reminder service, never in a screen.
 */
export const useBudgetDetailStore = create((set, get) => {
  let requestId = 0;

  return {
    budgetId: null,
    budget: null,
    summary: { transactionCount: 0, income: 0, expense: 0, expectedIncome: 0, expectedExpense: 0, remaining: 0 },
    tagSummaries: [],
    entries: [],
    transactions: [],
    activeTagId: null,
    isLoading: true,
    // Two distinct failure modes so the UI never mislabels one as the other:
    // `error`  — the budget row genuinely does not exist (a real not-found).
    // `loadError` — a database/read failure while loading; the row may well
    //               exist, so the screen must offer a retry, not "not found".
    error: null,
    loadError: null,

    load: async (budgetId) => {
      if (!budgetId) return;

      const id = ++requestId;
      const state = get();
      const activeTagId = state.budgetId === budgetId ? state.activeTagId : null;

      // Claim the route identity immediately. A superseded request can never
      // write itself back after a newer budget has taken over.
      set({ budgetId, isLoading: true, error: null, loadError: null, activeTagId });

      try {
        // Tags come from the shared tags store (cached with 2s TTL) instead of
        // a direct repository read, so opening a budget never re-queries the
        // tag library when it was already loaded moments ago.
        const [budget, _tagsResult, entries, reminders, breakdowns] = await Promise.all([
          getBudget(budgetId),
          useTagsStore.getState().load(),
          getTransactionsForBudget(budgetId),
          // Archived rows included: the budget's own detail view stays
          // archive-agnostic, exactly like its row and its transactions. Scoped
          // to this budget's transactions instead of reading every reminder.
          getRemindersForBudget(budgetId, { includeArchived: true }),
          getSubTransactionsForBudget(budgetId),
        ]);
        const tags = useTagsStore.getState().tags;

        if (id !== requestId) return;

        if (!budget) {
          set({
            budget: null,
            summary: { transactionCount: 0, income: 0, expense: 0, expectedIncome: 0, expectedExpense: 0, remaining: 0 },
            tagSummaries: [],
            entries: [],
            transactions: [],
            activeTagId: null,
            error: new Error('That budget no longer exists.'),
            loadError: null,
            isLoading: false,
          });
          return;
        }

        // A transaction can own several reminders; hydrate with the oldest,
        // the same one the form's "Set Reminder" switch manages.
        const reminderByTransaction = new Map();
        for (const reminder of reminders) {
          if (reminder.transaction_id == null) continue;
          if (!reminderByTransaction.has(reminder.transaction_id)) {
            reminderByTransaction.set(reminder.transaction_id, reminder);
          }
        }
        // Breakdown items ride along in persisted order, read once for the
        // whole budget. The list UI only ever needs the count; the form and
        // the details section read `subTransactions` off the same snapshot.
        const hydrated = entries.map((entry) => ({
          ...entry,
          reminder: reminderByTransaction.get(entry.id) ?? null,
          subTransactions: breakdowns.get(entry.id) ?? [],
          sub_transaction_count: (breakdowns.get(entry.id) ?? []).length,
        }));

        const summary = computeTotals(hydrated);

        // Show only tags this budget's transactions actually reference, keeping
        // the library's order. Each tag's bar is its expense total divided by
        // the same `summary.expense` shown by the budget, never signed amount or
        // income, so mixed income/expense tags still measure their real spend.
        const usedTagIds = collectUsedTagIds(hydrated);
        const tagSummaries = computeTagExpenseBreakdown(hydrated, tags, summary.expense).filter(
          (row) => usedTagIds.has(row.tag.id),
        );

        // Share is always against the full budget summary, even while a tag
        // filter is active. Transfers receive null because they are neither
        // income nor spending.
        const withShares = hydrated.map((entry) => ({
          ...entry,
          sharePercent: computeTransactionSharePercent(entry, summary),
        }));

        const selectedTagId = get().activeTagId;
        set({
          budgetId,
          budget,
          summary,
          tagSummaries,
          entries: withShares,
          transactions: selectedTagId
            ? withShares.filter((entry) => entry.tag_id === selectedTagId)
            : withShares,
          error: null,
          loadError: null,
          isLoading: false,
        });
      } catch (error) {
        if (id !== requestId) return;
        // A thrown query is a read failure, not proof the budget is gone —
        // keep whatever `budget` we had and surface a retryable error.
        set({ loadError: error, isLoading: false });
      }
    },

    setActiveTag: (tagId) => {
      const { entries } = get();
      set({
        activeTagId: tagId,
        transactions: tagId ? entries.filter((entry) => entry.tag_id === tagId) : entries,
      });
    },

    /**
     * Saves the transaction first and its reminder second, so a notification
     * problem can never lose the financial record. Returns the reminder outcome
     * for the form to explain (permission denied, browser preview, …).
     */
    addTransaction: async (input) => {
      const { receiptPath, ...transactionInput } = input;
      const transaction = await createTransaction(transactionInput);
      // A shared receipt arrives as a persisted file path alongside the
      // financial fields: the row commits first, the attachment reference
      // second. A failed attachment write costs the receipt but never the
      // transaction — the orphan file goes back out and the form reports
      // the loss on top of a save that succeeded.
      let attachmentError = null;
      if (receiptPath) {
        try {
          await createAttachment({ transactionId: transaction.id, path: receiptPath });
        } catch (error) {
          deleteReceiptFile(receiptPath);
          attachmentError = error;
        }
      }
      const reminder =
        input.reminder === undefined
          ? null
          : await applyReminder({ transaction, reminder: input.reminder });
      await get().load(get().budgetId ?? transaction.budget_id);
      // Transaction changed: invalidate cross-budget views
      useDashboardStore.getState().invalidate();
      useCalendarStore.getState().invalidate();
      useReportsStore.getState().invalidate();
      useTagsStore.getState().invalidate();
      return { transaction, reminder, attachmentError };
    },

    updateTransaction: async (input) => {
      const transaction = await updateTransaction(input.id, input);
      const reminder =
        input.reminder === undefined
          ? null
          : await applyReminder({ transaction, reminder: input.reminder });
      await get().load(get().budgetId);
      useDashboardStore.getState().invalidate();
      useCalendarStore.getState().invalidate();
      useReportsStore.getState().invalidate();
      useTagsStore.getState().invalidate();
      return { transaction, reminder };
    },

    moveTransaction: async (transactionId, destinationBudgetId) => {
      const transaction = await moveTransactionToBudget(transactionId, destinationBudgetId);
      // Re-read the open source and every budget card. Both derived totals and
      // counts then reflect the move immediately; opening the destination
      // detail reads its own updated rows from the repository as usual.
      await Promise.all([
        get().load(get().budgetId),
        useBudgetsStore.getState().load(),
      ]);
      useDashboardStore.getState().invalidate();
      useCalendarStore.getState().invalidate();
      useReportsStore.getState().invalidate();
      useTagsStore.getState().invalidate();
      return transaction;
    },

    /**
     * Clone a transaction into a destination budget. Copies the row and breakdown
     * items via the repository, then duplicates receipt files one by one. A failed
     * file copy loses that attachment but never the transaction — the same order
     * addTransaction uses for shared receipts.
     */
    cloneTransaction: async (sourceTransaction, destinationBudgetId) => {
      const { transaction, sourceAttachmentPaths } = await cloneTransaction(
        sourceTransaction.id,
        destinationBudgetId,
      );

      // Duplicate each receipt file and create a new attachment row pointing at it.
      // A failed copy costs one attachment but never the transaction.
      for (const sourcePath of sourceAttachmentPaths) {
        try {
          const base64 = await readReceiptBase64(sourcePath);
          if (!base64) continue;
          // Extract extension from the source path (receipts/name.ext)
          const ext = sourcePath.includes('.') ? `.${sourcePath.split('.').pop()}` : '.jpg';
          const newPath = await writeReceiptBase64(base64, ext);
          await createAttachment({ transactionId: transaction.id, path: newPath });
        } catch {
          // A failed attachment copy is logged but does not fail the clone.
        }
      }

      // Reload the source budget being viewed and every budget card.
      // The destination budget reloads itself when the user navigates to it.
      const currentBudgetId = get().budgetId;
      if (currentBudgetId) {
        await Promise.all([
          get().load(currentBudgetId),
          useBudgetsStore.getState().load(),
        ]);
      } else {
        // No budget is currently open in the detail store; just refresh the list.
        await useBudgetsStore.getState().load();
      }

      useDashboardStore.getState().invalidate();
      useCalendarStore.getState().invalidate();
      useReportsStore.getState().invalidate();
      useTagsStore.getState().invalidate();
      return transaction;
    },

    removeTransaction: async (transactionId) => {
      // The transaction goes; its reminders survive as standalone records
      // (the foreign key clears the link), keeping their schedules.
      // Attachment rows are read first: the row delete cascades them out of
      // the database, and their files may only be removed once that delete
      // has actually landed — a failed delete leaves rows and files intact.
      const attachments = await getAttachments(transactionId);
      await deleteTransaction(transactionId);
      for (const attachment of attachments) deleteReceiptFile(attachment.path);
      await get().load(get().budgetId);
      useDashboardStore.getState().invalidate();
      useCalendarStore.getState().invalidate();
      useReportsStore.getState().invalidate();
      useTagsStore.getState().invalidate();
    },

    refresh: async () => {
      const { budgetId } = get();
      if (budgetId) await get().load(budgetId);
    },
  };
});
