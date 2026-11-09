import { router } from 'expo-router';
import { useEffect, useRef } from 'react';

import {
  REMINDER_ACTION_COMPLETE,
  REMINDER_ACTION_SNOOZE,
  clearLastResponseAsync,
  dismissAsync,
  getLastResponseAsync,
  subscribeToResponses,
} from '../../services/notificationService';
import { useRemindersStore } from '../../stores/remindersStore';

/** True for a payload id that can name a stored row. */
function isId(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Turns a tapped Budgetarian notification into a route, and an action-button
 * response into a persisted reminder change.
 *
 *   "Complete" action      → completeReminder(id), then the reminder's
 *                            linked Transaction detail — or the Calendar
 *                            tab when the transaction no longer exists
 *   "Remind Later" action  → snoozeReminder(id) — no navigation
 *   linked notification    → transactionId resolves the live parent Budget;
 *                            the scheduled payload's budgetId is the fallback
 *   standalone reminder    → data.reminderId only  → reminder form
 *
 * expo-notifications offers no headless JS for notification actions without
 * expo-task-manager (not installed), so an action pressed while the app is
 * closed launches Budgetarian: `getLastResponseAsync` catches that launch
 * response and the live listener catches warm ones. The completion is
 * persisted through the store first (SQLite is the source of truth), then
 * the notification that carried the button press is dismissed by its own
 * identifier — cancelling its scheduled twin happens through the row's
 * `notification_id` mapping inside reminderService, and only THAT
 * notification is ever touched, so sibling reminders of the same
 * transaction keep working.
 *
 * Deduplication is per response AND per kind: a body tap and a Complete
 * press on the same notification are different keys (one shared key used
 * to swallow the second interaction), while the same action delivered by
 * both cold start and the listener runs exactly once. Two distinct physical
 * body taps (different response date) still navigate again, so a missed
 * jump can be retried from the tray.
 *
 * Navigation resolves the Transaction through the completed reminder's
 * transaction_id, falling back to the scheduled payload; a deleted
 * transaction, a missing budget link, or a vanished reminder lands on
 * Calendar instead of a broken detail screen. The response is cleared
 * once handled, so reopening the app never replays a jump, completion,
 * or snooze.
 */
export function NotificationTapHandler() {
  const handledRef = useRef(new Set());

  useEffect(() => {
    let active = true;

    /**
     * Land a completed reminder on its own transaction detail — the user
     * tapped "Complete" on a specific reminder, so show them what it belongs
     * to. Resolve the transaction from the row first (the reminder may have
     * been moved since the notification was scheduled); fall back to the
     * payload's ids if the read fails; and land on Calendar when neither
     * can name a live transaction.
     */
    async function openCompletedReminder(reminder, data) {
      const transactionId = reminder?.transaction_id ?? (isId(data.transactionId) ? data.transactionId : null);

      if (isId(transactionId)) {
        try {
          const transaction = await useRemindersStore.getState().fetchTransaction(transactionId);
          if (transaction) {
            const budgetId = transaction.budget_id ?? (isId(data.budgetId) ? data.budgetId : null);
            if (isId(budgetId)) {
              router.push({
                pathname: '/transaction/form',
                params: { budgetId, transactionId },
              });
              return;
            }
          }
        } catch {
          // Transaction vanished between action and read; fall through.
        }
      }

      router.navigate('/calendar');
    }

    function handleAction(response, data, key) {
      const action = response?.actionIdentifier;
      if (!isId(data.reminderId)) return false;
      if (action !== REMINDER_ACTION_COMPLETE && action !== REMINDER_ACTION_SNOOZE) {
        return false;
      }

      const actionKey = `${key}:${action}`;
      if (handledRef.current.has(actionKey)) return true;
      handledRef.current.add(actionKey);

      const notificationId = response?.notification?.request?.identifier;
      const store = useRemindersStore.getState();

      if (action === REMINDER_ACTION_SNOOZE) {
        store
          .snoozeReminder(data.reminderId)
          .catch(() => {
            // Stale row (deleted or already handled elsewhere): there is
            // nothing to persist. resyncReminders reconciles at next launch.
          })
          .finally(() => clearLastResponseAsync());
        return true;
      }

      store
        .completeReminder(data.reminderId)
        .then((outcome) => {
          void openCompletedReminder(outcome?.reminder, data);
        })
        .catch(() => {
          // Row gone: nothing left to complete, but the payload's transaction
          // may still be a valid destination; openCompletedReminder validates.
          void openCompletedReminder(null, data);
        })
        .finally(() => {
          // Dismiss exactly the notification that carried this press,
          // then clear the launch response so it cannot replay.
          if (notificationId) void dismissAsync(notificationId);
          clearLastResponseAsync();
        });
      return true;
    }

    async function openLinkedTransaction(data) {
      let budgetId = data.budgetId;
      try {
        // An already-armed notification still carries the budget id from when
        // it was scheduled. Resolve the unchanged transaction id so a later
        // move opens its current budget without touching the reminder or OS
        // schedule; the payload remains a fallback if that read fails.
        const transaction = await useRemindersStore
          .getState()
          .fetchTransaction(data.transactionId);
        if (transaction) budgetId = transaction.budget_id;
      } catch {
        // Keep the original payload as a best-effort route on a read failure.
      }
      if (isId(budgetId)) {
        router.push({
          pathname: '/transaction/form',
          params: { budgetId, transactionId: data.transactionId },
        });
      }
      clearLastResponseAsync();
    }

    function open(response) {
      const request = response?.notification?.request;
      const data = request?.content?.data;
      if (!data || data.source !== 'moneyq') return;

      const identifier = request.identifier ?? `${data.reminderId}:${data.transactionId}`;

      if (handleAction(response, data, identifier)) return;

      // Body taps deduplicate per physical interaction, so one tap seen by
      // both the cold-start read and the listener navigates once, while a
      // genuine second tap still navigates again.
      const bodyKey = `${identifier}:body:${response?.date?.getTime?.() ?? ''}`;
      if (handledRef.current.has(bodyKey)) return;
      handledRef.current.add(bodyKey);

      if (isId(data.transactionId) && isId(data.budgetId)) {
        void openLinkedTransaction(data);
        return;
      }
      if (isId(data.reminderId)) {
        router.push({
          pathname: '/reminder/form',
          params: { reminderId: data.reminderId },
        });
        clearLastResponseAsync();
      }
    }

    // Cold start: the tap happened before this component existed.
    getLastResponseAsync().then((response) => {
      if (active && response) open(response);
    });

    // Warm start: tapped while the app was already running.
    const unsubscribe = subscribeToResponses(open);

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  return null;
}
