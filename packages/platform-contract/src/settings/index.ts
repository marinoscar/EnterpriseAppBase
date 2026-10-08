// `@marinoscar/platform-contract/settings`: the settings slice's wire shapes,
// shared by `@marinoscar/platform-api/settings` (its request DTOs compose these
// schemas) and the web app (types) (issue #733, PP-8.1). Documented in
// ./README.md. Explicit named exports only.
//
// constants.ts and types.ts are zod-free; a consumer that imports only the
// constants and the types (the web app) never bundles schemas.ts or zod
// (`"sideEffects": false`).

export {
  DATA_TABLE_DENSITIES,
  DATA_TABLE_ID_PATTERN,
  DATA_TABLE_MAX_ID_LENGTH,
  DATA_TABLE_MAX_PAGE_SIZE,
  DATA_TABLE_MAX_TABLES,
  DATA_TABLE_MAX_VISIBLE_COLUMNS,
  DATA_TABLE_SORT_DIRECTIONS,
  ORG_SETTINGS_FIELD_KINDS,
  ORG_SETTINGS_MERGE_MODES,
  ORG_SETTINGS_READ_PERMISSION,
  ORG_SETTINGS_WRITE_PERMISSION,
  PROFILE_DISPLAY_NAME_MAX,
  PROFILE_IMAGE_SOURCES,
  THEME_PREFERENCES,
} from './constants.js';
export type {
  DataTableDensityValue,
  OrgSettingsFieldKind,
  OrgSettingsMergeMode,
  ProfileImageSource,
  ThemePreference,
} from './constants.js';
export type { SystemSettingsResponseBase, UserSettingsResponseBase } from './types.js';
export {
  dataTableDensitySchema,
  dataTableEntrySchema,
  dataTableIdSchema,
  dataTableSortDirectionSchema,
  dataTableSortSchema,
  dataTablesPatchSchema,
  dataTablesSchema,
  navigationPatchSchema,
  navigationSchema,
  orgSettingsFieldSchema,
  orgSettingsNamespaceSchema,
  orgSettingsResponseSchema,
  patchOrgSettingsSchema,
  profileImageSourceSchema,
  themePreferenceSchema,
  userProfileSettingsPatchSchema,
  userProfileSettingsSchema,
} from './schemas.js';
export type {
  DataTableDensity,
  DataTableEntry,
  DataTableSort,
  DataTablesPatchValue,
  DataTablesValue,
  NavigationPatchValue,
  NavigationValue,
  OrgSettingsField,
  OrgSettingsNamespace,
  OrgSettingsResponse,
  PatchOrgSettingsBody,
  UserProfileSettingsPatchValue,
  UserProfileSettingsValue,
} from './schemas.js';
