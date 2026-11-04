import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '../ui/Button';
import { Text } from '../ui/Text';
import { useTheme } from '../ui/ThemeProvider';

/**
 * The contextual bottom bar shown while a list is in selection mode: a
 * cancel control, the selected count, and whatever actions the owning
 * screen supplies (e.g. "Move"). Actions are disabled while
 * nothing is selected, so screens never wire their own count checks.
 *
 * Two fixed rows: the cancel control and the count on top, the actions
 * underneath sharing the width evenly. A single wrapping row used to push a
 * third action onto its own line with uneven gaps, so the bars are stacked
 * deliberately instead — they stay tidy whatever the screen supplies, and the
 * number of actions never changes the shape of the bar.
 *
 * The bar knows nothing about what the actions do — business logic and
 * confirmations stay in the screen.
 */
export function SelectionToolbar({ count, onCancel, actions = [], cancelLabel = 'Cancel' }) {
  const { colors, radius, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.bar,
        {
          backgroundColor: colors.surfaceElevated,
          borderColor: colors.border,
          gap: spacing.sm,
          // Sit above the system navigation bar, not under it.
          paddingBottom: Math.max(insets.bottom, spacing.md, 4),
          paddingHorizontal: spacing.lg,
          paddingTop: spacing.md,
        },
      ]}
    >
      <View style={styles.head}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cancel selection"
          onPress={onCancel}
          hitSlop={8}
          style={({ pressed }) => [
            styles.cancel,
            {
              backgroundColor: pressed ? colors.surfaceMuted : 'transparent',
              borderColor: colors.border,
              borderRadius: radius.pill,
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.xs,
            },
          ]}
        >
          <Text variant="label" tone="muted">
            {cancelLabel}
          </Text>
        </Pressable>
        <Text variant="body" tone="muted" style={styles.count}>
          {count} selected
        </Text>
      </View>
      {actions.length > 0 ? (
        <View style={styles.actions}>
          {actions.map((action) => (
            <Button
              key={action.label}
              label={action.label}
              icon={action.icon}
              variant={action.variant}
              disabled={count === 0 || Boolean(action.disabled)}
              onPress={action.onPress}
              style={styles.action}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    borderTopWidth: StyleSheet.hairlineWidth,
    // Stacked on purpose: see the note above.
    flexDirection: 'column',
  },
  head: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  cancel: {
    borderWidth: 1,
  },
  count: {
    flex: 1,
    textAlign: 'right',
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
  },
  action: {
    // Even shares of the row, so two actions split it and three stay aligned
    // instead of one dropping to a line of its own.
    flexGrow: 1,
    flexShrink: 1,
  },
});
