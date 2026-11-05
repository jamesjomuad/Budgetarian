import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo } from "react";
import { Alert, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { DailyTimeline } from "../../components/calendar/DailyTimeline";
import { MonthCalendar } from "../../components/calendar/MonthCalendar";
import { tabBandHeight } from "../../components/navigation/tabBand";
import { Card } from "../../components/ui/Card";
import { Screen } from "../../components/ui/Screen";
import { useTheme } from "../../components/ui/ThemeProvider";
import { useCalendarStore } from "../../stores/calendarStore";
import { useRemindersStore } from "../../stores/remindersStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useTagsStore } from "../../stores/tagsStore";
import { showToast } from "../../stores/toastStore";
import { effectivePaymentStatus } from "../../utils/paymentStatus";
import {
  isValidReminderTime,
  REMINDER_SNOOZE_MINUTES,
} from "../../utils/reminders";

const KIND_ORDER = { expense: 0, income: 1, reminder: 2 };

/**
 * Chronological order for one day. An entry with no recorded time is an
 * all-day row and leads its date; timed entries follow by clock, mixing
 * reminders and time-stamped transactions. Ties fall back to kind, then
 * creation time, then id, so two records with the same instant are always
 * kept and never swap places between renders.
 */
function compareActivities(a, b) {
  if (a.hasTime !== b.hasTime) return a.hasTime ? 1 : -1;
  if (a.hasTime && a.time !== b.time) return a.time < b.time ? -1 : 1;
  if (a.kind !== b.kind) return KIND_ORDER[a.kind] - KIND_ORDER[b.kind];

  const createdA = String(a.createdAt ?? "");
  const createdB = String(b.createdAt ?? "");
  if (createdA !== createdB) return createdA < createdB ? -1 : 1;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

export default function CalendarScreen() {
  const { spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  // Below this height the fixed month grid starts crowding out the timeline,
  // so the grid switches to its compact cell size.
  const compactCalendar = windowHeight < 700;
  const currency = useSettingsStore((state) => state.currency);
  const tags = useTagsStore((state) => state.tags);
  const loadTags = useTagsStore((state) => state.load);

  const monthKey = useCalendarStore((state) => state.monthKey);
  const selectedDate = useCalendarStore((state) => state.selectedDate);
  const transactions = useCalendarStore((state) => state.transactions);
  const monthReminders = useCalendarStore((state) => state.reminders);
  const purchases = useCalendarStore((state) => state.purchases);
  const paymentParents = useCalendarStore((state) => state.paymentParents);
  const load = useCalendarStore((state) => state.load);
  const setMonth = useCalendarStore((state) => state.setMonth);
  const selectDate = useCalendarStore((state) => state.selectDate);

  const dayCache = useRemindersStore((state) => state.dayCache);
  const reminderDate = useRemindersStore((state) => state.dayDate);
  const remindersLoading = useRemindersStore((state) => state.dayIsLoading);
  const loadDay = useRemindersStore((state) => state.loadDay);
  const completeReminder = useRemindersStore((state) => state.completeReminder);
  const snoozeReminder = useRemindersStore((state) => state.snoozeReminder);

  // One stable edit handler for every timeline row (rows carry their own
  // budget_id), so memoized rows can skip re-rendering untouched items.
  const handleEditTransaction = useCallback(
    (entry) =>
      router.push({
        pathname: "/transaction/form",
        params: {
          budgetId: entry.budget_id,
          transactionId: entry.id,
        },
      }),
    [],
  );

  const openReminder = useCallback((reminder) => {
    router.push({ pathname: "/reminder/form", params: { reminderId: reminder.id } });
  }, []);

  const addReminder = useCallback(() => {
    router.push({ pathname: "/reminder/form", params: { date: selectedDate } });
  }, [selectedDate]);

  const handleCompleteReminder = useCallback(
    (reminder) => {
      Alert.alert(
        "Mark as completed?",
        "The reminder stops notifying and moves to Completed.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Mark completed",
            onPress: async () => {
              try {
                await completeReminder(reminder.id);
                showToast("Reminder completed", "success");
              } catch (error) {
                showToast(error?.message ?? "Couldn't complete the reminder.", "error");
              }
            },
          },
        ],
      );
    },
    [completeReminder],
  );

  const handleSnoozeReminder = useCallback(
    async (reminder) => {
      try {
        const outcome = await snoozeReminder(reminder.id);
        if (outcome?.status === "failed") {
          showToast("Reminder moved, but its notification couldn't be scheduled.", "warning");
        } else if (outcome?.status === "blocked") {
          showToast("Reminder moved, but notifications are blocked.", "warning");
        } else if (outcome?.status === "unsupported") {
          showToast("Reminder moved; notifications are unavailable here.", "warning");
        } else if (outcome?.status !== "skipped") {
          showToast(`Reminder postponed ${REMINDER_SNOOZE_MINUTES} minutes`, "success");
        }
      } catch (error) {
        showToast(error?.message ?? "Couldn't postpone the reminder.", "error");
      }
    },
    [snoozeReminder],
  );

  // Reload the visible month on focus so edits made elsewhere show up; the
  // store keeps the selection when it still belongs to that month. The day
  // reminders are re-read as well: archiving or restoring a budget on another
  // screen must not leave that budget's reminders here.
  useFocusEffect(
    useCallback(() => {
      load();
      loadTags();
      loadDay(useCalendarStore.getState().selectedDate, { force: true });
    }, [load, loadTags, loadDay]),
  );

  // The reminder list is scoped to one date at a time: changing the selection
  // claims the scope and re-reads, so a stale day can never show under another
  // day's heading.
  useEffect(() => {
    loadDay(selectedDate);
  }, [loadDay, selectedDate]);

  // Dots mark every kind of visible activity: financial rows, breakdown
  // purchases, and scheduled payments alike. The timeline itself lists the
  // three user-facing activity types (expenses, income and reminders).
  const activityDates = useMemo(
    () =>
      new Set([
        ...transactions.map((entry) => entry.transaction_date),
        ...purchases.map((item) => item.purchase_date),
        ...paymentParents.map((entry) => entry.payment_due_date),
      ]),
    [transactions, purchases, paymentParents],
  );
  const reminderDates = useMemo(
    () => new Set(monthReminders.map((reminder) => reminder.remind_date)),
    [monthReminders],
  );

  // Results are cached per date; a date that was never fetched renders empty
  // until its first load lands.
  const remindersForDay = useMemo(
    () => dayCache[selectedDate] ?? [],
    [dayCache, selectedDate],
  );
  const dayLoading = remindersLoading && reminderDate === selectedDate;
  const tagById = useMemo(() => new Map(tags.map((tag) => [tag.id, tag])), [tags]);

  const activities = useMemo(() => {
    const rows = [];

    for (const entry of transactions) {
      if (entry.transaction_date !== selectedDate) continue;
      if (entry.type !== "expense" && entry.type !== "income") continue;

      const tag = tagById.get(entry.tag_id);
      rows.push({
        key: `transaction-${entry.id}`,
        kind: entry.type,
        id: entry.id,
        transaction: entry,
        reminder: null,
        hasTime: Boolean(entry.time),
        time: entry.time ?? null,
        createdAt: entry.created_at,
        title: entry.description || tag?.name || "Transaction",
        budgetName: entry.budget_name || null,
        metaDescription: null,
        // Payment status belongs to expenses only here; income rows carry
        // their type and amount without a status that does not apply.
        paymentStatus:
          entry.type === "expense" ? effectivePaymentStatus(entry) : null,
      });
    }

    for (const reminder of remindersForDay) {
      const hasTime = isValidReminderTime(reminder.remind_time);
      rows.push({
        key: `reminder-${reminder.id}`,
        kind: "reminder",
        id: reminder.id,
        transaction: null,
        reminder,
        hasTime,
        time: hasTime ? reminder.remind_time : null,
        createdAt: reminder.created_at,
        title: reminder.notes || reminder.description || "Reminder",
        budgetName: reminder.budget_name || null,
        metaDescription:
          reminder.notes && reminder.description ? reminder.description : null,
        paymentStatus: null,
      });
    }

    rows.sort(compareActivities);
    return rows;
  }, [transactions, selectedDate, tagById, remindersForDay]);

  return (
    <Screen scroll={false} topInset>
      <View
        style={{
          paddingHorizontal: spacing.lg,
          paddingTop: (compactCalendar ? spacing.md : spacing.lg) + insets.top,
        }}
      >
        <Card>
          <MonthCalendar
            compact={compactCalendar}
            monthKey={monthKey}
            selectedDate={selectedDate}
            activityDates={activityDates}
            reminderDates={reminderDates}
            onChangeMonth={setMonth}
            onSelectDate={selectDate}
          />
        </Card>
      </View>

      <DailyTimeline
        selectedDate={selectedDate}
        activities={activities}
        currency={currency}
        isLoading={dayLoading}
        onAddReminder={addReminder}
        onEditTransaction={handleEditTransaction}
        onOpenReminder={openReminder}
        onCompleteReminder={handleCompleteReminder}
        onSnoozeReminder={handleSnoozeReminder}
        bottomSpace={tabBandHeight(insets.bottom, spacing)}
      />
    </Screen>
  );
}
