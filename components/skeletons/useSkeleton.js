import { useWindowDimensions } from 'react-native';
import { bones as staticBones } from './bones';

/**
 * Composable hook for device-responsive skeleton bones.
 * Scales bone definitions based on actual device width.
 *
 * @param {string} name - The skeleton name (e.g., 'dashboard', 'budget-detail')
 * @returns {object} Responsive bone definition for the Skeleton component
 *
 * @example
 * const bones = useSkeleton('dashboard');
 * <BudgetarianSkeleton name="dashboard" loading={isLoading} initialBones={bones}>
 *   <RealContent />
 * </BudgetarianSkeleton>
 */
export function useSkeleton(name) {
  const { width: screenWidth } = useWindowDimensions();
  const baseWidth = 390; // Reference width from bone definitions
  const scale = screenWidth / baseWidth;

  const skeletonDef = staticBones[name];
  if (!skeletonDef) {
    console.warn(`Skeleton "${name}" not found in bone definitions`);
    return null;
  }

  // Scale bone dimensions based on screen size
  const scaledBones = skeletonDef.bones.map((bone) => {
    const [x, y, w, h, r] = bone;
    return [
      x, // x is percentage-based, no scaling needed
      y * scale, // vertical position scales
      w, // width is percentage-based, no scaling needed
      h * scale, // height scales
      r * scale, // border radius scales
    ];
  });

  return {
    name: skeletonDef.name,
    viewportWidth: screenWidth,
    width: screenWidth,
    height: skeletonDef.height * scale,
    bones: scaledBones,
  };
}
