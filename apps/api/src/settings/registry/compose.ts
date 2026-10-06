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
// when it is called. `composed.ts` imports the manifests and calls these once,
// at module load, for the import-time consumers (DTO classes, the defaults);
// `SystemSettingsService` and `UserSettingsService` call the `current*`
// variants per request, so a namespace added with `withTemporaryEntries` in a
// test is validated, merged and stored like any other.
// =============================================================================

import { z } from 'zod';
import { userProfileSettingsPatchSchema, userProfileSettingsSchema } from '../../common/schemas/settings.schema';
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

/** Shape of `systemSettingsSchema` (place 1). */
export type ComposedSystemSettingsShape = { [K in keyof SysDecls]: SysField<K, 'storedSchema'> };
/** Shape of `systemSettingsPatchSchema` (place 2). */
export type ComposedSystemSettingsPatchShape = { [K in keyof SysDecls]: z.ZodOptional<SysField<K, 'patchSchema'>> };
/** Shape of `updateSystemSettingsSchema`, the PUT body (place 3). */
export type ComposedUpdateSystemSettingsShape = {
  [K in keyof SysDecls]: SysDecls[K] extends { requiredOnPut: true }
    ? SysField<K, 'putSchema'>
    : z.ZodOptional<SysField<K, 'putSchema'>>;
};
/** Shape of `patchSystemSettingsSchema`, the PATCH body (place 4). */
export type ComposedPatchSystemSettingsShape = {
  [K in keyof SysDecls]: z.ZodOptional<SysField<K, 'wirePatchSchema'>>;
};
/** The namespace branches of `systemSettingsResponseSchema`; `null` responses are left out. */
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

/** The optional user namespaces of `userSettingsSchema` (`.optional()`). */
export type ComposedUserSettingsShape = { [K in keyof UserDecls]: z.ZodOptional<UserField<K, 'schema'>> };
/** The optional user namespaces of `userSettingsPatchSchema` (`.nullable().optional()`). */
export type ComposedUserSettingsPatchShape = {
  [K in keyof UserDecls]: z.ZodOptional<z.ZodNullable<UserField<K, 'patchSchema'>>>;
};
/** The optional user namespaces of `updateUserSettingsSchema`, the PUT body. */
export type ComposedUpdateUserSettingsShape = {
  [K in keyof UserDecls]: z.ZodOptional<UserFieldOr<K, 'putSchema', 'schema'>>;
};
/** The optional user namespaces of `patchUserSettingsSchema`, the PATCH body. */
export type ComposedPatchUserSettingsShape = {
  [K in keyof UserDecls]: z.ZodOptional<z.ZodNullable<UserFieldOr<K, 'wirePatchSchema', 'patchSchema'>>>;
};
/** The optional user namespaces of `userSettingsResponseSchema`; `null` responses are left out. */
export type ComposedUserSettingsResponseShape = {
  [K in keyof UserDecls as [UserFieldOr<K, 'responseSchema', 'schema'>] extends [never] ? never : K]: z.ZodOptional<
    UserFieldOr<K, 'responseSchema', 'schema'>
  >;
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

/** `systemSettingsSchema`: every namespace's `storedSchema`, required, in registration order. */
export function composeSystemSettingsSchema(namespaces?: readonly SystemSettingsNamespace[]) {
  const shape = shapeOf(systemNamespaces(namespaces), (ns) => ns.key, (ns) => ns.storedSchema);
  return z.object(shape) as unknown as z.ZodObject<ComposedSystemSettingsShape>;
}

/** `systemSettingsPatchSchema`: every namespace's `patchSchema.optional()`. */
export function composeSystemSettingsPatchSchema(namespaces?: readonly SystemSettingsNamespace[]) {
  const shape = shapeOf(systemNamespaces(namespaces), (ns) => ns.key, (ns) => ns.patchSchema.optional());
  return z.object(shape) as unknown as z.ZodObject<ComposedSystemSettingsPatchShape>;
}

/** `updateSystemSettingsSchema` (PUT body): `requiredOnPut ? putSchema : putSchema.optional()`. */
export function composeUpdateSystemSettingsSchema(namespaces?: readonly SystemSettingsNamespace[]) {
  const shape = shapeOf(
    systemNamespaces(namespaces),
    (ns) => ns.key,
    (ns) => (ns.requiredOnPut ? ns.putSchema : ns.putSchema.optional()),
  );
  return z.object(shape) as unknown as z.ZodObject<ComposedUpdateSystemSettingsShape>;
}

/** `patchSystemSettingsSchema` (PATCH body): every namespace's `wirePatchSchema.optional()`. */
export function composePatchSystemSettingsSchema(namespaces?: readonly SystemSettingsNamespace[]) {
  const shape = shapeOf(systemNamespaces(namespaces), (ns) => ns.key, (ns) => ns.wirePatchSchema.optional());
  return z.object(shape) as unknown as z.ZodObject<ComposedPatchSystemSettingsShape>;
}

/**
 * The namespace branches of `systemSettingsResponseSchema`, to spread between
 * its core fields (`security` first; `updatedAt`, `updatedBy`, `version` last).
 * Namespaces whose `responseSchema` is `null` are left out.
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

/** `DEFAULT_SYSTEM_SETTINGS`: every namespace's `defaults`, in registration order (not cloned). */
export function composeDefaultSystemSettings(namespaces?: readonly SystemSettingsNamespace[]): SystemSettingsValue {
  const value: Record<string, unknown> = {};
  for (const ns of systemNamespaces(namespaces)) value[ns.key] = ns.defaults;
  return value as SystemSettingsValue;
}

// -----------------------------------------------------------------------------
// User settings (the OPTIONAL namespaces; `theme` and `profile` are core fields
// the DTO files and `composed.ts` place ahead of them)
// -----------------------------------------------------------------------------

/** The five composed user-settings shapes, namespaces only, in registration order. */
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
 */
export function composeUserSettingsSchema(namespaces?: readonly UserSettingsNamespace[]) {
  return z.object({
    theme: z.enum(['light', 'dark', 'system']),
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
 */
export function composeUserSettingsPatchSchema(namespaces?: readonly UserSettingsNamespace[]) {
  return z.object({
    theme: z.enum(['light', 'dark', 'system']).optional(),
    profile: userProfileSettingsPatchSchema.optional(),
    ...composeUserSettingsSchemas(namespaces).patch,
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

/** `composeSystemSettingsSchema()` over the registry as it is now. */
export const currentSystemSettingsSchema = memoOnEntries(
  () => systemSettingsNamespaceRegistry.list(),
  (entries) => composeSystemSettingsSchema(entries),
);

/** `composeUpdateSystemSettingsSchema()` over the registry as it is now. */
export const currentUpdateSystemSettingsSchema = memoOnEntries(
  () => systemSettingsNamespaceRegistry.list(),
  (entries) => composeUpdateSystemSettingsSchema(entries),
);

/** `composeUserSettingsSchema()` over the registry as it is now. */
export const currentUserSettingsSchema = memoOnEntries(
  () => userSettingsNamespaceRegistry.list(),
  (entries) => composeUserSettingsSchema(entries),
);
