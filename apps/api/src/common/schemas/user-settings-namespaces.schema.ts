import { z } from 'zod';

// =============================================================================
// User Settings Namespaces: `dataTables`, `navigation`, `notifications`
// =============================================================================
//
// WHY THIS FILE EXISTS
// --------------------
// The user-settings shape used to be hand-maintained in five separate zod
// declarations plus one plain TS interface; adding a namespace to only some of
// them meant the payload was silently stripped by `userSettingsSchema.parse()`
// and never round-tripped through a subsequent GET.
//
// These namespace SCHEMAS are therefore declared ONCE, here. Since #677 the
// five composed objects are derived from the user settings namespace registry
// (`settings/registry/`): each namespace is declared once, beside its module
// (`*.user-settings.ts`), naming the schemas below. A leaf: this file must
// never import a composed object.
//
// SECURITY: THE BOUNDS BELOW ARE A CONTROL, NOT ERGONOMICS
// --------------------------------------------------------
// `user_settings.value` is a JSONB blob that the user themselves writes via
// PUT/PATCH /api/user-settings. An unbounded user-controlled record is a
// storage-exhaustion vector: without a cap on the number of table entries, the
// number of column ids per entry, and the length of each id, an authenticated
// user can inflate a single row without limit. Every limit below exists to
// close that, and must not be relaxed for convenience.
//
// CRITICAL: NO `.default()` ANYWHERE IN THIS FILE
// ------------------------------------------------
// Absent MUST mean "use the application's built-in defaults", computed at read
// time by the consumer. This is load-bearing, not style.
//
// Concretely: if `visibleColumns` defaulted to `[]` (or to today's column list),
// then the first time a user merely opened a density menu — touching a totally
// unrelated preference — the persisted entry would materialise a frozen column
// set. Every column added to that table afterwards would be silently invisible
// to that user forever, with no error and no signal that anything was wrong,
// and the only remedy would be a manual settings reset. The same argument
// applies to `density`, `pageSize`, `sort`, and `railCollapsed`. Persist only
// what the user actually chose.
//
// =============================================================================

// The `dataTables` and `navigation` namespaces are the settings slice's UI
// preferences: since #733 their schemas and bounds live in
// `@marinoscar/platform-contract/settings` (their declarations in
// `@marinoscar/platform-api/settings`) and are re-exported here, unchanged.
export {
  DATA_TABLE_ID_PATTERN,
  DATA_TABLE_MAX_ID_LENGTH,
  DATA_TABLE_MAX_PAGE_SIZE,
  DATA_TABLE_MAX_TABLES,
  DATA_TABLE_MAX_VISIBLE_COLUMNS,
  dataTableDensitySchema,
  dataTableEntrySchema,
  dataTableIdSchema,
  dataTableSortDirectionSchema,
  dataTableSortSchema,
  dataTablesPatchSchema,
  dataTablesSchema,
  navigationPatchSchema,
  navigationSchema,
} from '@marinoscar/platform-contract/settings';
export type {
  DataTableDensity,
  DataTableEntry,
  DataTableSort,
  DataTablesPatchValue,
  DataTablesValue,
  NavigationPatchValue,
  NavigationValue,
} from '@marinoscar/platform-contract/settings';

// =============================================================================
// User Settings Namespace: `notifications` — moved (issue #738)
// =============================================================================
//
// The `notifications` namespace's schemas and bounds are the wire contract of
// the notifications slice since #738 (`@marinoscar/platform-contract/notifications`),
// with OPEN channel keys: a record keyed by any well-formed channel id, checked
// against the channel registry only where a request writes a NEW preference
// (`notificationsPatchSchema` of `@marinoscar/platform-api/notifications`), so
// a preference stored for an unregistered channel survives. The declaration is
// `NOTIFICATIONS_USER_SETTINGS` of the package. Re-exported here under the old
// names for this app's existing importers.
// =============================================================================

export {
  NOTIFICATION_EVENT_KEY_PATTERN,
  NOTIFICATION_MAX_EVENTS_PER_CHANNEL,
  NOTIFICATION_MAX_EVENT_KEY_LENGTH,
  notificationChannelPreferencesPatchSchema,
  notificationChannelPreferencesSchema,
  notificationEventKeySchema,
  notificationsPatchSchema,
  notificationsSchema,
} from '@marinoscar/platform-contract/notifications';
export type {
  NotificationChannelPreferencesValue,
  NotificationsPatchValue,
  NotificationsValue,
} from '@marinoscar/platform-contract/notifications';
