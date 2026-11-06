import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { Icon } from './Icon';
import { Text } from './Text';
import { useTheme } from './ThemeProvider';

/**
 * SwipeActionRow — generic presentational wrapper that reveals trailing action
 * buttons when the row is swiped to the left. Gesture + state only: the screen
 * passes an `actions` array ({ key, label, icon, onPress, tone,
 * accessibilityLabel }) and the row handles the rest.
 * `tone` is semantic ('destructive' | 'warning' | 'success' | undefined) and is
 * resolved to theme tokens here, never by callers.
 *
 * The swipe is a plain pan that activates only after a deliberate horizontal
 * movement and fails as soon as the finger moves vertically. That vertical
 * fail threshold is the important part: without it, a list drag that drifts
 * even slightly sideways activates the row's pan, which then claims the
 * gesture and leaves the enclosing list unable to scroll until the finger is
 * lifted. Taps pass through untouched (the pan never activates), so rows keep
 * opening on a normal press.
 *
 * Coordination rules (managed here, not by callers):
 * - Only one row is open at a time — opening a row closes the previous one.
 * - `closeAllSwipeActions()` lets a screen close the open row on outside taps.
 * - Taps anywhere on an open row close it instead of triggering navigation.
 */

// Module-level registry: at most one row holds the "open" claim at a time.
let activeEntry = null;

function claimRow(entry) {
  if (activeEntry && activeEntry.id !== entry.id) {
    const previous = activeEntry;
    activeEntry = entry;
    previous.close();
  } else {
    activeEntry = entry;
  }
}

function releaseRow(id) {
  if (activeEntry && activeEntry.id === id) {
    activeEntry = null;
  }
}

/** Close whichever swipe row is currently open (no-op when none is). */
export function closeAllSwipeActions() {
  if (activeEntry) {
    const entry = activeEntry;
    activeEntry = null;
    entry.close();
  }
}

// Horizontal travel before the swipe claims the drag, and the vertical travel
// that hands the gesture back to the list. Both are deliberately small: the
// finger must commit to one axis almost immediately.
const ACTIVATION_OFFSET = 12;
const VERTICAL_FAIL_OFFSET = 12;
// Fraction of the actions width that counts as "open" on release, plus the
// fling velocity (px/s) that opens regardless of distance.
const OPEN_THRESHOLD_RATIO = 0.35;
const OPEN_VELOCITY = -420;
const SNAP = { duration: 180 };

/**
 * UI-thread helper for the sliding surface. Keeping the write outside the
 * component lets React's compiler rules see the shared value as read-only at
 * render time while the gesture worklets still animate it without a re-render.
 */
function setSwipeOffset(offset, value) {
  'worklet';
  offset.value = value;
}

/**
 * Semantic action tones mapped onto theme tokens. Unknown tones fall back to
 * the neutral surface pill, so the component stays data-agnostic: screens pick
 * a tone per action, the colors always come from the current theme.
 */
function useActionTones(colors) {
  return useMemo(
    () => ({
      destructive: { background: colors.expenseSoft, ink: colors.expense },
      warning: { background: colors.warningSoft, ink: colors.warning },
      success: { background: colors.primarySoft, ink: colors.income },
      default: { background: colors.surfaceMuted, ink: colors.text },
    }),
    [colors],
  );
}

export function SwipeActionRow({
  rowId,
  actions = [],
  children,
  onOpen,
  onClose,
  disabled = false,
  style,
  contentStyle,
}) {
  const { colors, spacing } = useTheme();
  const tones = useActionTones(colors);
  const autoId = useId();
  // The content slides over the action panel (the actions render BEHIND it),
  // so its surface must be opaque or the buttons bleed through the row text
  // mid-drag and while closing. Callers can override via contentStyle.
  const surfaceStyle = useMemo(
    () => [{ backgroundColor: colors.surface }, contentStyle],
    [colors.surface, contentStyle],
  );
  const id = rowId ?? autoId;

  // The row's open/closed state as seen by React (drives the tap-absorbing
  // overlay). The animated offset lives in a shared value so dragging never
  // re-renders this component.
  const [open, setOpen] = useState(false);
  const swipeX = useSharedValue(0);
  const actionsWidth = useSharedValue(0);
  const startX = useSharedValue(0);
  const dragging = useSharedValue(false);

  const enabled = !disabled && actions.length > 0;

  // Closing from JS bumps this signal; a UI-thread reaction then snaps the row
  // shut. Writing the animated offset from JS as well would make React's
  // compiler rules treat it as read-only inside the gesture worklets.
  const closeRequest = useSharedValue(0);

  // Shared values are stable hook-owned objects and intentionally stay out of
  // the dependency list: React's compiler rules treat a shared value listed as
  // a hook argument as read-only, rejecting the writes below.
  const closeSelf = useCallback(() => {
    closeRequest.value += 1;
    setOpen(false);
    releaseRow(id);
    onClose?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, onClose]);

  useAnimatedReaction(
    () => closeRequest.value,
    (requested) => {
      'worklet';
      if (requested === 0) return;
      setSwipeOffset(swipeX, withTiming(0, SNAP));
    },
  );

  // Called from the gesture worklet once the drag settles. Keeps the registry
  // in sync: opening claims the row, closing releases it.
  const settle = useCallback(
    (shouldOpen) => {
      setOpen(shouldOpen);
      if (shouldOpen) {
        claimRow({ id, close: closeSelf });
        onOpen?.();
      } else {
        releaseRow(id);
        onClose?.();
      }
    },
    [closeSelf, id, onClose, onOpen],
  );

  // Rows unmounted while open (list refresh, navigation) must give up the claim.
  useEffect(
    () => () => {
      releaseRow(id);
    },
    [id],
  );

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .enabled(enabled)
        .maxPointers(1)
        .activeOffsetX([-ACTIVATION_OFFSET, ACTIVATION_OFFSET])
        // Hand vertical drags to the enclosing list before this pan can claim
        // them; a swipeable that wins a vertical drag freezes that list.
        .failOffsetY([-VERTICAL_FAIL_OFFSET, VERTICAL_FAIL_OFFSET])
        .onBegin(() => {
          'worklet';
          startX.value = swipeX.value;
        })
        .onStart(() => {
          'worklet';
          dragging.value = true;
        })
        .onUpdate((event) => {
          'worklet';
          const next = startX.value + event.translationX;
          setSwipeOffset(
            swipeX,
            Math.min(0, Math.max(-actionsWidth.value, next)),
          );
        })
        .onEnd((event) => {
          'worklet';
          const width = actionsWidth.value;
          const shouldOpen =
            width > 0 &&
            (swipeX.value < -width * OPEN_THRESHOLD_RATIO ||
              event.velocityX < OPEN_VELOCITY);
          setSwipeOffset(swipeX, withTiming(shouldOpen ? -width : 0, SNAP));
          dragging.value = false;
          runOnJS(settle)(shouldOpen);
        })
        .onFinalize(() => {
          'worklet';
          if (!dragging.value) return;
          // Cancelled mid-drag (the list or a modal took over): snap shut.
          dragging.value = false;
          setSwipeOffset(swipeX, withTiming(0, SNAP));
          runOnJS(settle)(false);
        }),
    // Shared values are intentionally NOT deps (stable hook-owned objects);
    // reanimated reads them at event time through the closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [enabled, settle],
  );

  const contentAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: swipeX.value }],
  }));

  // The action panel is only ever meaningful while the content has actually
  // slid left. Hiding it at rest keeps it invisible even if a platform paints
  // the absolutely positioned layer above its in-flow sibling.
  const actionsAnimatedStyle = useAnimatedStyle(() => ({
    opacity: swipeX.value < 0 ? 1 : 0,
  }));

  const handleActionsLayout = (event) => {
    actionsWidth.value = event.nativeEvent.layout.width;
  };

  return (
    <GestureDetector gesture={pan} touchAction="pan-y">
      <Animated.View collapsable={false} style={[styles.row, style]}>
        {enabled ? (
          <Animated.View
            style={[styles.actionsLayer, actionsAnimatedStyle]}
            // Closed buttons must never be touch targets, even while the panel
            // is still fading out behind the content.
            pointerEvents={open ? 'box-none' : 'none'}
          >
            <View
              style={[styles.actions, { backgroundColor: colors.surface }]}
              onLayout={handleActionsLayout}
            >
              {actions.map((action) => {
                const tone = tones[action.tone] ?? tones.default;
                return (
                  <Pressable
                    key={action.key}
                    accessibilityRole="button"
                    accessibilityLabel={action.accessibilityLabel ?? action.label}
                    style={({ pressed }) => [
                      styles.action,
                      {
                        paddingHorizontal: spacing.md,
                        backgroundColor: tone.background,
                        // Inset shadow on each button: the buttons read as
                        // pressed pills inside the revealed strip (a shadow on
                        // the wrapper would be hidden behind their solid
                        // backgrounds).
                        boxShadow: `inset 0 2px 5px ${colors.shadow}`,
                        opacity: pressed ? 0.75 : 1,
                      },
                    ]}
                    onPress={() => {
                      closeSelf();
                      action.onPress?.();
                    }}
                  >
                    <Icon name={action.icon} size={20} color={tone.ink} />
                    <Text variant="caption" numberOfLines={1} style={{ marginTop: 2, color: tone.ink }}>
                      {action.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </Animated.View>
        ) : null}

        <Animated.View style={[styles.surface, surfaceStyle, contentAnimatedStyle]}>
          {children}
          {enabled && open ? (
            // Absorb taps while open so pressing the row closes it instead of navigating.
            <Pressable
              accessibilityLabel="Close actions"
              onPress={closeSelf}
              style={StyleSheet.absoluteFill}
            />
          ) : null}
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  row: {
    // Clips the sliding surface to the row/card so the revealed actions never
    // paint outside it while dragging.
    overflow: 'hidden',
    width: '100%',
  },
  // Action panel sits behind the sliding content, pinned to the right edge and
  // stretched to the row's full height.
  actionsLayer: {
    // Explicit insets, not StyleSheet.absoluteFillObject: that helper was
    // removed in React Native 0.88, and spreading an undefined value silently
    // dropped the absolute positioning — the panel fell into the row's normal
    // flow and reserved a blank band above every item.
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    // Explicit stacking: the sliding content always paints above the actions.
    zIndex: 0,
  },
  actions: {
    alignItems: 'stretch',
    flexDirection: 'row',
  },
  surface: {
    width: '100%',
    zIndex: 1,
  },
  action: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 60,
  },
});

export default SwipeActionRow;
