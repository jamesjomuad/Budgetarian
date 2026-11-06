# Calendar Transaction Navigation Fix Report

Date: 2026-11-06

## Outcome

The blocked Back action was caused by an inconsistent dirty-state snapshot in the shared Transaction edit form, not by Calendar parameters, a nested navigator, a missing route, or an Expo Go hardware-Back failure.

The fix is limited to the existing departure guard in `app/transaction/form.jsx`. Calendar and Budget navigation were not rewritten.

## Navigation trace

### Calendar entry point

- `app/(tabs)/calendar.jsx` passes `budgetId: entry.budget_id` and `transactionId: entry.id` to `/transaction/form` with one `router.push()` call.
- `components/calendar/DailyTimeline.jsx` invokes that handler from one transaction-row `Pressable`; there is no second transaction navigation action on the same tap.
- The parameters are identifiers, not a partial transaction object. The form looks up the transaction by ID in the budget-detail store and requests the budget when it is not already loaded.

### Budget entry point

- `app/budget/[id].jsx` pushes the same `/transaction/form` route with the equivalent `budgetId` and `transactionId` parameters.
- Calendar therefore does not need a new navigation helper or a separate route mechanism.

### Route and Back handling

- `app/_layout.jsx` registers `transaction/form` on the root native Stack with `presentation: "modal"` and a bottom-slide animation.
- The Transaction screen changes only its header title. It has no custom header-Back implementation or Transaction-specific Android `BackHandler`.
- Both native header Back and Android hardware Back dispatch navigation actions intercepted by the form's `usePreventRemove` departure guard.
- Calendar has no custom Back handler. Its focus effect reloads visible data but does not replace the route or reset the selected month/date.

## Root cause

`formSnapshot()` and `snapshotOfRow(editing)` include the persisted `time` and `notes` fields. The separate auto-save snapshot also included both fields.

The `currentSnapshot` used to arm `usePreventRemove`, however, omitted both fields:

- An untouched hydrated edit therefore produced a current snapshot different from the saved-row snapshot.
- `preventLeave` remained `true` even though the form was clean.
- The auto-save effect correctly calculated that there were no changes and returned without installing `leaveHandlerRef.current`.
- A Back action was consequently prevented, while the guard callback called an empty handler. There was no `repeat()`, save, alert, or navigation, so Back appeared to do nothing.

This defect was in the shared edit form and was caller-independent. Calendar made it visible; the same clean-state guard could also affect a transaction opened from Budget.

## Fix applied

In `app/transaction/form.jsx`:

1. Added `time` and `notes` to the `currentSnapshot` object's `formSnapshot()` input.
2. Added `time` and `notes` to that `useMemo` dependency array.

The departure guard and auto-save effect now compare the same persisted fields:

- **Unchanged transaction:** snapshots match, `preventLeave` is false, and the native Back action dismisses the modal without a write.
- **Valid edited transaction:** the guard holds the action, auto-save runs once, and `repeat()` re-dispatches the original Back action after a successful save.
- **Time-only or Notes-only edit:** the guard is now reactive to the edit and preserves the existing save-before-departure behavior.
- **Missing/deleted transaction:** the guard remains inactive because there is no hydrated edit; the existing “Transaction not found” state and its Back action remain unchanged.

No arbitrary delay, forced `/calendar` replacement, duplicate navigation helper, new Back handler, or navigation-loop workaround was added.

## Calendar state preservation

The Transaction form remains a modal above the existing root Stack. Repeating the original Back action pops that modal rather than navigating to Home or constructing a new Calendar route.

The existing implementation therefore retains the underlying Calendar route and its state:

- Selected date and current month remain in `useCalendarStore`.
- Calendar's focus callback reloads data without resetting either value.
- `DailyTimeline` resets scroll offset only when `selectedDate` changes, not when focus returns or data reloads.
- Existing Calendar screen-local UI state remains mounted beneath the modal.

Actual Android confirmation of scroll/timeline restoration is still required; this preservation conclusion is based on the route and component lifecycle, not a device measurement.

## Affected files

- `app/transaction/form.jsx` — aligned the departure-guard snapshot and dependencies with the complete auto-save snapshot.
- `CHANGELOG.md` — documented the fix under `[Unreleased]` → `Fixed`.
- `constants/changelogMeta.js` — regenerated from the changelog.
- `NAVIGATION_FIX_REPORT.md` — this investigation and verification record.

Inspected but not modified: `app/(tabs)/calendar.jsx`, `components/calendar/DailyTimeline.jsx`, `app/budget/[id].jsx`, and `app/_layout.jsx`.

No database schema, transaction business rule, dependency, route presentation, or unrelated navigation flow was changed.

## Verification actually executed

| Check | Result |
| --- | --- |
| `npm run verify:db` | **428 passed, 0 failed**; SQLite/memory parity checks passed |
| `npx expo lint` | Passed with no lint errors |
| One-off Node snapshot-consistency assertion | Passed; guard and auto-save field lists match, including reactive Time and Notes |
| `npm run gen:changelog` | Passed; metadata regenerated |
| `npm run verify:changelog` | **27/27 checks passed** |
| `git diff --check` | Passed; only normal Windows LF-to-CRLF warnings were printed |

The snapshot-consistency assertion was a static source regression check, not an automated navigation runtime test.

## Android reproduction matrix

No Android device or ADB connection was available, and the project has no existing automated navigation test suite. The following cases are **pending device verification**, not claimed as executed:

1. Open Calendar, open an unchanged Expense, then use header Back; expect the same Calendar date/month/timeline.
2. Repeat the unchanged Expense case with Android hardware Back.
3. Open an unchanged Income and go back using both Back methods.
4. Open an unchanged Transfer and go back using both Back methods.
5. Change the Calendar date, open a transaction, and return; expect the newly selected date and its month to remain selected.
6. Open several transactions sequentially and return after each; expect one modal dismissal per Back action and no stacking loop.
7. Edit a transaction with valid changes and go back; expect one auto-save followed by return to Calendar.
8. Change only Time, then only Notes, and go back; expect the edits to save before return.
9. Restore any edited values to their saved values and go back; expect no write and immediate return.
10. Open Calendar's transaction from a different month, scroll the timeline, open it, and return; verify the actual timeline offset on device.
11. Repeat equivalent clean and edited cases from Budget; expect the same shared-form behavior and return to that Budget.
12. Open a transaction that was deleted or is otherwise unavailable; expect the existing not-found state and a working Back action.

For edit mode, the existing UI auto-saves on departure; it has no separate Cancel-edit button. This fix preserves that behavior rather than introducing discard/cancel semantics.

## Remaining limitations

- Header Back, Android hardware Back, sequential navigation, and Calendar scroll restoration have not been physically exercised in Expo Go.
- Static analysis identifies the exact blocked-action/no-op-handler mechanism, but only the Android matrix above can confirm the user-visible resolution across all transaction types and editing paths.
- No unrelated navigation or Expo Go runtime issue was investigated or changed as part of this targeted fix.
