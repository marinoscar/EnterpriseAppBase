// =============================================================================
// The core user fields `profile` and `theme` as extension points (PP-14.21)
// =============================================================================
//
// `theme` and `profile` are core fields of a user's settings document, not
// namespaces, so they sit outside the namespace registries. An app still needs
// to put something in them: a `profile.timezone`, a `high-contrast` theme.
//
//   - `extendUserProfile({ fields })` adds optional fields to `profile`. They
//     are stored, validated, patched (`null` deletes one) and returned with
//     the rest of the profile.
//   - `registerThemePreference({ id, label })` adds a theme id to the values
//     `theme` accepts and lists it in the user settings response
//     (`themeOptions`) so a client can offer it.
//
// With nothing registered the composed schemas ARE the contract's schemas
// (`userProfileSettingsSchema`, `themePreferenceSchema`): the OpenAPI document
// and every stored row are exactly as before.
//
// `security` is NOT an extension point: it is derived from the session policy
// and security-sensitive, and stays closed.
//
// Framework-free: zod, the contract and the registry primitive.
// =============================================================================

import {
  THEME_OPTION_LABEL_MAX,
  THEME_PREFERENCE_ID_PATTERN,
  THEME_PREFERENCES,
  profileImageSourceSchema,
  themeOptionSchema,
  themePreferenceSchema,
  userProfileSettingsPatchSchema,
  userProfileSettingsSchema,
  type ThemeOption,
} from '@marinoscar/platform-contract/settings';
import { z } from 'zod';

import { defineRegistry } from '../../core/index';
import { SETTINGS_SECRET_FIELD_NAMES, secretFieldMessage } from './secret-fields';
import { findDefaultPaths, findSecretFieldPaths, isZodSchema, walkSchema } from './schema-walk';

// -----------------------------------------------------------------------------
// profile
// -----------------------------------------------------------------------------

/**
 * One field an app adds to `profile`.
 *
 * @stability experimental
 */
export interface UserProfileField {
  /** The field name (`timezone`). Matches `/^[a-z][A-Za-z0-9]*$/`; not one of the core profile fields. */
  readonly name: string;
  /**
   * The stored shape. It must accept `undefined` (a profile saved before the
   * field existed has none), never carry `.default()` (absent means "the
   * client's built-in default") and be bounded: `user_settings.value` is a
   * JSONB blob the user writes themselves, so every string needs `.max()`,
   * every array `.max()`, and a free-form record is refused.
   */
  readonly schema: z.ZodType;
}

/**
 * The profile fields the platform owns; an extension cannot take them.
 *
 * @stability experimental
 */
export const CORE_PROFILE_FIELDS = ['displayName', 'imageSource', 'imageObjectId'] as const;

const PROFILE_FIELD_PATTERN = /^[a-z][A-Za-z0-9]*$/;

/** Throws when `schema` is not bounded enough for a value the user writes. */
function assertBounded(schema: z.ZodType, name: string): void {
  walkSchema(schema, (def, path) => {
    const where = path ? `${name}.${path}` : name;
    const node = def as { type?: string; checks?: Array<{ _zod?: { def?: { check?: string; maximum?: unknown } } }> };
    const hasMax = (node.checks ?? []).some((check) => {
      const kind = check._zod?.def?.check;
      return kind === 'max_length' || kind === 'length_equals' || kind === 'less_than' || kind === 'max_size';
    });
    switch (node.type) {
      case 'string':
        if (!hasMax) throw new Error(`profile field "${where}" is an unbounded string; add .max(n): a user writes this value themselves`);
        break;
      case 'array':
        if (!hasMax) throw new Error(`profile field "${where}" is an unbounded array; add .max(n)`);
        break;
      case 'record':
      case 'any':
      case 'unknown':
        throw new Error(`profile field "${where}" is free-form (record, any or unknown); declare its keys and bound them`);
    }
  });
}

function validateProfileField(field: UserProfileField): void {
  if (!PROFILE_FIELD_PATTERN.test(field.name)) throw new Error(`"${field.name}" is not a field name`);
  if ((CORE_PROFILE_FIELDS as readonly string[]).includes(field.name)) {
    throw new Error(`"${field.name}" is a core profile field; an extension only adds fields`);
  }
  if (!isZodSchema(field.schema)) throw new Error('schema must be a zod schema');
  if (!field.schema.safeParse(undefined).success) {
    throw new Error(
      `profile field "${field.name}" must be optional: a profile saved before the field existed has no value (use .optional())`,
    );
  }
  const defaults = findDefaultPaths(field.schema);
  if (defaults.length > 0) {
    throw new Error(`profile field "${field.name}" carries .default() at ${defaults.join(', ')}; absent must stay absent`);
  }
  const denied = [...SETTINGS_SECRET_FIELD_NAMES];
  const holder = z.object({ [field.name]: field.schema });
  const secrets = findSecretFieldPaths(holder, denied);
  if (secrets.length > 0) throw new Error(secretFieldMessage('profile', secrets, 'user'));
  assertBounded(field.schema, field.name);
}

/**
 * The fields apps added to `profile`, one entry per field, in registration
 * order. Frozen when the application bootstraps.
 *
 * @extensionPoint registry
 * @stability experimental
 */
export const userProfileFieldRegistry = defineRegistry<UserProfileField>({
  name: 'user-profile-fields',
  idOf: (field) => field.name,
  idPattern: PROFILE_FIELD_PATTERN,
  validate: validateProfileField,
  describeDuplicate: (_existing, incoming) =>
    `Profile field "${incoming.name}" is already registered. Another extension (or a package) added it first.`,
});

/**
 * Adds optional fields to a user's `profile`. Call it at import time, before
 * `SettingsModule.forRoot()` composes the request bodies. The fields are part
 * of `PUT` (omitted means cleared, except `imageObjectId`, which is the
 * platform's), `PATCH` (`null` deletes one, absent keeps it) and the response;
 * a user can write only their own.
 *
 * @param extension - the added fields: a `z.object` whose every field is
 *   optional, bounded and not `.default()`ed.
 * @throws RegistryError naming the field when it is a core profile field,
 *   already added, required, defaulted, unbounded, free-form or secret-named.
 *
 * @example
 * ```ts
 * extendUserProfile({ fields: z.object({ timezone: z.string().max(64).optional() }) });
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function extendUserProfile(extension: { fields: z.ZodObject<z.ZodRawShape> }): void {
  if (!(extension.fields instanceof z.ZodObject)) throw new Error('extendUserProfile: fields must be a z.object');
  userProfileFieldRegistry.registerAll(
    Object.entries(extension.fields.shape).map(([name, schema]) => ({ name, schema: schema as z.ZodType })),
  );
}

/** The stored `profile` schema: the contract's, plus the registered fields. */
export function composeUserProfileSchema(): z.ZodObject<z.ZodRawShape> {
  const fields = userProfileFieldRegistry.list();
  if (fields.length === 0) return userProfileSettingsSchema as unknown as z.ZodObject<z.ZodRawShape>;
  return userProfileSettingsSchema.extend(
    Object.fromEntries(fields.map((field) => [field.name, field.schema])),
  ) as unknown as z.ZodObject<z.ZodRawShape>;
}

/** The `profile` PATCH schema: the contract's, plus the registered fields as `.nullable().optional()` (`null` deletes one). */
export function composeUserProfilePatchSchema(): z.ZodObject<z.ZodRawShape> {
  const fields = userProfileFieldRegistry.list();
  if (fields.length === 0) return userProfileSettingsPatchSchema as unknown as z.ZodObject<z.ZodRawShape>;
  return userProfileSettingsPatchSchema.extend(
    Object.fromEntries(fields.map((field) => [field.name, field.schema.nullable().optional()])),
  ) as unknown as z.ZodObject<z.ZodRawShape>;
}

/** The documented `profile` of the user settings response: the contract's three fields, plus the registered ones. */
export function composeUserProfileResponseSchema(): z.ZodObject<z.ZodRawShape> {
  const fields = userProfileFieldRegistry.list();
  return z.object({
    displayName: z.string().nullable().optional(),
    imageSource: profileImageSourceSchema,
    // Always present in responses; `null` when no avatar has been uploaded.
    imageObjectId: z.string().uuid().nullable(),
    ...Object.fromEntries(fields.map((field) => [field.name, field.schema])),
  });
}

/**
 * The registered profile fields' values out of a stored `profile`, each one
 * that parses against its own schema (a value that no longer validates is
 * dropped, never returned).
 *
 * @param stored - the raw `profile` value of the settings row.
 * @returns the extension fields present and valid.
 */
export function readProfileExtensions(stored: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (stored === null || typeof stored !== 'object' || Array.isArray(stored)) return out;
  const source = stored as Record<string, unknown>;
  for (const field of userProfileFieldRegistry.list()) {
    const value = source[field.name];
    if (value === undefined || value === null) continue;
    const parsed = field.schema.safeParse(value);
    if (parsed.success && parsed.data !== undefined) out[field.name] = parsed.data;
  }
  return out;
}

// -----------------------------------------------------------------------------
// theme
// -----------------------------------------------------------------------------

/**
 * A theme an app registers beside the built-in light, dark and system choices.
 *
 * @stability experimental
 */
export interface ThemePreferenceDefinition {
  /**
   * The id stored in `theme` (`high-contrast`). Matches
   * `THEME_PREFERENCE_ID_PATTERN`; not `light`, `dark` or `system`. Permanent
   * once a user stored it.
   */
  readonly id: string;
  /** The label the theme control shows. */
  readonly label: string;
}

/**
 * The themes apps registered on top of the built-in three, in registration
 * order. The built-ins are the contract's constant, not entries here: the
 * response lists `themeOptions` only when this registry is non-empty, so a
 * deployment that registers none serves exactly the shapes it always did.
 *
 * @extensionPoint registry
 * @stability experimental
 */
export const themePreferenceRegistry = defineRegistry<ThemePreferenceDefinition>({
  name: 'theme-preferences',
  idOf: (theme) => theme.id,
  idPattern: THEME_PREFERENCE_ID_PATTERN,
  validate: (theme) => {
    if ((THEME_PREFERENCES as readonly string[]).includes(theme.id)) {
      throw new Error(`"${theme.id}" is a built-in theme preference`);
    }
    if (typeof theme.label !== 'string' || theme.label.trim() === '' || theme.label.length > THEME_OPTION_LABEL_MAX) {
      throw new Error(`label must be 1 to ${THEME_OPTION_LABEL_MAX} characters`);
    }
  },
});

/**
 * Registers a theme id `theme` accepts and `GET /api/user-settings` lists in
 * `themeOptions`. The API stores and validates the id; what the theme LOOKS
 * like is the web app's (its theme registry applies the stored id). Call it at
 * import time, before `SettingsModule.forRoot()`.
 *
 * @param theme - the id and label.
 * @throws RegistryError when the id is malformed, built in, already registered or the label is empty.
 *
 * @example
 * ```ts
 * registerThemePreference({ id: 'high-contrast', label: 'High contrast' });
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function registerThemePreference(theme: ThemePreferenceDefinition): void {
  themePreferenceRegistry.register({ id: theme.id, label: theme.label });
}

/** The `theme` schema: the contract's enum, or the enum plus the registered ids. */
export function composeThemeSchema(): z.ZodType<string> {
  const extra = themePreferenceRegistry.ids();
  if (extra.length === 0) return themePreferenceSchema;
  return z.enum([...THEME_PREFERENCES, ...extra] as [string, ...string[]]);
}

/** The registered themes as the response lists them; empty when none. */
export function themeOptions(): ThemeOption[] {
  return themePreferenceRegistry.list().map((theme) => ({ id: theme.id, label: theme.label }));
}

/** The schema of the response's `themeOptions`, present only when themes are registered. */
export function composeThemeOptionsResponseShape(): Record<string, z.ZodType> {
  return themePreferenceRegistry.size === 0 ? {} : { themeOptions: z.array(themeOptionSchema).optional() };
}

/** Whether `id` is a built-in or registered theme. */
export function isKnownTheme(id: unknown): id is string {
  return typeof id === 'string' && ((THEME_PREFERENCES as readonly string[]).includes(id) || themePreferenceRegistry.has(id));
}
