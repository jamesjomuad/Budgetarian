import { memo, useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from "react-native";

import { fontFamilies } from "../../constants/colors";
import { withAlpha } from "../../utils/color";
import { formatCurrency } from "../../utils/currency";
import { formatDate, formatTime, parseIsoDate, todayIso } from "../../utils/dates";
import { deriveReminderStatus } from "../../utils/reminders";
import { Icon } from "../ui/Icon";
import { Text } from "../ui/Text";
import { useTheme } from "../ui/ThemeProvider";

// Horizontal rhythm shared by every row and by the connector separators:
// time column, gap, timeline rail, then the activity card. The rail line and
// marker must line up exactly, so their offsets are derived from these three
// numbers rather than duplicated as magic values.
const TIME_WIDTH = 54;
const RAIL_GAP = 6;
const RAIL_WIDTH = 14;
const RAIL_CENTER = TIME_WIDTH + RAIL_GAP + RAIL_WIDTH / 2;
const MARKER_CENTER = 22;
const MARKER_SIZE = 12;

const KIND_LABELS = { expense: "Expense", income: "Income", reminder: "Reminder" };
const KIND_ICONS = { expense: "expense", income: "income", reminder: "clock" };
const REMINDER_STATUS_LABELS = {
  upcoming: "Pending",
  overdue: "Overdue",
  completed: "Completed",
};
const STATUS_ICONS = { upcoming: "clock", overdue: "warning", completed: "check" };
const PAYMENT_LABELS = { paid: "Paid", unpaid: "Unpaid" };
const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/**
 * The activities of the selected calendar day, newest state first in the
 * store but always rendered chronologically here. An entry with no recorded
 * time is an all-day row and leads its date; timed entries follow by clock,
 * with ties falling back to kind and id so identical timestamps keep every
 * record in a stable order.
 *
 * The month grid above this list never scrolls: the screen owns the fixed
 * calendar and this FlatList owns the vertical gesture. Virtualization keeps a
 * busy day cheap, and the list header (date + add action) scrolls away so the
 * timeline stays usable on short screens.
 */
export function DailyTimeline({
  selectedDate,
  activities,
  currency,
  isLoading,
  onAddReminder,
  onEditTransaction,
  onOpenReminder,
  onCompleteReminder,
  onSnoozeReminder,
  bottomSpace = 0,
}) {
  const { colors, radius, spacing } = useTheme();
  const listRef = useRef(null);

  // A new date must start at its first activity, not wherever the previous
  // day happened to be scrolled to.
  useEffect(() => {
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, [selectedDate]);

  const renderItem = useCallback(
    ({ item, index }) => (
      <TimelineRow
        activity={item}
        currency={currency}
        isFirst={index === 0}
        isLast={index === activities.length - 1}
        onEditTransaction={onEditTransaction}
        onOpenReminder={onOpenReminder}
        onCompleteReminder={onCompleteReminder}
        onSnoozeReminder={onSnoozeReminder}
      />
    ),
    [
      activities.length,
      currency,
      onCompleteReminder,
      onEditTransaction,
      onOpenReminder,
      onSnoozeReminder,
    ],
  );

  const countLabel = isLoading
    ? "Loading reminders…"
    : activities.length === 0
      ? "No activities"
      : `${activities.length} ${activities.length === 1 ? "activity" : "activities"}`;
  const parsedDate = parseIsoDate(selectedDate);
  const weekday = parsedDate ? WEEKDAYS[parsedDate.getDay()] : null;
  const isToday = selectedDate === todayIso();
  const subtitle = weekday ? `${weekday} · ${countLabel}` : countLabel;

  return (
    <FlatList
      ref={listRef}
      style={styles.list}
      data={activities}
      keyExtractor={(item) => item.key}
      renderItem={renderItem}
      ItemSeparatorComponent={TimelineSeparator}
      ListHeaderComponent={
        <View style={[styles.header, { paddingBottom: spacing.md }]}>
          <View style={styles.headerCopy}>
            <Text variant="title" accessibilityRole="header" numberOfLines={1}>
              {formatDate(selectedDate)}
            </Text>
            <View style={styles.subtitleRow}>
              {isToday ? (
                <View
                  style={[
                    styles.todayChip,
                    { backgroundColor: colors.primarySoft, borderRadius: radius.pill },
                  ]}
                >
                  <Text variant="caption" tone="primary">
                    Today
                  </Text>
                </View>
              ) : null}
              <Text variant="caption" tone="muted" numberOfLines={1} style={styles.subtitle}>
                {subtitle}
              </Text>
            </View>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add reminder"
            onPress={onAddReminder}
            hitSlop={4}
            style={({ pressed }) => [
              styles.addButton,
              {
                backgroundColor: colors.primarySoft,
                borderRadius: radius.pill,
                opacity: pressed ? 0.55 : 1,
              },
            ]}
          >
            <Icon name="add" size={16} color={colors.primary} />
            <Text variant="caption" tone="primary">
              Add
            </Text>
          </Pressable>
        </View>
      }
      ListEmptyComponent={<TimelineEmptyState isLoading={isLoading} />}
      contentContainerStyle={[
        styles.content,
        {
          paddingHorizontal: spacing.lg,
          paddingBottom: bottomSpace + spacing.lg,
        },
      ]}
      initialNumToRender={10}
      maxToRenderPerBatch={10}
      windowSize={7}
      showsVerticalScrollIndicator={false}
    />
  );
}

/** Connector between two cards; the line sits exactly under each marker. */
function TimelineSeparator() {
  const { colors } = useTheme();
  return (
    <View style={styles.separator}>
      <View style={[styles.separatorLine, { backgroundColor: colors.border }]} />
    </View>
  );
}

function TimelineEmptyState({ isLoading }) {
  const { colors, radius, spacing } = useTheme();

  if (isLoading) {
    return (
      <View style={styles.emptyLoading}>
        <ActivityIndicator size="small" color={colors.primary} />
        <Text variant="caption" tone="muted" style={{ marginTop: spacing.sm }}>
          Loading reminders…
        </Text>
      </View>
    );
  }

  // Deliberately compact instead of the shared EmptyState: the fixed calendar
  // and floating tab bar leave a short viewport, so generous vertical padding
  // would push the message underneath the navigation.
  return (
    <View style={[styles.empty, { paddingTop: spacing.xl }]}>
      <View
        style={[
          styles.emptyIcon,
          { backgroundColor: colors.surfaceMuted, borderRadius: radius.pill },
        ]}
      >
        <Icon name="calendar" size={26} color={colors.textFaint} />
      </View>
      <Text variant="heading" style={{ marginTop: spacing.md }}>
        Nothing scheduled
      </Text>
      <Text
        variant="body"
        tone="muted"
        style={{ marginTop: 6, textAlign: "center" }}
      >
        No expenses, income, or reminders for this date.
      </Text>
    </View>
  );
}

/**
 * One timeline entry. Memoized because the list rebuilds when the day
 * changes, but untouched rows should not re-render on every store update.
 * Reminder actions are siblings of the row press target, never nested.
 */
const TimelineRow = memo(function TimelineRow({
  activity,
  currency,
  isFirst,
  isLast,
  onEditTransaction,
  onOpenReminder,
  onCompleteReminder,
  onSnoozeReminder,
}) {
  const { colors, radius, spacing } = useTheme();
  const [actionsOpen, setActionsOpen] = useState(false);
  const isReminder = activity.kind === "reminder";
  const isExpense = activity.kind === "expense";
  const accent = isReminder
    ? colors.warning
    : isExpense
      ? colors.expense
      : colors.income;
  const kindIcon = KIND_ICONS[activity.kind] ?? "list";

  const title = activity.title;
  const amountText =
    isReminder || !activity.transaction
      ? null
      : `${activity.transaction.amount === 0 ? "" : isExpense ? "-" : "+"}${formatCurrency(
          activity.transaction.amount,
          { currency },
        )}`;

  const paymentLabel = activity.paymentStatus ? PAYMENT_LABELS[activity.paymentStatus] : null;
  const paymentColor = activity.paymentStatus === "unpaid" ? colors.warning : colors.income;

  const status = isReminder ? deriveReminderStatus(activity.reminder) : null;
  const statusLabel = status ? REMINDER_STATUS_LABELS[status] : null;
  const statusIcon = status ? STATUS_ICONS[status] : null;
  const statusColor =
    status === "completed"
      ? colors.income
      : status === "overdue"
        ? colors.expense
        : colors.warning;

  const metaSuffix = [activity.budgetName, activity.metaDescription]
    .filter(Boolean)
    .join(" · ");

  function open() {
    if (isReminder) {
      onOpenReminder(activity.reminder);
    } else {
      onEditTransaction(activity.transaction);
    }
  }

  const a11yParts = [
    KIND_LABELS[activity.kind],
    title,
    amountText,
    paymentLabel,
    statusLabel,
    activity.budgetName,
  ].filter(Boolean);

  return (
    <View style={styles.row}>
      <View style={[styles.timeColumn, { width: TIME_WIDTH, marginRight: RAIL_GAP }]}>
        <Text
          variant="caption"
          tone="muted"
          numberOfLines={1}
          style={{ marginTop: 15, fontVariant: ["tabular-nums"] }}
        >
          {activity.hasTime ? formatTime(activity.time) : "All day"}
        </Text>
      </View>

      <View style={[styles.rail, { width: RAIL_WIDTH }]}>
        {isFirst ? null : (
          <View
            style={[
              styles.railLine,
              { backgroundColor: colors.border, height: MARKER_CENTER, top: 0 },
            ]}
          />
        )}
        {isLast ? null : (
          <View
            style={[
              styles.railLine,
              { backgroundColor: colors.border, bottom: 0, top: MARKER_CENTER },
            ]}
          />
        )}
        <View
          style={[
            styles.marker,
            {
              backgroundColor: withAlpha(accent, 0.18),
              top: MARKER_CENTER - MARKER_SIZE / 2,
            },
          ]}
        >
          <View style={[styles.markerCore, { backgroundColor: accent }]} />
        </View>
      </View>

      <View
        style={[
          styles.card,
          {
            backgroundColor: colors.surface,
            borderColor: colors.border,
            borderRadius: radius.md,
            marginLeft: spacing.sm,
            padding: spacing.md,
          },
        ]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={a11yParts.join(", ")}
          accessibilityHint={
            isReminder ? "Opens reminder details" : "Opens transaction details"
          }
          onPress={open}
          style={({ pressed }) => [styles.cardPress, { opacity: pressed ? 0.65 : 1 }]}
        >
          <View style={styles.cardTop}>
            <View
              style={[
                styles.kindBadge,
                {
                  backgroundColor: withAlpha(accent, 0.12),
                  borderRadius: radius.sm,
                },
              ]}
            >
              <Icon name={kindIcon} size={16} color={accent} />
            </View>

            <View style={styles.copy}>
              <Text
                variant="body"
                numberOfLines={2}
                style={{ fontFamily: fontFamilies.semibold }}
              >
                {title}
              </Text>
              <View style={styles.metaRow}>
                <Text variant="caption" style={{ color: accent }}>
                  {KIND_LABELS[activity.kind]}
                </Text>
                {metaSuffix ? (
                  <Text
                    variant="caption"
                    tone="muted"
                    numberOfLines={1}
                    style={{ flexShrink: 1 }}
                  >
                    {` · ${metaSuffix}`}
                  </Text>
                ) : null}
              </View>
            </View>

            <View style={styles.right}>
              {isReminder ? (
                <View
                  style={[
                    styles.statusPill,
                    {
                      backgroundColor: withAlpha(statusColor, 0.13),
                      borderRadius: radius.pill,
                    },
                  ]}
                >
                  {statusIcon ? (
                    <Icon name={statusIcon} size={11} color={statusColor} />
                  ) : null}
                  <Text variant="caption" style={{ color: statusColor }}>
                    {statusLabel}
                  </Text>
                </View>
              ) : (
                <Text
                  variant="body"
                  numberOfLines={1}
                  style={{
                    color: accent,
                    fontFamily: fontFamilies.semibold,
                    fontVariant: ["tabular-nums"],
                  }}
                >
                  {amountText}
                </Text>
              )}

              {paymentLabel ? (
                <View style={styles.paymentRow}>
                  <Icon
                    name={activity.paymentStatus === "paid" ? "paid" : "clock"}
                    size={11}
                    color={paymentColor}
                  />
                  <Text variant="caption" style={{ color: paymentColor }}>
                    {paymentLabel}
                  </Text>
                </View>
              ) : null}

              {isReminder && activity.reminder?.amount != null ? (
                <Text variant="caption" tone="muted" style={{ marginTop: 2 }}>
                  {formatCurrency(activity.reminder.amount, { currency })}
                </Text>
              ) : null}
            </View>
          </View>
        </Pressable>

        {isReminder && status !== "completed" ? (
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                actionsOpen ? `Hide actions for ${title}` : `Show actions for ${title}`
              }
              accessibilityState={{ expanded: actionsOpen }}
              onPress={() => setActionsOpen((open) => !open)}
              hitSlop={6}
              style={({ pressed }) => [
                styles.actionToggleRow,
                { marginTop: spacing.xs, opacity: pressed ? 0.55 : 1 },
              ]}
            >
              <Text variant="caption" tone="muted">
                {actionsOpen ? "Hide actions" : "Actions"}
              </Text>
              <Icon
                name={actionsOpen ? "chevronUp" : "chevronDown"}
                size={14}
                color={colors.textMuted}
              />
            </Pressable>

            {actionsOpen ? (
              <View style={[styles.actions, { marginTop: spacing.xs }]}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Complete reminder ${title}`}
                  onPress={() => onCompleteReminder(activity.reminder)}
                  style={({ pressed }) => [
                    styles.actionButton,
                    {
                      backgroundColor: colors.primarySoft,
                      borderRadius: radius.pill,
                      opacity: pressed ? 0.65 : 1,
                    },
                  ]}
                >
                  <Icon name="check" size={13} color={colors.primary} />
                  <Text variant="caption" tone="primary">
                    Complete
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remind me later about ${title}`}
                  onPress={() => onSnoozeReminder(activity.reminder)}
                  style={({ pressed }) => [
                    styles.actionButton,
                    {
                      backgroundColor: colors.surfaceMuted,
                      borderRadius: radius.pill,
                      opacity: pressed ? 0.65 : 1,
                    },
                  ]}
                >
                  <Icon name="clock" size={13} color={colors.textMuted} />
                  <Text variant="caption" tone="muted">
                    Remind later
                  </Text>
                </Pressable>
              </View>
            ) : null}
          </>
        ) : null}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  list: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    paddingTop: 8,
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
    paddingRight: 8,
  },
  subtitleRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
    marginTop: 3,
    minWidth: 0,
  },
  subtitle: {
    flexShrink: 1,
  },
  todayChip: {
    paddingHorizontal: 7,
    paddingVertical: 1,
  },
  addButton: {
    alignItems: "center",
    flexDirection: "row",
    gap: 2,
    justifyContent: "center",
    minHeight: 40,
    minWidth: 64,
    paddingHorizontal: 12,
  },
  row: {
    alignItems: "stretch",
    flexDirection: "row",
  },
  timeColumn: {
    flexShrink: 0,
  },
  rail: {
    alignSelf: "stretch",
    flexShrink: 0,
    position: "relative",
  },
  railLine: {
    left: RAIL_WIDTH / 2 - 0.75,
    position: "absolute",
    width: 1.5,
  },
  marker: {
    alignItems: "center",
    borderRadius: MARKER_SIZE / 2,
    height: MARKER_SIZE,
    justifyContent: "center",
    left: (RAIL_WIDTH - MARKER_SIZE) / 2,
    position: "absolute",
    width: MARKER_SIZE,
  },
  markerCore: {
    borderRadius: 3,
    height: 5,
    width: 5,
  },
  separator: {
    height: 8,
  },
  separatorLine: {
    bottom: 0,
    left: RAIL_CENTER - 0.75,
    position: "absolute",
    top: 0,
    width: 1.5,
  },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    flex: 1,
    minWidth: 0,
  },
  cardPress: {
    flex: 1,
    minWidth: 0,
  },
  cardTop: {
    alignItems: "flex-start",
    flexDirection: "row",
    minWidth: 0,
  },
  kindBadge: {
    alignItems: "center",
    flexShrink: 0,
    height: 30,
    justifyContent: "center",
    marginRight: 10,
    width: 30,
  },
  copy: {
    flex: 1,
    minWidth: 0,
  },
  metaRow: {
    alignItems: "center",
    flexDirection: "row",
    marginTop: 2,
    minWidth: 0,
  },
  right: {
    alignItems: "flex-end",
    marginLeft: 8,
  },
  statusPill: {
    alignItems: "center",
    flexDirection: "row",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  paymentRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 3,
    marginTop: 3,
  },
  actionToggleRow: {
    alignItems: "center",
    alignSelf: "flex-end",
    flexDirection: "row",
    gap: 2,
    minHeight: 32,
    paddingLeft: 8,
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  actionButton: {
    alignItems: "center",
    flexDirection: "row",
    gap: 5,
    minHeight: 44,
    paddingHorizontal: 12,
  },
  empty: {
    alignItems: "center",
    paddingHorizontal: 32,
  },
  emptyIcon: {
    alignItems: "center",
    height: 56,
    justifyContent: "center",
    width: 56,
  },
  emptyLoading: {
    alignItems: "center",
    paddingVertical: 32,
  },
});
