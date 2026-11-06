/**
 * Move one existing parent row between active budgets without rebuilding it.
 * Tags live on the parent, while breakdowns, attachments and reminders point
 * at its unchanged id, so one scoped update preserves the entire record.
 * The explicit store keeps the operation identical on SQLite and memory/web.
 */
export async function moveTransactionToBudget(store, id, budgetId) {
  if (!budgetId) throw new Error('Choose a destination budget.');

  const existing = await store.getTransaction(id);
  if (!existing) throw new Error('That transaction no longer exists.');
  if (existing.budget_id === budgetId) throw new Error('Choose a different budget.');

  const destination = await store.getBudget(budgetId);
  if (!destination || destination.deleted_at != null) {
    throw new Error('That destination budget is not available.');
  }

  await store.beginTransaction();
  try {
    const changed = await store.setTransactionBudget(id, budgetId);
    if (changed !== 1) throw new Error('That transaction no longer exists.');
    await store.commitTransaction();
  } catch (error) {
    try {
      await store.rollbackTransaction();
    } catch {
      // Keep the original failure; the engine may already have rolled back.
    }
    throw error;
  }

  return store.getTransaction(id);
}
