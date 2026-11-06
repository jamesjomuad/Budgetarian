import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { formatCurrency } from '../../utils/currency';
import { formatDate, formatDateRange } from '../../utils/dates';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { Text } from '../ui/Text';
import { useTheme } from '../ui/ThemeProvider';

/**
 * Destination picker for moving one existing transaction. The source budget
 * is shown for context but never offered as a destination; folders are only
 * captions, never selectable rows. Confirming returns the chosen budget id to
 * the owning screen, which performs the repository-backed move.
 */
export function MoveTransactionSheet({
  transaction,
  currentBudget,
  budgets = [],
  folders = [],
  currency,
  busy = false,
  onConfirm,
  onClose,
}) {
  const { colors, radius, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const [selectedId, setSelectedId] = useState(null);
  const destinations = budgets.filter(
    (budget) => budget.id !== currentBudget?.id && budget.deleted_at == null,
  );
  const title = transaction.description || 'Untitled transaction';
  const type = `${transaction.type.charAt(0).toUpperCase()}${transaction.type.slice(1)}`;

  function close() {
    if (!busy) onClose();
  }

  return (
    <Modal transparent animationType="slide" onRequestClose={close} accessibilityViewIsModal>
      <View style={[styles.backdropWrap, { backgroundColor: colors.overlay }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cancel moving transaction"
          disabled={busy}
          onPress={close}
          style={StyleSheet.absoluteFill}
        />
        <View
          accessibilityViewIsModal
          style={[
            styles.sheet,
            {
              backgroundColor: colors.surfaceElevated,
              borderTopLeftRadius: radius.xl,
              borderTopRightRadius: radius.xl,
              paddingBottom: Math.max(insets.bottom, spacing.lg),
              paddingHorizontal: spacing.lg,
            },
          ]}
        >
          <View style={[styles.grabber, { backgroundColor: colors.border }]} />

          <View style={styles.header}>
            <Text variant="heading" accessibilityRole="header" style={styles.title}>
              Move transaction
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancel moving transaction"
              disabled={busy}
              onPress={close}
              hitSlop={10}
              style={({ pressed }) => [styles.iconButton, { opacity: pressed ? 0.55 : 1 }]}
            >
              <Icon name="close" size={20} color={colors.textMuted} />
            </Pressable>
          </View>

          <View
            style={[
              styles.transactionSummary,
              { backgroundColor: colors.surfaceMuted, borderRadius: radius.md },
            ]}
          >
            <Text variant="body" numberOfLines={2}>
              {title}
            </Text>
            <Text variant="caption" tone="muted" style={{ marginTop: spacing.xs }}>
              {`${type} · ${formatCurrency(transaction.amount, currency)} · ${formatDate(transaction.transaction_date)}`}
            </Text>
            <Text variant="caption" tone="muted" style={{ marginTop: spacing.xs }}>
              {`From ${currentBudget?.name ?? 'this budget'}`}
            </Text>
          </View>

          <Text variant="label" style={{ marginBottom: spacing.sm, marginTop: spacing.lg }}>
            Destination budget
          </Text>

          <ScrollView
            style={styles.destinationScroll}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ gap: spacing.sm }}
          >
            {destinations.map((budget) => {
              const selected = budget.id === selectedId;
              const folder = folders.find((entry) => entry.id === budget.folder_id);
              return (
                <Pressable
                  key={budget.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Select ${budget.name}${folder ? ` in ${folder.name}` : ''}`}
                  accessibilityState={{ selected, disabled: busy }}
                  disabled={busy}
                  onPress={() => setSelectedId(budget.id)}
                  style={({ pressed }) => [
                    styles.destination,
                    {
                      backgroundColor: pressed ? colors.surfaceMuted : colors.surface,
                      borderColor: selected ? colors.primary : colors.border,
                      borderRadius: radius.md,
                      gap: spacing.sm,
                      padding: spacing.md,
                    },
                  ]}
                >
                  <Icon
                    name="wallet"
                    size={20}
                    color={selected ? colors.primary : colors.textMuted}
                  />
                  <View style={styles.destinationText}>
                    <Text variant="body" numberOfLines={1}>
                      {budget.name}
                    </Text>
                    <Text variant="caption" tone="muted" numberOfLines={1}>
                      {folder ? folder.name : 'Main list'}
                    </Text>
                    <Text variant="caption" tone="faint" numberOfLines={1}>
                      {formatDateRange(budget.start_date, budget.end_date)}
                    </Text>
                  </View>
                  {selected ? <Icon name="check" size={18} color={colors.primary} /> : null}
                </Pressable>
              );
            })}
            {destinations.length === 0 ? (
              <Text variant="body" tone="muted" style={styles.empty}>
                No other active budgets are available.
              </Text>
            ) : null}
          </ScrollView>

          <Button
            label={busy ? 'Moving…' : 'Move transaction'}
            icon="wallet"
            disabled={!selectedId || busy}
            onPress={() => onConfirm(selectedId)}
            style={{ marginTop: spacing.lg }}
          />
          <Button
            label="Cancel"
            variant="secondary"
            disabled={busy}
            onPress={close}
            style={{ marginTop: spacing.sm }}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdropWrap: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  destination: {
    alignItems: 'center',
    borderWidth: 1,
    flexDirection: 'row',
  },
  destinationScroll: {
    flexGrow: 0,
    flexShrink: 1,
    minHeight: 0,
  },
  destinationText: {
    flex: 1,
  },
  empty: {
    paddingVertical: 12,
    textAlign: 'center',
  },
  grabber: {
    alignSelf: 'center',
    borderRadius: 999,
    height: 4,
    marginTop: 8,
    width: 36,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    marginBottom: 12,
    marginTop: 12,
  },
  iconButton: {
    padding: 4,
  },
  sheet: {
    maxHeight: '88%',
    paddingTop: 4,
  },
  title: {
    flex: 1,
  },
  transactionSummary: {
    padding: 12,
  },
});
