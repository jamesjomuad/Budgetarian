import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { computeBudgetBalance } from '../../utils/calculations';
import { formatCurrency } from '../../utils/currency';
import { formatDate, formatDateRange } from '../../utils/dates';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { Text } from '../ui/Text';
import { useTheme } from '../ui/ThemeProvider';

/**
 * Detail view for one budget, opened by tapping its row while a list is in
 * selection mode (the checkbox stays the only selection control). It mirrors
 * the breakdown item sheet: what the compact row truncates — the exact
 * remaining balance, the period, the amount spent and, for an archived budget,
 * the day it was archived — followed by the same actions the row exposes
 * elsewhere. The sheet itself closes before running an action, so the caller
 * only has to perform it.
 *
 * Archived budgets swap the active actions for Restore and Delete permanently;
 * `busy` disables both while one is already running.
 */
export function BudgetDetailSheet({
  budget,
  currency,
  archived = false,
  busy = false,
  onOpen,
  onEdit,
  onArchive,
  onRestore,
  onDelete,
  onClose,
}) {
  const { colors, radius, spacing } = useTheme();
  const insets = useSafeAreaInsets();

  if (!budget) return null;

  const balance = computeBudgetBalance(budget.income ?? 0, budget.spent ?? 0);
  const period = formatDateRange(budget.start_date, budget.end_date);
  const archivedOn = budget.deleted_at
    ? formatDate(String(budget.deleted_at).slice(0, 10))
    : null;

  function run(action) {
    onClose();
    action?.(budget);
  }

  return (
    <Modal
      transparent
      visible
      animationType="slide"
      onRequestClose={onClose}
      accessibilityViewIsModal
    >
      <View style={[styles.backdropWrap, { backgroundColor: colors.overlay }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close budget details"
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        <ScrollView
          style={styles.sheetScroll}
          contentContainerStyle={[
            styles.sheet,
            {
              backgroundColor: colors.surfaceElevated,
              borderTopLeftRadius: radius.xl,
              borderTopRightRadius: radius.xl,
              // The safe-area part can sit under Android's translucent
              // navigation bar, so the extra gap (not the inset) is what the
              // eye reads below the last action. Keep enough of it that the
              // buttons never look glued to the bottom edge.
              paddingBottom: Math.max(insets.bottom, spacing.lg) + spacing.xl,
              paddingHorizontal: spacing.lg,
            },
          ]}
        >
          <View style={[styles.grabber, { backgroundColor: colors.border }]} />

          <View style={styles.header}>
            <Text variant="heading" accessibilityRole="header" style={styles.title}>
              {archived ? 'Archived budget' : 'Budget'}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close budget details"
              onPress={onClose}
              hitSlop={10}
              style={({ pressed }) => [styles.iconButton, { opacity: pressed ? 0.55 : 1 }]}
            >
              <Icon name="close" size={20} color={colors.textMuted} />
            </Pressable>
          </View>

          <Text variant="title" style={{ marginTop: spacing.sm }}>
            {budget.name}
          </Text>

          <Text
            variant="heading"
            style={{
              color: balance < 0 ? colors.expense : colors.text,
              fontVariant: ['tabular-nums'],
              marginTop: spacing.xs,
            }}
          >
            {formatCurrency(balance, { currency })}
          </Text>
          <Text variant="caption" tone="muted">
            {archived ? 'Balance' : 'Remaining'}
          </Text>

          {period ? (
            <View style={[styles.metaRow, { marginTop: spacing.md }]}>
              <Text variant="caption" tone="muted">
                Period
              </Text>
              <Text variant="body" style={styles.metaValue}>
                {period}
              </Text>
            </View>
          ) : null}

          <View style={[styles.metaRow, { marginTop: spacing.sm }]}>
            <Text variant="caption" tone="muted">
              Spent
            </Text>
            <Text variant="body" style={styles.metaValue}>
              {formatCurrency(budget.spent ?? 0, { currency })}
            </Text>
          </View>

          {archived && archivedOn ? (
            <View style={[styles.metaRow, { marginTop: spacing.sm }]}>
              <Text variant="caption" tone="muted">
                Archived
              </Text>
              <Text variant="body" style={styles.metaValue}>
                {archivedOn}
              </Text>
            </View>
          ) : null}

          {archived ? (
            <>
              <View style={{ marginTop: spacing.lg }}>
                <Button
                  label="Restore"
                  icon="undo"
                  disabled={busy}
                  onPress={() => run(onRestore)}
                />
              </View>
              <View style={{ marginTop: spacing.sm }}>
                <Button
                  label="Delete permanently"
                  icon="trash"
                  variant="danger"
                  disabled={busy}
                  onPress={() => run(onDelete)}
                />
              </View>
            </>
          ) : (
            <>
              <View style={{ marginTop: spacing.lg }}>
                <Button label="Open budget" icon="wallet" onPress={() => run(onOpen)} />
              </View>
              <View style={{ marginTop: spacing.sm }}>
                <Button
                  label="Edit budget"
                  icon="pencil"
                  variant="secondary"
                  onPress={() => run(onEdit)}
                />
              </View>
              <View style={{ marginTop: spacing.sm }}>
                <Button
                  label="Archive budget"
                  icon="archive"
                  variant="secondary"
                  onPress={() => run(onArchive)}
                />
              </View>
            </>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdropWrap: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheetScroll: {
    flexGrow: 0,
  },
  sheet: {
    paddingTop: 8,
  },
  grabber: {
    alignSelf: 'center',
    borderRadius: 999,
    height: 4,
    marginBottom: 8,
    width: 36,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    paddingBottom: 4,
  },
  title: {
    flex: 1,
  },
  iconButton: {
    alignItems: 'center',
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  metaRow: {
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between',
  },
  metaValue: {
    flexShrink: 1,
    textAlign: 'right',
  },
});
