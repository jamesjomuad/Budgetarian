import { Skeleton } from 'boneyard-js/native';

import { useTheme } from '../ui/ThemeProvider';
import { useSkeletonBones } from './useSkeletonBones';

/**
 * Theme-aware skeleton wrapper for Budgetarian.
 * Wraps Boneyard's Skeleton and passes theme-appropriate colors.
 * Automatically scales bones based on device dimensions.
 *
 * Usage:
 * <BudgetarianSkeleton name="dashboard" loading={isLoading}>
 *   <RealContent />
 * </BudgetarianSkeleton>
 */
export function BudgetarianSkeleton({
  name,
  loading,
  children,
  style,
  animate = 'pulse',
  transition = 300,
  stagger = 60,
  fallback,
}) {
  const { scheme, colors } = useTheme();
  const isDark = scheme === 'dark';
  const bones = useSkeletonBones(name);

  return (
    <Skeleton
      name={name}
      loading={loading}
      color={colors.border}
      darkColor={colors.surfaceMuted}
      dark={isDark}
      animate={animate}
      transition={transition}
      stagger={stagger}
      fallback={fallback}
      style={style}
      initialBones={bones}
    >
      {children}
    </Skeleton>
  );
}
