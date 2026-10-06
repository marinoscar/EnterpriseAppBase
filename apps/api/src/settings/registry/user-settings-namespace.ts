// =============================================================================
// User settings namespace registry (issue #677, PP-1.5)
// =============================================================================
//
// The OPTIONAL namespaces of `user_settings.value` (`dataTables`, `navigation`,
// `notifications`, `ai`, and any an app adds), each declared once beside the
// module that owns it as one `UserSettingsNamespace`. `theme` and `profile` are
// core fields, not namespaces: the DTO files and `composed.ts` place them
// ahead of every namespace.
//
// ABSENT IS INFORMATION. A user namespace is always `.optional()` in the
// stored shape and never `.default()` anywhere (registration refuses one): an
// absent namespace means "use the built-in defaults", and materialising it
// would freeze a user at today's defaults (see the header of
// `common/schemas/user-settings-namespaces.schema.ts`).
//
// Framework-free: zod and the registry primitive only. Recipe: README.md next
// to this file.
// =============================================================================

import { z } from 'zod';
import { defineRegistry } from '../../common/registry';
import { SETTINGS_SECRET_FIELD_NAMES } from '../../common/schemas/settings.schema';
import { findDefaultPaths, findSecretFieldPaths, isZodSchema } from './schema-walk';
import { SETTINGS_NAMESPACE_KEY_PATTERN } from './system-settings-namespace';

/**
 * One optional namespace of a user's settings document.
 *
 * @typeParam K - the top-level key, e.g. `'dataTables'`.
 * @typeParam V - the stored value type.
 * @typeParam P - the parsed PATCH body branch `merge` receives (without `null`).
 */
export interface UserSettingsNamespace<K extends string = string, V = unknown, P = unknown> {
  /** Top-level key in `user_settings.value`. Matches `/^[a-z][A-Za-z0-9]*$/`. */
  readonly key: K;
  /** One sentence on what the namespace holds (docs and error messages). */
  readonly description: string;
  /** The stored shape; composed with `.optional()`, never `.default()`. Bounded. */
  readonly schema: z.ZodType<V>;
  /** The canonical partial; composed with `.nullable().optional()` (`null` clears the namespace). */
  readonly patchSchema: z.ZodType;
  /** The PUT request-body branch. Default: `schema`. */
  readonly putSchema?: z.ZodType;
  /** The PATCH request-body branch. Default: `patchSchema`. */
  readonly wirePatchSchema?: z.ZodType;
  /**
   * The branch of the documented response. Default: `schema`; `null` for a
   * namespace the documented response does not declare (it is still returned).
   */
  readonly responseSchema?: z.ZodType | null;
  /**
   * JSON Merge Patch for the namespace: `patch` is `undefined` (body does not
   * mention it: keep `current`), `null` (clear it) or the parsed branch.
   * Return `undefined` for "absent": an emptied namespace is never stored as `{}`.
   */
  merge(current: V | undefined, patch: P | null | undefined): V | undefined;
  /**
   * Throw an HTTP 400 (`BadRequestException`) when the MERGED value exceeds a
   * cap zod cannot express (a key count on a `z.record`). Runs after the merge,
   * before validation, on PUT and PATCH alike.
   */
  assertLimits?(value: V | undefined): void;
}

/**
 * Key → stored value type of every registered user namespace. Platform
 * declaration files add their keys by module augmentation; an app adds its own
 * the same way. Every key is OPTIONAL in `UserSettingsValue`.
 */
export interface UserSettingsNamespaces {}

/**
 * Key → `typeof` the declaration, for the precise static types of the composed
 * schemas. Optional for an app (see `SystemSettingsNamespaceDeclarations`).
 */
export interface UserSettingsNamespaceDeclarations {}

/** The optional namespaces of a user's settings document. */
export type UserSettingsNamespacesValue = {
  [K in keyof UserSettingsNamespaces]?: UserSettingsNamespaces[K];
};

/** Top-level keys the stored value or the response reserve for core fields. */
export const RESERVED_USER_SETTINGS_KEYS = ['theme', 'profile', 'updatedAt', 'version'] as const;

function validateUserNamespace(ns: UserSettingsNamespace): void {
  if (typeof ns.description !== 'string' || ns.description.trim() === '') {
    throw new Error('description is required');
  }
  for (const field of ['schema', 'patchSchema'] as const) {
    if (!isZodSchema(ns[field])) throw new Error(`${field} must be a zod schema`);
  }
  for (const field of ['putSchema', 'wirePatchSchema'] as const) {
    if (ns[field] !== undefined && !isZodSchema(ns[field])) throw new Error(`${field} must be a zod schema when set`);
  }
  if (ns.responseSchema !== undefined && ns.responseSchema !== null && !isZodSchema(ns.responseSchema)) {
    throw new Error('responseSchema must be a zod schema, null, or left out');
  }
  if (typeof ns.merge !== 'function') throw new Error('merge is required');
  if (ns.assertLimits !== undefined && typeof ns.assertLimits !== 'function') {
    throw new Error('assertLimits must be a function');
  }
  if ((RESERVED_USER_SETTINGS_KEYS as readonly string[]).includes(ns.key)) {
    throw new Error(`"${ns.key}" is a core field of user settings, not a namespace`);
  }

  for (const field of ['schema', 'patchSchema', 'putSchema', 'wirePatchSchema', 'responseSchema'] as const) {
    const defaults = findDefaultPaths(ns[field]);
    if (defaults.length > 0) {
      throw new Error(
        `${field} carries .default() at ${defaults.join(', ')}; a user namespace must stay absent until the user chooses (see user-settings-namespaces.schema.ts)`,
      );
    }
    const secrets = findSecretFieldPaths(ns[field], SETTINGS_SECRET_FIELD_NAMES);
    if (secrets.length > 0) {
      throw new Error(
        `${field} declares secret-named field(s) ${secrets.join(', ')}; a user's secrets go in their own encrypted table (see UserAiKey), never in user settings`,
      );
    }
  }
}

/**
 * The optional user settings namespaces, in registration order: the order of
 * every composed user-settings schema and of the OpenAPI document. Filled at
 * import time by `user-settings.manifest.ts`.
 */
export const userSettingsNamespaceRegistry = defineRegistry<UserSettingsNamespace>({
  name: 'user-settings-namespaces',
  idOf: (ns) => ns.key,
  idPattern: SETTINGS_NAMESPACE_KEY_PATTERN,
  validate: (ns) => validateUserNamespace(ns),
  describeDuplicate: (_existing, incoming) =>
    `User settings namespace "${incoming.key}" is already registered. Extend it with extendUserSettingsNamespace instead of registering it twice.`,
});

/** Register namespaces, all or nothing (see the registry primitive's rules). */
export function registerUserSettingsNamespaces(namespaces: readonly UserSettingsNamespace[]): void {
  userSettingsNamespaceRegistry.registerAll(namespaces);
}
