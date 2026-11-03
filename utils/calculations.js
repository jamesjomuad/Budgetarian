/**
 * Every financial calculation lives here so no screen re-implements business
 * rules. All amounts are integer minor units.
 *
 * Core rule: transfers move money between accounts and must never affect
 * income, expenses, or total assets. A Budget has no spending limit, so there
 * is no overspend state anywhere in this module: "spent" is always just the
 * expense transactions recorded against it.
 *
 * Money rule: only settled money moves a cash figure. An expense or income
 * counts toward `income`, `expense`, `remaining`, account balances, budget
 * spend and every other actual total only once its payment status is Paid;
 * an unpaid row is recorded but has not moved, so it is held apart as
 * outstanding — `expectedIncome` (money owed to you) and `expectedExpense`
 * (money you still owe). Nothing outstanding is ever folded into an actual
 * balance, and nothing is hidden: `recordedIncome` and `recordedExpense`
 * carry the full recorded picture for shares, charts and exports. Legacy rows
 * with no stored status read as settled, so pre-existing data is unchanged.
 * This is the single place those rules live — screens, stores, adapters and
 * reports all call through here (the adapters mirror `spent`/`income` in SQL
 * and memory for the budget list, under the same rule).
 */

import { effectivePaymentStatus, isSettled } from './paymentStatus';

/**
 * Headline money totals for a set of transactions.
 *
 * Actual (cash that has moved):
 *   - `income`       received money: paid income plus legacy rows with no status
 *   - `expense`      money spent: paid expenses plus the same legacy rows
 *   - `remaining`    `income - expense`, the real balance for this set
 *
 * Outstanding (recorded, not yet moved):
 *   - `expectedIncome`  unpaid income — expected, never presented as received
 *   - `expectedExpense` unpaid expenses — obligations, never presented as spent
 *
 * Recorded (everything, for shares and exports):
 *   - `recordedIncome`  = income + expectedIncome
 *   - `recordedExpense` = expense + expectedExpense
 *
 * Transfers are ignored entirely: they move money between accounts without
 * creating or spending any.
 */
export function computeTotals(transactions) {
  let income = 0;
  let expectedIncome = 0;
  let expense = 0;
  let expectedExpense = 0;

  for (const transaction of transactions) {
    if (transaction.type === 'income') {
      if (isSettled(transaction)) income += transaction.amount;
      else expectedIncome += transaction.amount;
    } else if (transaction.type === 'expense') {
      if (isSettled(transaction)) expense += transaction.amount;
      else expectedExpense += transaction.amount;
    }
  }

  return {
    income,
    expectedIncome,
    recordedIncome: income + expectedIncome,
    expense,
    expectedExpense,
    recordedExpense: expense + expectedExpense,
    remaining: income - expense,
    transactionCount: transactions.length,
  };
}

/**
 * Folder balance for one budget period: what it received minus what it
 * actually spent, in the same minor units as everything else. Both sides are
 * settled money only, so an unpaid expense never drags this figure down.
 * Negative is valid and simply means the period spent more than it earned.
 */
export function computeBudgetBalance(income = 0, spent = 0) {
  return income - spent;
}

export function computeAccountBalance(account, transactions) {
  let balance = account?.initial_balance ?? 0;

  for (const transaction of transactions) {
    const isSource = transaction.account_id === account.id;
    const isDestination = transaction.type === 'transfer' && transaction.to_account_id === account.id;

    if (isSource) {
      if (transaction.type === 'income') {
        // Unpaid income is not in the account yet; it cannot raise a balance.
        if (isSettled(transaction)) balance += transaction.amount;
      } else if (transaction.type === 'expense') {
        // Unpaid expense has not left the account either, so it cannot
        // lower a balance until it is marked Paid.
        if (isSettled(transaction)) balance -= transaction.amount;
      } else if (transaction.type === 'transfer') balance -= transaction.amount;
    }

    if (isDestination) balance += transaction.amount;
  }

  return balance;
}

export function computeTotalAssets(accounts, transactions) {
  return accounts.reduce(
    (total, account) => total + computeAccountBalance(account, transactions),
    0,
  );
}

/**
 * Expense spend per tag, keyed by tag id. Only settled expenses count, so
 * income, transfers and unpaid obligations never inflate a tag's total.
 */
export function computeSpendByTag(transactions, tags = []) {
  const totals = new Map();

  for (const transaction of transactions) {
    if (transaction.type !== 'expense') continue;
    if (!transaction.tag_id) continue;
    if (!isSettled(transaction)) continue;
    totals.set(transaction.tag_id, (totals.get(transaction.tag_id) ?? 0) + transaction.amount);
  }

  return tags.map((tag) => ({
    tag,
    spent: totals.get(tag.id) ?? 0,
  }));
}

/**
 * Per-tag budget breakdown in one pass: signed amount, settled expense amount,
 * and each tag's expense share of the budget's settled total expenses. Income
 * counts as a positive signed amount and expense as a negative one — both only
 * once settled, so an unpaid row never distorts a tag's bar — and transfers
 * never count: the same transfer rule as computeTotals. `computeSpendByTag`
 * stays expense-only for reports. A zero total expense, missing tag
 * reference, or tag with no transactions safely produces 0%.
 */
export function computeTagExpenseBreakdown(transactions, tags = [], totalExpense = 0) {
  const signedTotals = new Map();
  const expenseTotals = new Map();

  for (const transaction of transactions) {
    if (!transaction.tag_id) continue;

    if (transaction.type === 'income') {
      if (!isSettled(transaction)) continue;
      signedTotals.set(transaction.tag_id, (signedTotals.get(transaction.tag_id) ?? 0) + transaction.amount);
    } else if (transaction.type === 'expense') {
      if (!isSettled(transaction)) continue;
      const current = expenseTotals.get(transaction.tag_id) ?? 0;
      expenseTotals.set(transaction.tag_id, current + transaction.amount);
      signedTotals.set(transaction.tag_id, (signedTotals.get(transaction.tag_id) ?? 0) - transaction.amount);
    }
  }

  return tags.map((tag) => {
    const expense = expenseTotals.get(tag.id) ?? 0;
    return {
      tag,
      spent: signedTotals.get(tag.id) ?? 0,
      expense,
      expensePercent: totalExpense > 0 ? (expense / totalExpense) * 100 : 0,
    };
  });
}

/**
 * One transaction's share of the matching budget total. Expenses are measured
 * against total recorded expenses and income against total recorded income
 * (`recordedIncome`/`recordedExpense` from computeTotals when present, so
 * paid and unpaid rows of the same type share one ruler and no row can claim
 * more than 100%); transfers have no applicable share and return null so the
 * UI can hide them. Both totals come from computeTotals, keeping this formula
 * aligned with the budget summary.
 */
export function computeTransactionSharePercent(
  transaction,
  totals = { income: 0, expense: 0 },
) {
  if (!transaction || transaction.type === 'transfer') return null;

  const total =
    transaction.type === 'income'
      ? totals.recordedIncome ?? totals.income
      : transaction.type === 'expense'
        ? totals.recordedExpense ?? totals.expense
        : 0;

  if (!Number.isFinite(total) || total <= 0) return 0;
  if (!Number.isFinite(transaction.amount) || transaction.amount <= 0) return 0;

  return (transaction.amount / total) * 100;
}

/**
 * Ids of every tag actually referenced by a transaction in the given set,
 * across income and expense alike. Used to hide tags a budget never touches:
 * membership here is decided by real transaction references, never by whether
 * a tag merely exists in the global library. Transactions with no tag, or with
 * a tag that no longer resolves, contribute nothing and can't crash a lookup.
 */
export function collectUsedTagIds(transactions) {
  const ids = new Set();

  for (const transaction of transactions) {
    if (transaction.tag_id) ids.add(transaction.tag_id);
  }

  return ids;
}

/** Groups transactions by date, preserving the order they were passed in. */
export function groupByDate(transactions) {
  const groups = new Map();

  for (const transaction of transactions) {
    const key = transaction.transaction_date;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(transaction);
  }

  return Array.from(groups, ([date, items]) => ({ date, items }));
}

export function sumAmounts(items, selectAmount = (item) => item.amount) {
  return items.reduce((total, item) => total + selectAmount(item), 0);
}