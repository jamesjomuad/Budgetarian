/**
 * Payment status of an expense or an income. It is deliberately separate
 * from the transaction `type`: an unpaid expense is still a recorded expense
 * — it stays in every list, count and export — but it has not left the
 * account yet, so it never moves a cash figure. Unpaid income is money
 * expected, not yet received, and reads the same way. Totals read the two
 * apart: settled money as actual, unsettled money as outstanding. The
 * status only answers "has the money moved yet?". Transfers never carry
 * one: a move between accounts is not a payment to wait for.
 */
export const PAYMENT_STATUSES = ['unpaid', 'paid'];

export function isValidPaymentStatus(value) {
  return PAYMENT_STATUSES.includes(value);
}

/**
 * The status a NEW expense or income starts with when the caller does not
 * choose one. Paid-first: most recorded entries are completed money
 * movements, so the default should match the usual case while still
 * allowing an entry to be marked Unpaid.
 */
export function defaultPaymentStatus(value) {
  return isValidPaymentStatus(value) ? value : 'paid';
}

/**
 * How a stored row's status should be read. Missing or invalid values on an
 * expense or income fall back to 'paid' — entries recorded before a type
 * carried this field behaved as settled money (they moved every total),
 * and nothing in the UI may crash on an unexpected value. Transfers have
 * no payment status at all and return null.
 */
export function effectivePaymentStatus(row) {
  if (!row || row.type === 'transfer') return null;
  return isValidPaymentStatus(row.payment_status) ? row.payment_status : 'paid';
}

/**
 * The one test every cash figure asks before a row may move it: has this
 * expense or income actually settled? Only settled rows change the remaining
 * balance, account balances, budget spend or any other actual total; an
 * unpaid row is recorded and stays visible but never touches those numbers
 * until it flips to Paid. A missing or legacy status reads as settled, so
 * rows written before the field existed keep behaving exactly as they did.
 *
 * Transfers never settle this way — they have no status and are ruled by
 * their own "always moves money" rule, so callers handle them separately.
 */
export function isSettled(row) {
  return effectivePaymentStatus(row) === 'paid';
}

export const PAYMENT_OPTIONS = [
  { value: 'unpaid', label: 'Unpaid', icon: 'clock' },
  { value: 'paid', label: 'Paid', icon: 'paid' },
];

/**
 * Payment events for the Calendar. A parent with a `payment_due_date` shows
 * one all-day event; its lifecycle label comes from the existing payment
 * status and the due date alone — never from the budget period or a child's
 * purchase date. Paid wins over everything: a paid commitment is 'Paid'
 * whether it settled early, on the day, or late.
 */
export const PAYMENT_EVENT_LABELS = {
  upcoming: 'Upcoming',
  dueToday: 'Due today',
  overdue: 'Overdue',
  paid: 'Paid',
};

/**
 * 'YYYY-MM-DD' comparison against a local today — ISO dates sort as strings,
 * and both sides are built by the same local-date rule, so no time zones are
 * involved. Returns null when the row has no due date or is not a financial
 * event the Calendar should surface.
 */
export function derivePaymentEventStatus(row, todayIso) {
  const due = row?.payment_due_date;
  if (!due) return null;
  if (effectivePaymentStatus(row) === 'paid') return 'paid';
  if (due < todayIso) return 'overdue';
  if (due === todayIso) return 'dueToday';
  return 'upcoming';
}
