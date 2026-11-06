import { nowIso } from '../../utils/id';

/**
 * Moves one existing budget between the root list and a folder without
 * rebuilding it. Only `folder_id` and `updated_at` change, so its id, period,
 * color, position, archive state, transactions, breakdown items, tags,
 * reminders and attachments stay exactly as they were.
 *
 * The explicit store keeps the operation identical on SQLite and memory/web.
 * Missing and archived sources, vanished destinations, and no-op moves are
 * rejected before writing. The update itself runs in a transaction so a
 * failure cannot leave a broken folder reference behind.
 */
export async function moveBudgetToFolder(store, id, folderId = null) {
  const current = await store.getBudget(id);
  if (!current) throw new Error('That budget no longer exists.');
  if (current.deleted_at != null) throw new Error('Restore the budget before moving it.');

  let nextFolderId = null;
  if (folderId != null) {
    const folder = await store.getFolder(folderId);
    if (!folder) throw new Error('That budget folder no longer exists.');
    nextFolderId = folder.id;
  }
  if ((current.folder_id ?? null) === nextFolderId) {
    throw new Error('Choose a different destination.');
  }

  await store.beginTransaction();
  try {
    await store.updateBudget({
      id,
      name: current.name,
      start_date: current.start_date,
      end_date: current.end_date,
      color: current.color ?? null,
      folder_id: nextFolderId,
      updated_at: nowIso(),
    });
    const moved = await store.getBudget(id);
    if (!moved || (moved.folder_id ?? null) !== nextFolderId) {
      throw new Error('The budget could not be moved. Please try again.');
    }
    await store.commitTransaction();
  } catch (error) {
    try {
      await store.rollbackTransaction();
    } catch {
      // Keep the original failure; the engine may already have rolled back.
    }
    throw error;
  }

  return store.getBudget(id);
}
