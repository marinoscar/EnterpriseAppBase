// =============================================================================
// The settings slice's wire shapes (issue #733, PP-8.1)
// =============================================================================
//
// The core fields of a user's settings document (`theme`, `profile`), the two
// UI-preference user namespaces the platform owns (`dataTables`,
// `navigation`) and the organization-settings route bodies, as zod schemas
// plus their inferred types. Shared by `@marinoscar/platform-api/settings`
// (which composes them into its request DTOs, so the OpenAPI document is
// generated from them) and the web app (which takes the types).
//
// MOVED VERBATIM from the reference app (`apps/api/src/common/schemas/
// settings.schema.ts` and `user-settings-namespaces.schema.ts`): field order,
// bounds and enum orders are part of the published OpenAPI document. Change
// them only as a deliberate API change.
//
// NO `.default()` ANYWHERE. Absent means "use the built-in default", computed
// at read time by the consumer; a default here would freeze a user at today's
// value the first time they saved an unrelated preference.
// =============================================================================

import { z } from 'zod';

import {
  DATA_TABLE_DENSITIES,
  DATA_TABLE_ID_PATTERN,
  DATA_TABLE_MAX_ID_LENGTH,
  DATA_TABLE_MAX_PAGE_SIZE,
  DATA_TABLE_MAX_VISIBLE_COLUMNS,
  DATA_TABLE_SORT_DIRECTIONS,
  ORG_SETTINGS_FIELD_KINDS,
  ORG_SETTINGS_MERGE_MODES,
  PROFILE_DISPLAY_NAME_MAX,
  PROFILE_IMAGE_SOURCES,
  THEME_PREFERENCES,
} from './constants.js';

// =============================================================================
// Enum entry types (named, so the published types stay readable)
// =============================================================================

/**
 * The entries of the theme enum.
 *
 * @stability stable
 */
export type ThemePreferenceEnum = { [K in (typeof THEME_PREFERENCES)[number]]: K };
/**
 * The entries of the profile image source enum.
 *
 * @stability stable
 */
export type ProfileImageSourceEnum = { [K in (typeof PROFILE_IMAGE_SOURCES)[number]]: K };
/**
 * The entries of the row density enum.
 *
 * @stability stable
 */
export type DataTableDensityEnum = { [K in (typeof DATA_TABLE_DENSITIES)[number]]: K };
/**
 * The entries of the sort direction enum.
 *
 * @stability stable
 */
export type DataTableSortDirectionEnum = { [K in (typeof DATA_TABLE_SORT_DIRECTIONS)[number]]: K };
/**
 * The entries of the org-settings field kind enum.
 *
 * @stability experimental
 */
export type OrgSettingsFieldKindEnum = { [K in (typeof ORG_SETTINGS_FIELD_KINDS)[number]]: K };
/**
 * The entries of the org-settings merge mode enum.
 *
 * @stability experimental
 */
export type OrgSettingsMergeModeEnum = { [K in (typeof ORG_SETTINGS_MERGE_MODES)[number]]: K };

// =============================================================================
// Core fields: theme and profile
// =============================================================================

/**
 * `theme` as stored and as a PUT carries it.
 *
 * @stability stable
 */
export const themePreferenceSchema: z.ZodEnum<ThemePreferenceEnum> = z.enum(THEME_PREFERENCES);

/**
 * `profile.imageSource`.
 *
 * @stability stable
 */
export const profileImageSourceSchema: z.ZodEnum<ProfileImageSourceEnum> = z.enum(PROFILE_IMAGE_SOURCES);

/**
 * `profile` as stored. `imageObjectId` is nullable (no avatar uploaded, or it
 * was removed) and optional only so a PUT body may omit it: the service then
 * keeps the stored id. Whether the id names an avatar the caller owns is
 * checked by the API, not here (it needs the database).
 *
 * @stability stable
 */
export const userProfileSettingsSchema = z.object({
  /** The name the user chose to be shown under. */
  displayName: z.string().max(PROFILE_DISPLAY_NAME_MAX).optional(),
  /** Which picture represents the user. */
  imageSource: profileImageSourceSchema,
  /** The uploaded avatar's object id; `null` when none. */
  imageObjectId: z.string().uuid().nullable().optional(),
});

/**
 * The stored `profile` value.
 *
 * @stability stable
 */
export type UserProfileSettingsValue = z.infer<typeof userProfileSettingsSchema>;

/**
 * `profile` in a PATCH body: every field optional; `imageObjectId: null`
 * clears the reference, absent leaves it alone.
 *
 * @stability stable
 */
export const userProfileSettingsPatchSchema = z.object({
  /** The new display name. */
  displayName: z.string().max(PROFILE_DISPLAY_NAME_MAX).optional(),
  /** The new picture source. */
  imageSource: profileImageSourceSchema.optional(),
  /** The new avatar object id; `null` clears it. */
  imageObjectId: z.string().uuid().nullable().optional(),
});

/**
 * A parsed `profile` PATCH branch.
 *
 * @stability stable
 */
export type UserProfileSettingsPatchValue = z.infer<typeof userProfileSettingsPatchSchema>;

// =============================================================================
// The `dataTables` user namespace
// =============================================================================

/**
 * Row density of one table.
 *
 * @stability stable
 */
export const dataTableDensitySchema: z.ZodEnum<DataTableDensityEnum> = z.enum(DATA_TABLE_DENSITIES);

/**
 * Sort direction of one table.
 *
 * @stability stable
 */
export const dataTableSortDirectionSchema: z.ZodEnum<DataTableSortDirectionEnum> = z.enum(DATA_TABLE_SORT_DIRECTIONS);

/**
 * Persisted sort state of one table.
 *
 * @stability stable
 */
export const dataTableSortSchema = z
  .object({
    /** The column sorted by. */
    field: z.string().min(1).max(DATA_TABLE_MAX_ID_LENGTH),
    /** The direction. */
    direction: dataTableSortDirectionSchema,
  })
  .strict();

/**
 * Persisted preferences of one data table. Every key optional, none
 * defaulted.
 *
 * @stability stable
 */
export const dataTableEntrySchema = z
  .object({
    /** The column ids shown, in order. */
    visibleColumns: z
      .array(z.string().min(1).max(DATA_TABLE_MAX_ID_LENGTH))
      .max(DATA_TABLE_MAX_VISIBLE_COLUMNS)
      .optional(),
    /** The row density. */
    density: dataTableDensitySchema.optional(),
    /** The sort state. */
    sort: dataTableSortSchema.optional(),
    /** The page size. */
    pageSize: z.number().int().min(1).max(DATA_TABLE_MAX_PAGE_SIZE).optional(),
  })
  .strict();

/**
 * A table identifier: the key of the `dataTables` record.
 *
 * @stability stable
 */
export const dataTableIdSchema = z.string().min(1).max(DATA_TABLE_MAX_ID_LENGTH).regex(DATA_TABLE_ID_PATTERN);

/**
 * The stored `dataTables` namespace: table id to preferences. The entry
 * count cap (`DATA_TABLE_MAX_TABLES`) is enforced by the API after the merge.
 *
 * @stability stable
 */
export const dataTablesSchema = z.record(dataTableIdSchema, dataTableEntrySchema);

/**
 * The PATCH form of `dataTables`: `null` deletes one table's entry; a
 * non-null entry REPLACES the stored one wholesale.
 *
 * @stability stable
 */
export const dataTablesPatchSchema = z.record(dataTableIdSchema, dataTableEntrySchema.nullable());

/**
 * One table's row density.
 *
 * @stability stable
 */
export type DataTableDensity = z.infer<typeof dataTableDensitySchema>;
/**
 * One table's sort state.
 *
 * @stability stable
 */
export type DataTableSort = z.infer<typeof dataTableSortSchema>;
/**
 * One table's preferences.
 *
 * @stability stable
 */
export type DataTableEntry = z.infer<typeof dataTableEntrySchema>;
/**
 * The stored `dataTables` namespace.
 *
 * @stability stable
 */
export type DataTablesValue = z.infer<typeof dataTablesSchema>;
/**
 * A parsed `dataTables` PATCH branch.
 *
 * @stability stable
 */
export type DataTablesPatchValue = z.infer<typeof dataTablesPatchSchema>;

// =============================================================================
// The `navigation` user namespace
// =============================================================================

/**
 * The stored `navigation` namespace. `railCollapsed` absent means "use the
 * built-in default".
 *
 * @stability stable
 */
export const navigationSchema = z
  .object({
    /** Whether the navigation rail is collapsed. */
    railCollapsed: z.boolean().optional(),
  })
  .strict();

/**
 * The PATCH form of `navigation`: a field may be `null`, meaning "delete it
 * and fall back to the built-in default".
 *
 * @stability stable
 */
export const navigationPatchSchema = z
  .object({
    /** Whether the rail is collapsed; `null` deletes the preference. */
    railCollapsed: z.boolean().nullable().optional(),
  })
  .strict();

/**
 * The stored `navigation` namespace.
 *
 * @stability stable
 */
export type NavigationValue = z.infer<typeof navigationSchema>;
/**
 * A parsed `navigation` PATCH branch.
 *
 * @stability stable
 */
export type NavigationPatchValue = z.infer<typeof navigationPatchSchema>;

// =============================================================================
// Organization settings (`GET` / `PATCH /api/org-settings`)
// =============================================================================

/**
 * One field of an org-overridable namespace, described for a generated form.
 *
 * @stability experimental
 */
export const orgSettingsFieldSchema = z.object({
  /** The field's key inside the namespace. */
  name: z.string(),
  /** The control the page renders; `other` links to the slice's own page. */
  kind: z.enum(ORG_SETTINGS_FIELD_KINDS) as z.ZodEnum<OrgSettingsFieldKindEnum>,
  /** The allowed values of an `enum` field. */
  options: z.array(z.string()).optional(),
  /** The lower bound of a `number` field, when the schema declares one. */
  min: z.number().optional(),
  /** The upper bound of a `number` field, when the schema declares one. */
  max: z.number().optional(),
  /** Whether a `number` field must be an integer. */
  integer: z.boolean().optional(),
  /** The longest `string` value, when the schema declares one. */
  maxLength: z.number().int().optional(),
});

/**
 * One field descriptor.
 *
 * @stability experimental
 */
export type OrgSettingsField = z.infer<typeof orgSettingsFieldSchema>;

/**
 * One org-overridable namespace the caller may read.
 *
 * @stability experimental
 */
export const orgSettingsNamespaceSchema = z.object({
  /** The namespace key (`ai`, `notifications`, ...). */
  key: z.string(),
  /** One sentence on what it configures. */
  description: z.string(),
  /** How the org value combines with the system value. */
  merge: z.enum(ORG_SETTINGS_MERGE_MODES) as z.ZodEnum<OrgSettingsMergeModeEnum>,
  /** Whether the caller may PATCH it (holds its write permission). */
  writable: z.boolean(),
  /** The fields an organization may set, in declaration order. */
  fields: z.array(orgSettingsFieldSchema),
});

/**
 * One namespace descriptor.
 *
 * @stability experimental
 */
export type OrgSettingsNamespace = z.infer<typeof orgSettingsNamespaceSchema>;

/**
 * The `GET` / `PATCH /api/org-settings` response (inside the `{ data }`
 * envelope): the caller's active organization's stored overrides (`value`),
 * the resolved system-then-org value of every org-overridable namespace
 * (`effective`), the row version for `If-Match` (`0` while no row exists)
 * and the namespace descriptors. A namespace the caller may not read is
 * absent from all three maps.
 *
 * @stability experimental
 */
export const orgSettingsResponseSchema = z.object({
  /** The organization (the caller's active one). */
  orgId: z.string().uuid(),
  /** Its stored overrides: namespace key to the fields it sets. */
  value: z.record(z.string(), z.record(z.string(), z.unknown())),
  /** The effective value of each org-overridable namespace (system, then org). */
  effective: z.record(z.string(), z.unknown()),
  /** The row version for `If-Match`; `0` while the organization has no row. */
  version: z.number().int(),
  /** The descriptor of every org-overridable namespace the caller may read. */
  namespaces: z.array(orgSettingsNamespaceSchema),
  /** When the row last changed, or `null`. */
  updatedAt: z.iso.datetime().nullable(),
});

/**
 * The org-settings response.
 *
 * @stability experimental
 */
export type OrgSettingsResponse = z.infer<typeof orgSettingsResponseSchema>;

/**
 * The `PATCH /api/org-settings` body: namespace key to a partial of that
 * namespace's org fields, or `null` to clear the organization's override of
 * the namespace. Inside a namespace a field set to `null` is removed (the
 * system value applies again). Each branch is validated by the API against
 * the namespace's own org schema; an unknown or non-overridable namespace is
 * a 400.
 *
 * @stability experimental
 */
export const patchOrgSettingsSchema = z.record(
  z.string().regex(/^[a-z][A-Za-z0-9]*$/),
  z.record(z.string(), z.unknown()).nullable(),
);

/**
 * A parsed org-settings PATCH body.
 *
 * @stability experimental
 */
export type PatchOrgSettingsBody = z.infer<typeof patchOrgSettingsSchema>;

// =============================================================================
// Pluggable kinds: the descriptor a generated configuration form renders
// (PP-14.5, issue #923)
// =============================================================================

const configFieldBase = {
  /** The field's key inside the implementation's settings (or the secret's name). */
  name: z.string(),
  /** The human label the form shows. */
  label: z.string(),
  /** One sentence of help, shown under the control. */
  help: z.string().optional(),
};

/**
 * One configuration field of a pluggable implementation, described for a
 * generated form. Discriminated by `kind`. The five non-secret kinds are the
 * organization settings kinds ({@link orgSettingsFieldSchema}) plus `label`
 * and `help`; `secret` is write-only: it carries whether a value is stored
 * (`hasValue`) and whether one is required, never the value.
 *
 * @extensionPoint schema
 * @stability experimental
 */
export const configFieldSchema = z.discriminatedUnion('kind', [
  z.object({
    ...configFieldBase,
    /** A switch. */
    kind: z.literal('boolean'),
  }),
  z.object({
    ...configFieldBase,
    /** A select. */
    kind: z.literal('enum'),
    /** The allowed values. */
    options: z.array(z.string()),
  }),
  z.object({
    ...configFieldBase,
    /** A number input. */
    kind: z.literal('number'),
    /** The lower bound, when the schema declares one. */
    min: z.number().optional(),
    /** The upper bound, when the schema declares one. */
    max: z.number().optional(),
    /** Whether the value must be an integer. */
    integer: z.boolean().optional(),
  }),
  z.object({
    ...configFieldBase,
    /** A text input. */
    kind: z.literal('string'),
    /** The longest value, when the schema declares one. */
    maxLength: z.number().int().optional(),
  }),
  z.object({
    ...configFieldBase,
    /** A field the form cannot edit generically; it shows a note instead of a control. */
    kind: z.literal('other'),
  }),
  z.object({
    ...configFieldBase,
    /** A write-only secret input. */
    kind: z.literal('secret'),
    /** Whether a value is stored. The value itself never leaves the server. */
    hasValue: z.boolean(),
    /** Whether the implementation cannot work without one. */
    required: z.boolean(),
  }),
]);

/**
 * One configuration field descriptor.
 *
 * @stability experimental
 */
export type ConfigField = z.infer<typeof configFieldSchema>;

/**
 * One implementation of a pluggable kind, described for a generated form: its
 * identity and its fields (the non-secret settings in declaration order, then
 * one `secret` field per declared secret).
 *
 * @extensionPoint schema
 * @stability experimental
 */
export const pluggableDescriptorSchema = z.object({
  /** The kind it implements (`ai-provider`, `storage-driver`, ...). */
  kind: z.string(),
  /** The implementation id; permanent once stored. */
  id: z.string(),
  /** The human label. */
  label: z.string(),
  /** One sentence on what it is. */
  description: z.string().optional(),
  /** Its configuration fields. */
  fields: z.array(configFieldSchema),
});

/**
 * One implementation descriptor.
 *
 * @stability experimental
 */
export type PluggableDescriptor = z.infer<typeof pluggableDescriptorSchema>;
