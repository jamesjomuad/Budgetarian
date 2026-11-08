# Changelog

All notable user-facing changes to Budgetarian are documented here.

## [Unreleased]

# v1.1.0 — 2026-11-09

### Added
- Added budget moving between folders without losing budget data.
- Added transaction moving between active budgets with all details intact.
- Added budget details and actions to selection mode.
- Added breakdown item cloning.
- Added optional time and notes to transactions.
- Added breakdown multi-select for reordering and deletion.
- Added single-budget export in JSON, Excel, CSV, invoice, and report formats.
- Added single-budget import with preview and destination folder selection.
- Added in-app release history and latest release information.
- Added collapsible Folders and Budgets sections with independent ordering.
- Added swipe-to-delete archiving for budget rows.
- Added paid and unpaid status for income.
- Added a breakdown add action beside the section header.
- Added archive multi-select for restoring and permanently deleting budgets.

### Improved
- Improved search, selection, and breakdown header styling.
- Improved selection bar spacing and action alignment.
- Improved balances and reports to separate paid, unpaid, and expected amounts.
- Improved Calendar with a fixed month and scrolling daily timeline.
- Improved time picker with endlessly scrolling wheels.
- Improved Add Transaction attachment layout to match editing.
- Improved reminder completion navigation to the relevant budget or Calendar.

### Fixed
- Fixed Back navigation when leaving unchanged transactions.
- Fixed transaction list scrolling during vertical gestures.
- Fixed unselected Settings options appearing checked on Android.
- Fixed Home alerts to show only financial issues and overdue payments.
- Fixed content and controls overlapping the floating tab bar.
- Fixed Complete actions and dismissal for reminder notifications.

# v1.0.0 — 2026-10-23

### Improved
- Improved introduction completion to open Home.

## 2026-10-23

### Added
- Added offline Help & Guide with searchable articles.
- Added a five-slide first-launch introduction with replay support.
- Added bold emphasis to app text.
- Added camera capture for transaction receipts.

## 2026-10-22

### Added
- Added Complete and Remind Later actions to reminder notifications.
- Added transaction swipe actions for deletion and payment status.
- Added recent-use ordering for transaction tags.

## 2026-10-21

### Added
- Added clear buttons to text inputs.
- Added options to add or replace recognized receipt text.

### Improved
- Improved text contrast, touch targets, and accessibility labels.
- Improved screen-reader announcements and destructive action confirmations.
- Improved budget tag insights and animated segmented controls.
- Improved toast readability and accessibility.

### Fixed
- Fixed missing validation messages when transaction saving fails.
- Fixed broken receipt imports showing an endless spinner.
- Fixed crashes in tabs, database errors, and empty controls.

## 2026-10-19

### Added
- Added a Home insights dashboard and dedicated Budgets tab.
- Added a centered floating create button on Budgets.

### Improved
- Improved bottom navigation with larger icon-only tabs.

### Fixed
- Fixed archived budgets appearing in Calendar and reminder notifications.

## 2026-10-18

### Added
- Added Botanical Green colors to System and Light themes.
- Added tag-colored borders to budget tag chips.

### Improved
- Improved bottom tab bar spacing above the screen edge.
- Improved receipt imports by removing the unused Detected card.

### Fixed
- Fixed receipt totals when the peso symbol is misread.

## 2026-10-17

### Added
- Added select-all controls to the Archive row on Home.

### Fixed
- Fixed Android crashes after archiving or deleting budgets.
- Fixed budget deletion to archive instead of permanently removing data.

## 2026-10-16

### Added
- Added reversible budget archiving with Undo.
- Added an Archive screen for restoring or permanently deleting budgets.

### Improved
- Improved bottom navigation with a simpler floating capsule.
- Improved transaction save controls and summary card styling.
- Improved tag editing links, chip spacing, and currency sizing.
- Improved default dates for transaction reminders and breakdown items.

### Fixed
- Fixed long amounts hiding tag names in budget insights.
- Fixed recognized receipt lines losing text or changing order.

## 2026-10-15

### Added
- Added persistent receipt images that survive saving and restarting.
- Added multiple image attachments to transactions.
- Added a unified Attachments section with thumbnails and file status.
- Added on-device receipt scanning with reusable recognized text.
- Added a collapsible tag drawer to budget details.

### Improved
- Improved the app icon design.

### Fixed
- Fixed data upgrades failing for some existing transactions.
- Fixed dark mode contrast for tag drawers and captions.

## 2026-10-14

### Added
- Added drag-to-reorder with saved positions for folders and budgets.

### Improved
- Improved active tab animations and reduced-motion support.
- Improved budget multi-select with clearer checkboxes.
- Improved transaction tag browsing with a swipeable row.
- Simplified breakdowns by removing the duplicate total.
- Improved app icons, splash screen, favicon, and notification icon.

### Fixed
- Fixed unchecked checkboxes and selection cancel buttons lacking contrast.

## 2026-10-13

### Added
- Added Android receipt sharing with offline parsing and transaction preview.

### Improved
- Renamed MoneyQ to Budgetarian throughout the app and backups.

## 2026-10-12

### Added
- Added saving backups directly to an Android folder.
- Added full backup import and export with merge or restore options.
- Added transaction breakdown items with totals, dates, times, and notes.
- Added payment due dates for unpaid expenses.
- Added a sticky transaction summary with type, status, and folder details.
- Added drag-to-reorder and move controls for breakdown items.
- Added consistent icons to common actions.

### Improved
- Improved form controls with consistent capsule styling.
- Improved breakdown notes with a multiline text area.
- Improved budget totals and breakdown card layouts.
- Improved sticky summary cards with clearer amounts and shadows.

### Fixed
- Fixed breakdown dragging to track fingers accurately.
- Fixed hidden success messages after adding breakdown items.

## 2026-10-11

### Added
- Added standalone reminders with Calendar management.
- Added reminders while creating transactions.
- Added custom reminder notification icons and messages.
- Added folder-colored remaining balance cards.

### Fixed
- Fixed temporary storage errors appearing as missing budgets.
- Fixed bottom content overlapping the floating tab bar.

## 2026-10-10

### Added
- Added horizontal swipe navigation between main tabs.
- Added folder spending progress and tag insights.

### Fixed
- Fixed late Android reminder notifications.
- Fixed outdated folder details after editing.
- Fixed transaction highlights and long tag label layouts.
- Fixed default payment status and transaction dates.

## 2026-10-09

### Added
- Added a custom bottom tab bar with a central create button.
- Added Home search across folders and transactions.
- Added paid and unpaid status for expenses.
- Added automatic transaction saving with confirmation toasts.
- Added confirmation for transactions outside the budget period.
- Added optional notes to reminders.
- Added a Next Month filter to Reports.

### Improved
- Improved pinned folder labels for compact navigation.

## 2026-10-08

### Added
- Added a Calendar tab with monthly transactions and reminders.
- Added daily summaries and quick transaction editing to Calendar.
- Added pinned folder shortcuts.
- Added System, Light, Dark, and MoneyQ appearance themes.
- Added custom folder colors with a color picker.

### Improved
- Improved the splash screen and app icon.
- Improved Android keyboard positioning.
- Simplified folder view by hiding tag names.

### Fixed
- Fixed future budget start date selection.
- Fixed folder color sheets exceeding the screen.
- Fixed local notifications in Android builds and Expo Go.

## 2026-10-07

### Added
- Added transaction reminders with local notifications.
- Added folder balances beside spending totals.
- Added a shared mobile date picker to date fields.
- Added an About screen.

### Improved
- Improved folder sections and transaction editing.
- Simplified reminder fields for general transactions.
- Restricted amount fields to numeric input.

### Fixed
- Fixed budget period shortcut buttons.
- Fixed Android notification errors in Expo Go.

## 2026-10-06

### Added
- Introduced MoneyQ with local budgets, tags, and transactions.
- Added local storage and a browser preview.
