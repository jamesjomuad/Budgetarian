/**
 * Optional time-of-day and free-text notes on a transaction.
 *
 *   `transactions.time`  — the local wall-clock time the entry was made,
 *                          'HH:mm' like every other time the app stores.
 *   `transactions.notes` — extra context beside the short `description`.
 *
 * Both are nullable with no default: rows written before this migration keep
 * NULL, so a legacy transaction never gains an invented time or a fabricated
 * note. An ALTER is the only safe shape here — it appends to whatever table
 * the upgrade chain has built by version 16 without re-copying any row.
 */
export const migration = {
  version: 16,
  name: 'transaction_time_notes',

  async up(db) {
    await db.execAsync('ALTER TABLE transactions ADD COLUMN time TEXT;');
    await db.execAsync('ALTER TABLE transactions ADD COLUMN notes TEXT;');
  },
};
