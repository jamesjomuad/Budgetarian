import { registerBones } from 'boneyard-js/native';

/**
 * Skeleton bone definitions for each screen.
 *
 * Bone format: [x%, y, width%, height, borderRadius]
 * - x%: horizontal position as percentage of container width
 * - y: vertical position in px
 * - width%: width as percentage of container width
 * - height: height in px
 * - borderRadius: px or '50%' for circles
 *
 * These were manually tuned to approximate each screen's layout.
 */

const bones = {
  // ── Home / Dashboard ───────────────────────────────────────────────
  'dashboard-summary': {
    name: 'dashboard-summary',
    viewportWidth: 390,
    width: 390,
    height: 140,
    bones: [
      [0, 0, 30, 16, 4],       // "Remaining" label
      [0, 24, 55, 32, 4],      // Big currency amount
      [0, 64, 50, 14, 4],      // "Across N active budgets" caption
      [0, 90, 100, 6, 3],      // Progress bar track
    ],
  },

  'dashboard-attention': {
    name: 'dashboard-attention',
    viewportWidth: 390,
    width: 390,
    height: 80,
    bones: [
      [5, 20, 60, 16, 4],
      [5, 44, 40, 14, 4],
    ],
  },

  'dashboard-upcoming': {
    name: 'dashboard-upcoming',
    viewportWidth: 390,
    width: 390,
    height: 180,
    bones: [
      [5, 20, 90, 16, 4],
      [5, 50, 90, 50, 12],
      [5, 110, 90, 50, 12],
    ],
  },

  'dashboard-recent': {
    name: 'dashboard-recent',
    viewportWidth: 390,
    width: 390,
    height: 240,
    bones: [
      [5, 20, 90, 16, 4],
      [5, 50, 90, 50, 12],
      [5, 110, 90, 50, 12],
      [5, 170, 90, 50, 12],
    ],
  },

  // ── Budgets list ───────────────────────────────────────────────────
  'budgets-list': {
    name: 'budgets-list',
    viewportWidth: 390,
    width: 390,
    height: 500,
    bones: [
      // Section header
      [5, 10, 40, 14, 4],
      // Budget card 1
      [5, 40, 90, 72, 16],
      // Budget card 2
      [5, 124, 90, 72, 16],
      // Budget card 3
      [5, 208, 90, 72, 16],
      // Section header 2
      [5, 300, 40, 14, 4],
      // Budget card 4
      [5, 330, 90, 72, 16],
    ],
  },

  // ── Reports ────────────────────────────────────────────────────────
  'reports-content': {
    name: 'reports-content',
    viewportWidth: 390,
    width: 390,
    height: 600,
    bones: [
      // Summary row (3 stats side by side)
      [5, 10, 28, 50, 12],
      [36, 10, 28, 50, 12],
      [67, 10, 28, 50, 12],
      // Trend chart card
      [5, 80, 90, 160, 12],
      // Bar chart card
      [5, 260, 90, 140, 12],
      // Pie chart card
      [5, 420, 90, 160, 12],
    ],
  },

  // ── Archive ────────────────────────────────────────────────────────
  'archive-list': {
    name: 'archive-list',
    viewportWidth: 390,
    width: 390,
    height: 300,
    bones: [
      [5, 10, 50, 14, 4],
      [5, 40, 90, 72, 16],
      [5, 124, 90, 72, 16],
      [5, 208, 90, 72, 16],
    ],
  },

  // ── Folder detail ──────────────────────────────────────────────────
  'folder-detail-loading': {
    name: 'folder-detail-loading',
    viewportWidth: 390,
    width: 390,
    height: 500,
    bones: [
      [5, 10, 26, 26, 7],      // Folder swatch
      [12, 14, 60, 16, 4],     // Folder name
      [5, 50, 40, 20, 4],      // Section header
      [5, 90, 90, 72, 16],     // Budget card 1
      [5, 174, 90, 72, 16],    // Budget card 2
      [5, 258, 90, 72, 16],    // Budget card 3
    ],
  },

  // ── Budget detail ──────────────────────────────────────────────────
  'budget-detail-loading': {
    name: 'budget-detail-loading',
    viewportWidth: 390,
    width: 390,
    height: 600,
    bones: [
      // Summary card
      [5, 10, 90, 140, 25],
      // Remaining label
      [10, 20, 30, 16, 4],
      // Remaining amount
      [10, 44, 50, 32, 4],
      // Stats row
      [10, 90, 25, 30, 4],
      [37, 90, 25, 30, 4],
      [64, 90, 25, 30, 4],
      // Progress bar
      [10, 126, 80, 8, 4],
      // Transactions header
      [5, 170, 40, 16, 4],
      // Transaction rows
      [5, 200, 90, 56, 8],
      [5, 264, 90, 56, 8],
      [5, 328, 90, 56, 8],
    ],
  },

  // ── Export ──────────────────────────────────────────────────────────
  'export-loading': {
    name: 'export-loading',
    viewportWidth: 390,
    width: 390,
    height: 400,
    bones: [
      [5, 10, 50, 24, 4],      // Title
      [5, 44, 70, 14, 4],      // Subtitle
      [5, 80, 90, 70, 12],     // Format card 1
      [5, 162, 90, 70, 12],    // Format card 2
      [5, 244, 90, 70, 12],    // Format card 3
    ],
  },
};

// Register all bones at module load
registerBones(bones);
