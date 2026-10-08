// =============================================================================
// Settings composition: pure functions of the namespace registries (issue #677)
// =============================================================================
//
// Every top-level settings object the code used to write out by hand —
// `systemSettingsSchema`, its partial, the PUT and PATCH request bodies, the
// response, `DEFAULT_SYSTEM_SETTINGS`, and the user-settings equivalents — is
// a fold over a registry's entries, in registration order. Zod object key
// order drives the OpenAPI document and the stored JSON's key order, so
// "registration order" is a contract (see the manifests).
//
// This file never imports a manifest: it composes whatever the registry holds
// when it is called. The app's composition (the reference app's
// `settings/registry/composed.ts`) imports its manifests and calls these once,
// at module load, for its import-time consumers; `SettingsModule.forRoot()`
// calls them when it builds the request-body DTOs;
// `SystemSettingsService` and `UserSettingsService` call the `current*`
// variants per request, so a namespace added with `withTemporaryEntries` in a
// test is validated, merged and stored like any other.
// =============================================================================

import { z } from 'zod';
import {
  profileImageSourceSchema,
  themePreferenceSchema,
  userProfileSettingsPatchSchema,
  userProfileSettingsSchema,
} from '@marinoscar/platform-contract/settings';
import {
  systemSettingsNamespaceRegistry,
  type SystemSettingsNamespace,
  type SystemSettingsNamespaceDeclarations,
  type SystemSettingsValue,
} from './system-settings-namespace';
import {
  userSettingsNamespaceRegistry,
  type UserSettingsNamespace,
  type UserSettingsNamespaceDeclarations,
} from './user-settings-namespace';

// -----------------------------------------------------------------------------
// Static types: the composed shapes, per platform declaration
// -----------------------------------------------------------------------------

type SysDecls = SystemSettingsNamespaceDeclarations;
type SysField<K extends keyof SysDecls, F extends string> = SysDecls[K] extends Record<F, infer S>
  ? Extract<S, z.ZodType>
  : never;

/**
 * Shape of `systemSettingsSchema` (place 1).
 *
 * @stability experimental
 */
export type ComposedSystemSettingsShape = { [K in keyof SysDecls]: SysField<K, 'storedSchema'> };
/**
 * Shape of `systemSettingsPatchSchema` (place 2).
 *
 * @stability experimental
 */
export type ComposedSystemSettingsPatchShape = { [K in keyof SysDecls]: z.ZodOptional<SysField<K, 'patchSchema'>> };
/**
 * Shape of `updateSystemSettingsSchema`, the PUT body (place 3).
 *
 * @stability experimental
 */
export type ComposedUpdateSystemSettingsShape = {
  [K in keyof SysDecls]: SysDecls[K] extends { requiredOnPut: true }
    ? SysField<K, 'putSchema'>
    : z.ZodOptional<SysField<K, 'putSchema'>>;
};
/**
 * Shape of `patchSystemSettingsSchema`, the PATCH body (place 4).
 *
 * @stability experimental
 */
export type ComposedPatchSystemSettingsShape = {
  [K in keyof SysDecls]: z.ZodOptional<SysField<K, 'wirePatchSchema'>>;
};
/**
 * The namespace branches of `systemSettingsResponseSchema`; `null` responses are left out.
 *
 * @stability experimental
 */
export type ComposedSystemSettingsResponseShape = {
  [K in keyof SysDecls as [SysField<K, 'responseSchema'>] extends [never] ? never : K]: SysField<K, 'responseSchema'>;
};

type UserDecls = UserSettingsNamespaceDeclarations;
type UserField<K extends keyof UserDecls, F extends string> = UserDecls[K] extends Record<F, infer S>
  ? Extract<S, z.ZodType>
  : never;
/** `putSchema ?? schema`, `wirePatchSchema ?? patchSchema`, `responseSchema ?? schema`, statically. */
type UserFieldOr<K extends keyof UserDecls, F extends string, Fallback extends string> = [UserField<K, F>] extends [
  never,
]
  ? UserDecls[K] extends Record<F, null>
    ? never
    : UserField<K, Fallback>
  : UserField<K, F>;

/**
 * The optional user namespaces of `userSettingsSchema` (`.optional()`).
 *
 * @stability experimental
 */
export type ComposedUserSettingsShape = { [K in keyof UserDecls]: z.ZodOptional<UserField<K, 'schema'>> };
/**
 * The optional user namespaces of `userSettingsPatchSchema` (`.nullable().optional()`).
 *
 * @stability experimental
 */
export type ComposedUserSettingsPatchShape = {
  [K in keyof UserDecls]: z.ZodOptional<z.ZodNullable<UserField<K, 'patchSchema'>>>;
};
/**
 * The optional user namespaces of `updateUserSettingsSchema`, the PUT body.
 *
 * @stability experimental
 */
export type ComposedUpdateUserSettingsShape = {
  [K in keyof UserDecls]: z.ZodOptional<UserFieldOr<K, 'putSchema', 'schema'>>;
};
/**
 * The optional user namespaces of `patchUserSettingsSchema`, the PATCH body.
 *
 * @stability experimental
 */
export type ComposedPatchUserSettingsShape = {
  [K in keyof UserDecls]: z.ZodOptional<z.ZodNullable<UserFieldOr<K, 'wirePatchSchema', 'patchSchema'>>>;
};
/**
 * The optional user namespaces of `userSettingsResponseSchema`; `null` responses are left out.
 *
 * @stability experimental
 */
export type ComposedUserSettingsResponseShape = {
  [K in keyof UserDecls as [UserFieldOr<K, 'responseSchema', 'schema'>] extends [never] ? never : K]: z.ZodOptional<
    UserFieldOr<K, 'responseSchema', 'schema'>
  >;
};

/**
 * The stored system settings document as `composeSystemSettingsSchema()`
 * parses it (typed by the `SystemSettingsNamespaceDeclarations` augmentation).
 *
 * @stability experimental
 */
export type SystemSettingsDto = z.infer<z.ZodObject<ComposedSystemSettingsShape>>;

/**
 * A parsed `PUT /api/system-settings` body (the reference app's
 * `UpdateSystemSettingsDto`).
 *
 * @stability experimental
 */
export type ComposedUpdateBody = z.infer<z.ZodObject<ComposedUpdateSystemSettingsShape>>;

/**
 * A parsed `PATCH /api/system-settings` body (the reference app's
 * `PatchSystemSettingsDto`).
 *
 * @stability experimental
 */
export type ComposedPatchBody = z.infer<z.ZodObject<ComposedPatchSystemSettingsShape>>;

/**
 * A parsed `PUT /api/user-settings` body.
 *
 * @stability experimental
 */
export type ComposedUpdateUserBody = z.infer<ReturnType<typeof composeUpdateUserSettingsSchema>>;

/**
 * A parsed `PATCH /api/user-settings` body.
 *
 * @stability experimental
 */
export type ComposedPatchUserBody = z.infer<ReturnType<typeof composePatchUserSettingsSchema>>;

/**
 * The stored user settings document as `composeUserSettingsSchema()` parses it.
 *
 * @stability experimental
 */
export type UserSettingsDto = z.infer<ReturnType<typeof composeUserSettingsSchema>>;

/**
 * The core fields of the stored user settings document, ahead of every namespace.
 *
 * @stability experimental
 */
export type UserSettingsCoreShape = {
  theme: typeof themePreferenceSchema;
  profile: typeof userProfileSettingsSchema;
};

/**
 * The core fields of the user settings PATCH bodies.
 *
 * @stability experimental
 */
export type UserSettingsCorePatchShape = {
  theme: z.ZodOptional<typeof themePreferenceSchema>;
  profile: z.ZodOptional<typeof userProfileSettingsPatchSchema>;
};

/**
 * The core fields of the user settings response.
 *
 * @stability experimental
 */
export type UserSettingsCoreResponseShape = {
  theme: typeof themePreferenceSchema;
  profile: z.ZodObject<{
    displayName: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    imageSource: typeof profileImageSourceSchema;
    imageObjectId: z.ZodNullable<z.ZodString>;
  }>;
  updatedAt: z.ZodISODateTime;
  version: z.ZodNumber;
};

/**
 * The core fields of the system settings response around the namespace branches.
 *
 * @stability experimental
 */
export type SystemSettingsCoreResponseShape = {
  security: z.ZodObject<{ jwtAccessTtlMinutes: z.ZodNumber; refreshTtlDays: z.ZodNumber }>;
  updatedAt: z.ZodISODateTime;
  updatedBy: z.ZodNullable<z.ZodObject<{ id: z.ZodString; email: z.ZodString }>>;
  version: z.ZodNumber;
};

// -----------------------------------------------------------------------------
// System settings
// -----------------------------------------------------------------------------

function systemNamespaces(namespaces?: readonly SystemSettingsNamespace[]): readonly SystemSettingsNamespace[] {
  return namespaces ?? systemSettingsNamespaceRegistry.list();
}

function shapeOf<N>(namespaces: readonly N[], keyOf: (ns: N) => string, branch: (ns: N) => z.ZodType | null) {
  const shape: Record<string, z.ZodType> = {};
  for (const ns of namespaces) {
    const schema = branch(ns);
    if (schema !== null) shape[keyOf(ns)] = schema;
  }
  return shape;
}

/**
 * `systemSettingsSchema`: every namespace's `storedSchema`, required, in registration order.
 *
 * @stability experimental
 */
export function composeSystemSettingsSchema(namespaces?: readonly SystemSettingsNamespace[]) {
  const shape = shapeOf(systemNamespaces(namespaces), (ns) => ns.key, (ns) => ns.storedSchema);
  return z.object(shape) as unknown as z.ZodObject<ComposedSystemSettingsShape>;
}

/**
 * `systemSettingsPatchSchema`: every namespace's `patchSchema.optional()`.
 *
 * @stability experimental
 */
export function composeSystemSettingsPatchSchema(namespaces?: readonly SystemSettingsNamespace[]) {
  const shape = shapeOf(systemNamespaces(namespaces), (ns) => ns.key, (ns) => ns.patchSchema.optional());
  return z.object(shape) as unknown as z.ZodObject<ComposedSystemSettingsPatchShape>;
}

/**
 * `updateSystemSettingsSchema` (PUT body): `requiredOnPut ? putSchema : putSchema.optional()`.
 *
 * @stability experimental
 */
export function composeUpdateSystemSettingsSchema(namespaces?: readonly SystemSettingsNamespace[]) {
  const shape = shapeOf(
    systemNamespaces(namespaces),
    (ns) => ns.key,
    (ns) => (ns.requiredOnPut ? ns.putSchema : ns.putSchema.optional()),
  );
  return z.object(shape) as unknown as z.ZodObject<ComposedUpdateSystemSettingsShape>;
}

/**
 * `patchSystemSettingsSchema` (PATCH body): every namespace's `wirePatchSchema.optional()`.
 *
 * @stability experimental
 */
export function composePatchSystemSettingsSchema(namespaces?: readonly SystemSettingsNamespace[]) {
  const shape = shapeOf(systemNamespaces(namespaces), (ns) => ns.key, (ns) => ns.wirePatchSchema.optional());
  return z.object(shape) as unknown as z.ZodObject<ComposedPatchSystemSettingsShape>;
}

/**
 * The namespace branches of `systemSettingsResponseSchema`, to spread between
 * its core fields (`security` first; `updatedAt`, `updatedBy`, `version` last).
 * Namespaces whose `responseSchema` is `null` are left out.
 *
 * @stability experimental
 */
export function composeSystemSettingsResponseValue(
  namespaces?: readonly SystemSettingsNamespace[],
): ComposedSystemSettingsResponseShape {
  return shapeOf(
    systemNamespaces(namespaces),
    (ns) => ns.key,
    (ns) => ns.responseSchema,
  ) as unknown as ComposedSystemSettingsResponseShape;
}

/**
 * `DEFAULT_SYSTEM_SETTINGS`: every namespace's `defaults`, in registration order (not cloned).
 *
 * @stability experimental
 */
export function composeDefaultSystemSettings(namespaces?: readonly SystemSettingsNamespace[]): SystemSettingsValue {
  const value: Record<string, unknown> = {};
  for (const ns of systemNamespaces(namespaces)) value[ns.key] = ns.defaults;
  return value as SystemSettingsValue;
}

// -----------------------------------------------------------------------------
// User settings (the OPTIONAL namespaces; `theme` and `profile` are core fields
// the DTO files and `composed.ts` place ahead of them)
// -----------------------------------------------------------------------------

/**
 * The five composed user-settings shapes, namespaces only, in registration order.
 *
 * @stability experimental
 */
export interface ComposedUserSettingsShapes {
  /** `schema.optional()`: the stored namespaces (`userSettingsSchema`). */
  stored: ComposedUserSettingsShape;
  /** `patchSchema.nullable().optional()`: `null` clears the namespace (`userSettingsPatchSchema`). */
  patch: ComposedUserSettingsPatchShape;
  /** `(putSchema ?? schema).optional()`: the PUT body (`updateUserSettingsSchema`). */
  put: ComposedUpdateUserSettingsShape;
  /** `(wirePatchSchema ?? patchSchema).nullable().optional()`: the PATCH body (`patchUserSettingsSchema`). */
  wirePatch: ComposedPatchUserSettingsShape;
  /** `(responseSchema ?? schema).optional()`, `null` left out: the response (`userSettingsResponseSchema`). */
  response: ComposedUserSettingsResponseShape;
}

/**
 * The namespace shapes of the five user-settings objects. Shapes rather than
 * objects because each of the five puts its own core fields (`theme`,
 * `profile`, and in the response `updatedAt`, `version`) around them.
 *
 * @stability experimental
 */
export function composeUserSettingsSchemas(namespaces?: readonly UserSettingsNamespace[]): ComposedUserSettingsShapes {
  const list = namespaces ?? userSettingsNamespaceRegistry.list();
  const key = (ns: UserSettingsNamespace) => ns.key;
  return {
    stored: shapeOf(list, key, (ns) => ns.schema.optional()) as unknown as ComposedUserSettingsShape,
    patch: shapeOf(list, key, (ns) => ns.patchSchema.nullable().optional()) as unknown as ComposedUserSettingsPatchShape,
    put: shapeOf(list, key, (ns) => (ns.putSchema ?? ns.schema).optional()) as unknown as ComposedUpdateUserSettingsShape,
    wirePatch: shapeOf(list, key, (ns) =>
      (ns.wirePatchSchema ?? ns.patchSchema).nullable().optional(),
    ) as unknown as ComposedPatchUserSettingsShape,
    response: shapeOf(list, key, (ns) =>
      ns.responseSchema === null ? null : (ns.responseSchema ?? ns.schema).optional(),
    ) as unknown as ComposedUserSettingsResponseShape,
  };
}

/**
 * `userSettingsSchema`: the stored user settings, core fields (`theme`,
 * `profile`) first, then every namespace `.optional()`.
 *
 * @stability experimental
 */
export function composeUserSettingsSchema(
  namespaces?: readonly UserSettingsNamespace[],
): z.ZodObject<UserSettingsCoreShape & ComposedUserSettingsShape> {
  return z.object({
    theme: themePreferenceSchema,
    profile: userProfileSettingsSchema,
    // Optional namespaces. Absent means "use built-in defaults" — see
    // user-settings-namespaces.schema.ts for why these must never get `.default()`.
    ...composeUserSettingsSchemas(namespaces).stored,
  });
}

/**
 * `userSettingsPatchSchema`: the canonical partial (zod v4 has no
 * `deepPartial`), core fields first, then every namespace
 * `.nullable().optional()` — the outer `.nullable()` is what lets
 * `{ "dataTables": null }` clear a whole namespace.
 *
 * @stability experimental
 */
export function composeUserSettingsPatchSchema(
  namespaces?: readonly UserSettingsNamespace[],
): z.ZodObject<UserSettingsCorePatchShape & ComposedUserSettingsPatchShape> {
  return z.object({
    theme: themePreferenceSchema.optional(),
    profile: userProfileSettingsPatchSchema.optional(),
    ...composeUserSettingsSchemas(namespaces).patch,
  });
}

// -----------------------------------------------------------------------------
// The request bodies and responses of the two routes (moved from the reference
// app's `settings/dto/*.dto.ts` by #733; field order is the OpenAPI document's)
// -----------------------------------------------------------------------------

/**
 * `systemSettingsResponseSchema`: the `GET /api/system-settings` payload, the
 * derived `security` block first, every documented namespace branch in
 * registration order, then the audit fields and the version.
 *
 * @stability experimental
 */
export function composeSystemSettingsResponseSchema(
  namespaces?: readonly SystemSettingsNamespace[],
): z.ZodObject<SystemSettingsCoreResponseShape & ComposedSystemSettingsResponseShape> {
  return z.object({
    security: z.object({
      jwtAccessTtlMinutes: z.number(),
      refreshTtlDays: z.number(),
    }),
    ...composeSystemSettingsResponseValue(namespaces),
    updatedAt: z.iso.datetime(),
    updatedBy: z
      .object({
        id: z.string().uuid(),
        email: z.string().email(),
      })
      .nullable(),
    version: z.number(),
  });
}

/**
 * `updateUserSettingsSchema`: the `PUT /api/user-settings` body. `theme` and
 * `profile` are required; every namespace is optional (a PUT states the
 * settings in full, so `null` has no "delete" meaning: omit a namespace to
 * store nothing for it). Omitting `profile.imageObjectId` keeps the stored one.
 *
 * @stability experimental
 */
export function composeUpdateUserSettingsSchema(
  namespaces?: readonly UserSettingsNamespace[],
): z.ZodObject<UserSettingsCoreShape & ComposedUpdateUserSettingsShape> {
  return z.object({
    theme: themePreferenceSchema,
    profile: userProfileSettingsSchema,
    ...composeUserSettingsSchemas(namespaces).put,
  });
}

/**
 * `patchUserSettingsSchema`: the `PATCH /api/user-settings` body (JSON Merge
 * Patch style). Every namespace is `.nullable().optional()`: `null` clears it.
 *
 * @stability experimental
 */
export function composePatchUserSettingsSchema(
  namespaces?: readonly UserSettingsNamespace[],
): z.ZodObject<UserSettingsCorePatchShape & ComposedPatchUserSettingsShape> {
  return z.object({
    theme: themePreferenceSchema.optional(),
    profile: userProfileSettingsPatchSchema.optional(),
    ...composeUserSettingsSchemas(namespaces).wirePatch,
  });
}

/**
 * `userSettingsResponseSchema`: the `GET /api/user-settings` payload. A
 * namespace is emitted only when the user stored something for it: absent is
 * information (apply the built-in defaults), not an omission.
 *
 * @stability experimental
 */
export function composeUserSettingsResponseSchema(
  namespaces?: readonly UserSettingsNamespace[],
): z.ZodObject<UserSettingsCoreResponseShape & ComposedUserSettingsResponseShape> {
  return z.object({
    theme: themePreferenceSchema,
    profile: z.object({
      displayName: z.string().nullable().optional(),
      imageSource: profileImageSourceSchema,
      // Always present in responses; `null` when no avatar has been uploaded.
      imageObjectId: z.string().uuid().nullable(),
    }),
    ...composeUserSettingsSchemas(namespaces).response,
    updatedAt: z.iso.datetime(),
    version: z.number(),
  });
}

// -----------------------------------------------------------------------------
// Per-request composition for the services
// -----------------------------------------------------------------------------

/**
 * Memoise `build` on the registry's current entries: recomputed only when an
 * entry is added, removed or replaced (in practice, only inside
 * `withTemporaryEntries` in a test; the registries are frozen at bootstrap).
 */
function memoOnEntries<N, R>(list: () => readonly N[], build: (entries: readonly N[]) => R): () => R {
  let cachedEntries: readonly N[] | undefined;
  let cached: R | undefined;
  return () => {
    const entries = list();
    const same =
      cachedEntries !== undefined &&
      cachedEntries.length === entries.length &&
      cachedEntries.every((entry, index) => entry === entries[index]);
    if (!same) {
      cachedEntries = entries;
      cached = build(entries);
    }
    return cached as R;
  };
}

/**
 * `composeSystemSettingsSchema()` over the registry as it is now.
 *
 * @stability experimental
 */
export const currentSystemSettingsSchema = memoOnEntries(
  () => systemSettingsNamespaceRegistry.list(),
  (entries) => composeSystemSettingsSchema(entries),
);

/**
 * `composeUpdateSystemSettingsSchema()` over the registry as it is now.
 *
 * @stability experimental
 */
export const currentUpdateSystemSettingsSchema = memoOnEntries(
  () => systemSettingsNamespaceRegistry.list(),
  (entries) => composeUpdateSystemSettingsSchema(entries),
);

/**
 * `composePatchSystemSettingsSchema()` (the PATCH body) over the registry as it is now.
 *
 * @stability experimental
 */
export const currentPatchSystemSettingsSchema = memoOnEntries(
  () => systemSettingsNamespaceRegistry.list(),
  (entries) => composePatchSystemSettingsSchema(entries),
);

/**
 * `composeUserSettingsSchema()` over the registry as it is now.
 *
 * @stability experimental
 */
export const currentUserSettingsSchema = memoOnEntries(
  () => userSettingsNamespaceRegistry.list(),
  (entries) => composeUserSettingsSchema(entries),
);
