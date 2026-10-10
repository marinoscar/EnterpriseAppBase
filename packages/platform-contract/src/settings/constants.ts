// The settings slice's plain values (issue #733, PP-8.1). Zod-free by rule
// (test/no-zod-in-constants.test.ts): a browser that only needs a limit, an
// enum list or a type never pulls the schemas, and with them zod, into its
// bundle.
//
// Every list here is the one the schemas validate with: `schemas.ts` imports
// them, so a value cannot drift between what the API enforces and what the web
// app offers. The values moved verbatim from the reference app
// (`apps/api/src/common/schemas/settings.schema.ts` and
// `user-settings-namespaces.schema.ts`); none changed.

// =============================================================================
// Core user-settings fields
// =============================================================================

/**
 * The theme preferences a user may store (`user_settings.value.theme`).
 *
 * @stability stable
 */
export const THEME_PREFERENCES = ['light', 'dark', 'system'] as const;

/**
 * One theme preference.
 *
 * @stability stable
 */
export type ThemePreference = (typeof THEME_PREFERENCES)[number];

/**
 * Which picture represents the user (`profile.imageSource`, issue #367):
 *
 *  - `none`: no picture; clients render initials.
 *  - `provider`: the identity provider's picture.
 *  - `upload`: the avatar the user uploaded, `profile.imageObjectId`.
 *
 * @stability stable
 */
export const PROFILE_IMAGE_SOURCES = ['none', 'provider', 'upload'] as const;

/**
 * One profile image source.
 *
 * @stability stable
 */
export type ProfileImageSource = (typeof PROFILE_IMAGE_SOURCES)[number];

/**
 * The longest display name a user may store in `profile.displayName`.
 *
 * @stability stable
 */
export const PROFILE_DISPLAY_NAME_MAX = 100;

// =============================================================================
// The `dataTables` and `navigation` user namespaces (UI preferences)
// =============================================================================
//
// SECURITY: these bounds are a control, not ergonomics. `user_settings.value`
// is a JSONB blob the user writes themselves; without a cap on the number of
// table entries, the column ids per entry and the length of each id, an
// authenticated user could inflate one row without limit.

/**
 * The most per-table entries one user may persist in `dataTables`. Not
 * expressible in `z.record`; the API enforces it after the merge (a 400).
 *
 * @stability stable
 */
export const DATA_TABLE_MAX_TABLES = 40;

/**
 * The shape of a table identifier (a lower-case slug).
 *
 * @stability stable
 */
export const DATA_TABLE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

/**
 * The longest table identifier, and the longest column identifier.
 *
 * @stability stable
 */
export const DATA_TABLE_MAX_ID_LENGTH = 64;

/**
 * The most column ids persisted for one table.
 *
 * @stability stable
 */
export const DATA_TABLE_MAX_VISIBLE_COLUMNS = 60;

/**
 * The largest persisted page size of one table.
 *
 * @stability stable
 */
export const DATA_TABLE_MAX_PAGE_SIZE = 500;

/**
 * The row densities of the data table component.
 *
 * @stability stable
 */
export const DATA_TABLE_DENSITIES = ['compact', 'standard', 'comfortable'] as const;

/**
 * One row density.
 *
 * @stability stable
 */
export type DataTableDensityValue = (typeof DATA_TABLE_DENSITIES)[number];

/**
 * The sort directions of a data table.
 *
 * @stability stable
 */
export const DATA_TABLE_SORT_DIRECTIONS = ['asc', 'desc'] as const;

// =============================================================================
// Organization settings (`/api/org-settings`)
// =============================================================================

/**
 * The permission `GET /api/org-settings` requires (ORG scope, held through
 * the `org_admin` membership role).
 *
 * @stability experimental
 */
export const ORG_SETTINGS_READ_PERMISSION = 'org_settings:read';

/**
 * The permission `PATCH /api/org-settings` requires (ORG scope).
 *
 * @stability experimental
 */
export const ORG_SETTINGS_WRITE_PERMISSION = 'org_settings:write';

/**
 * The kinds of field the organization settings page can render as a control.
 * `other` is a field the page cannot edit generically: it links to the owning
 * slice's own page instead.
 *
 * @stability experimental
 */
export const ORG_SETTINGS_FIELD_KINDS = ['boolean', 'enum', 'number', 'string', 'other'] as const;

/**
 * One org-settings field kind.
 *
 * @stability experimental
 */
export type OrgSettingsFieldKind = (typeof ORG_SETTINGS_FIELD_KINDS)[number];

/**
 * How an org value combines with the system value of a namespace: `override`
 * (the org value wins, field by field) or `tighten` (a custom merge that may
 * only restrict, for example an org may turn a capability off but never on).
 *
 * @stability experimental
 */
export const ORG_SETTINGS_MERGE_MODES = ['override', 'tighten'] as const;

/**
 * One merge mode.
 *
 * @stability experimental
 */
export type OrgSettingsMergeMode = (typeof ORG_SETTINGS_MERGE_MODES)[number];

// =============================================================================
// Pluggable kinds (PP-14.5, issue #923)
// =============================================================================

/**
 * The kinds of field a pluggable implementation's configuration form can
 * render. The first five are the organization settings kinds
 * ({@link ORG_SETTINGS_FIELD_KINDS}); `secret` is write-only: the wire carries
 * whether a value is stored, never the value.
 *
 * @stability experimental
 */
export const CONFIG_FIELD_KINDS = ['boolean', 'enum', 'number', 'string', 'other', 'secret'] as const;

/**
 * One configuration field kind.
 *
 * @stability experimental
 */
export type ConfigFieldKind = (typeof CONFIG_FIELD_KINDS)[number];

/**
 * The shape of a pluggable implementation id and of a pluggable kind id: a
 * lower-case slug of 2 to 48 characters starting with a letter
 * (`openai`, `azure-blob`, `ai-provider`). An implementation id is permanent
 * once a settings row stores configuration under it.
 *
 * @stability experimental
 */
export const PLUGGABLE_ID_PATTERN = /^[a-z][a-z0-9-]{1,47}$/;
