// =============================================================================
// System settings namespace registry (issue #677, PP-1.5)
// =============================================================================
//
// Every top-level key of `system_settings.value` (the 'global' row) is a
// NAMESPACE, declared once, beside the module that owns it, as one
// `SystemSettingsNamespace`. The declaration bundles everything the six places
// of `common/schemas/settings-parity.spec.ts` used to restate by hand: the
// stored shape, the canonical partial, the PUT and PATCH request-body branches,
// the response branch, the defaults and the PATCH merge. The composed schemas,
// `DEFAULT_SYSTEM_SETTINGS`, the service's merge and its salvage are DERIVED
// from this registry (`compose.ts`, `composed.ts`).
//
// Framework-free: zod and the registry primitive only. Moved from the
// reference app into `@marinoscar/platform-api/settings` by #733, which added
// the optional org layer (`org`) and `forbiddenKeys`. Recipe: the slice
// README (../README.md).
// =============================================================================

import { z } from 'zod';

import { defineRegistry } from '../../core/index';
import { SETTINGS_SECRET_FIELD_NAMES, secretFieldMessage } from './secret-fields';
import { findDefaultPaths, findSecretFieldPaths, isZodSchema } from './schema-walk';

/**
 * Helpers `SystemSettingsService` lends to a namespace's {@link SystemSettingsNamespace.read}.
 * They stay in the service; a namespace receives them rather than importing it.
 *
 * @stability experimental
 */
export interface SettingsReadHelpers {
  /** `value` when it is a plain object (not `null`, an array or a primitive), else `undefined`. */
  asPlainObject(value: unknown): Record<string, unknown> | undefined;
  /**
   * `stored` projected onto `schema` field by field: every field that fails its
   * own schema falls back to a clone of `defaults[field]`.
   */
  readNamespace<T extends Record<string, unknown>>(
    stored: unknown,
    schema: z.ZodObject<z.ZodRawShape>,
    defaults: T,
  ): T;
  /**
   * A stored string list salvaged entry by entry: anything that is not an
   * array reads as `[]`, every entry that is not a string or fails `element`
   * is dropped, and the result is cut to `max` entries. A fresh array every
   * call. (The `notifications` namespace's `disabledEvents` is the first user.)
   */
  readStringArray(stored: unknown, element: z.ZodType, max: number): string[];
}

/**
 * One namespace of the system settings document.
 *
 * @typeParam K - the top-level key, e.g. `'jobs'`.
 * @typeParam V - the stored value type (what `SystemSettingsValue[K]` is).
 * @typeParam P - the parsed PATCH body branch `merge` receives.
 *
 * @stability experimental
 */
export interface SystemSettingsNamespace<K extends string = string, V = unknown, P = unknown> {
  /** Top-level key in `system_settings.value`. Matches `/^[a-z][A-Za-z0-9]*$/`. */
  readonly key: K;
  /** One sentence on what the namespace configures (docs and error messages). */
  readonly description: string;
  /**
   * The value as STORED (place 1, `systemSettingsSchema`). Always complete:
   * `readKnownSettings` fills it from `defaults`. Never `.default()`.
   */
  readonly storedSchema: z.ZodType<V>;
  /** The canonical partial (place 2, `systemSettingsPatchSchema`); composed with `.optional()`. */
  readonly patchSchema: z.ZodType;
  /** The PUT request-body branch (place 3, `updateSystemSettingsSchema`). */
  readonly putSchema: z.ZodType;
  /** The PATCH request-body branch (place 4, `patchSystemSettingsSchema`); composed with `.optional()`. */
  readonly wirePatchSchema: z.ZodType;
  /**
   * The branch of `systemSettingsResponseSchema` (the OpenAPI response
   * contract), or `null` for a namespace the documented response does not
   * declare. `null` is a decision, never an omission: the field must be present.
   */
  readonly responseSchema: z.ZodType | null;
  /** The defaults (place 5), the only place they live. Must satisfy `storedSchema`. */
  readonly defaults: V;
  /**
   * Whether a PUT body must carry the namespace. `false` means a PUT that omits
   * it keeps the stored value (`replaceSettings` carries it forward).
   */
  readonly requiredOnPut: boolean;
  /**
   * Salvage a stored value (the raw `system_settings.value[key]`, anything at
   * all) into one that satisfies `storedSchema`. Default:
   * `helpers.readNamespace(stored, storedSchema, defaults)`, which needs an
   * object `storedSchema`.
   */
  read?(stored: unknown, helpers: SettingsReadHelpers): V;
  /**
   * PATCH merge (place 6): `current` is the salvaged stored value, `patch` the
   * parsed PATCH branch (`undefined` when the body does not mention the
   * namespace). Returns the new value, never a reference into `current` that
   * the caller could mutate.
   */
  merge(current: V, patch: P | undefined): V;
  /**
   * The org layer (issue #733): the fields an organization may set for itself
   * and how they combine with the system value. Absent means the namespace is
   * deployment-wide only and cannot be overridden per organization (a `PATCH
   * /api/org-settings` naming it is a 400).
   */
  readonly org?: SettingsNamespaceOrgLayer<V>;
  /**
   * Field names this namespace refuses on top of the global deny-list
   * (`SETTINGS_SECRET_FIELD_NAMES`), checked the same way: any depth, any case.
   */
  readonly forbiddenKeys?: readonly string[];
}

/**
 * The org layer of a system namespace: which fields an organization may set,
 * how an org value combines with the system value, and the ORG-scope
 * permissions that gate reading and writing it inside `/api/org-settings`.
 *
 * @typeParam V - the namespace's stored value type.
 *
 * @stability experimental
 */
export interface SettingsNamespaceOrgLayer<V> {
  /**
   * The fields an organization may set: a `z.object` whose every field is
   * optional (an org stores only what it overrides). Never `.default()`.
   */
  readonly schema: z.ZodObject<z.ZodRawShape>;
  /**
   * `'override'`: every field the org stores replaces the system value.
   * A function: a custom merge that may only RESTRICT (an org can turn a
   * capability off, never on); it receives the salvaged system value and the
   * org's stored fields and returns the effective value, which must satisfy
   * the namespace's `storedSchema`.
   */
  readonly merge: 'override' | ((system: V, org: Partial<V>) => V);
  /** The org-scope permission that lets a caller read the namespace's org fields. */
  readonly readPermission: string;
  /** The org-scope permission that lets a caller change them. */
  readonly writePermission: string;
}

/**
 * Key → stored value type of every registered system namespace. Each platform
 * declaration file adds its key by module augmentation; an app adds its own
 * the same way (see `app-registrations/settings.ts`).
 *
 * @example
 * ```ts
 * declare module '@marinoscar/platform-api/settings' {
 *   interface SystemSettingsNamespaces { coach: CoachSettings }
 * }
 * ```
 *
 * @stability experimental
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- an augmentation target
export interface SystemSettingsNamespaces {}

/**
 * Key → `typeof` the declaration, for the precise static types of the composed
 * schemas (`updateSystemSettingsSchema.parse(...)` returning typed branches).
 * Optional for an app: a namespace augmented only in
 * {@link SystemSettingsNamespaces} is still validated, stored and returned;
 * its request-body branch is just not statically typed.
 *
 * @stability experimental
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- an augmentation target
export interface SystemSettingsNamespaceDeclarations {}

/**
 * The stored system settings document, one property per registered namespace.
 *
 * @stability experimental
 */
export type SystemSettingsValue = {
  [K in keyof SystemSettingsNamespaces]: SystemSettingsNamespaces[K];
};

/**
 * The stored value type of namespace `K`: `SystemSettingsNamespaces[K]` once
 * an app (or a slice) augmented it, `unknown` until then. The type the
 * deprecated per-namespace getters (`getJobsPolicy`, ...) return.
 *
 * @typeParam K - the namespace key.
 *
 * @stability experimental
 */
export type SystemSettingsNamespaceValue<K extends string> = K extends keyof SystemSettingsNamespaces
  ? SystemSettingsNamespaces[K]
  : unknown;

/**
 * Top-level keys the response or the row reserve for core fields.
 *
 * @stability stable
 */
export const RESERVED_SYSTEM_SETTINGS_KEYS = ['security', 'updatedAt', 'updatedBy', 'version'] as const;

/**
 * The pattern every namespace key must match: a lower-case letter, then letters and digits.
 *
 * @stability stable
 */
export const SETTINGS_NAMESPACE_KEY_PATTERN = /^[a-z][A-Za-z0-9]*$/;

function validateSystemNamespace(ns: SystemSettingsNamespace): void {
  if (typeof ns.description !== 'string' || ns.description.trim() === '') {
    throw new Error('description is required');
  }
  for (const field of ['storedSchema', 'patchSchema', 'putSchema', 'wirePatchSchema'] as const) {
    if (!isZodSchema(ns[field])) throw new Error(`${field} must be a zod schema`);
  }
  if (ns.responseSchema !== null && !isZodSchema(ns.responseSchema)) {
    throw new Error('responseSchema must be a zod schema, or null for a namespace the response does not document');
  }
  if (ns.defaults === undefined) throw new Error('defaults is required');
  if (typeof ns.requiredOnPut !== 'boolean') throw new Error('requiredOnPut must be a boolean');
  if (typeof ns.merge !== 'function') throw new Error('merge is required');
  if (ns.read !== undefined && typeof ns.read !== 'function') throw new Error('read must be a function');
  if (ns.read === undefined && !(ns.storedSchema instanceof z.ZodObject)) {
    throw new Error('storedSchema must be a z.object unless the namespace declares its own read');
  }
  if ((RESERVED_SYSTEM_SETTINGS_KEYS as readonly string[]).includes(ns.key)) {
    throw new Error(`"${ns.key}" is a core field of the system settings response, not a namespace`);
  }

  // The generic form of STORAGE/AI/TELEMETRY_SETTINGS_CARRIES_NO_SECRET: this
  // document is returned wholesale by GET /api/system-settings and copied into
  // every settings audit row. Secrets belong in the credential store.
  if (ns.forbiddenKeys !== undefined && (!Array.isArray(ns.forbiddenKeys) || ns.forbiddenKeys.some((k) => typeof k !== 'string'))) {
    throw new Error('forbiddenKeys must be an array of field names');
  }
  const denied = [...SETTINGS_SECRET_FIELD_NAMES, ...(ns.forbiddenKeys ?? [])];
  for (const field of ['storedSchema', 'putSchema', 'wirePatchSchema', 'responseSchema'] as const) {
    const secrets = findSecretFieldPaths(ns[field], denied);
    if (secrets.length > 0) throw new Error(secretFieldMessage(field, secrets, 'system'));
  }
  if (ns.org !== undefined) validateOrgLayer(ns, denied);

  const parsed = ns.storedSchema.safeParse(ns.defaults);
  if (!parsed.success) {
    throw new Error(`defaults do not satisfy storedSchema: ${parsed.error.message}`);
  }
}

function validateOrgLayer(ns: SystemSettingsNamespace, denied: readonly string[]): void {
  const org = ns.org!;
  if (!(org.schema instanceof z.ZodObject)) throw new Error('org.schema must be a z.object');
  for (const [name, field] of Object.entries(org.schema.shape as Record<string, z.ZodType>)) {
    if (!field.safeParse(undefined).success) {
      throw new Error(`org.schema field "${name}" must be optional: an organization stores only what it overrides`);
    }
  }
  if (findDefaultPaths(org.schema).length > 0) {
    throw new Error('org.schema carries .default(); an org override must stay absent until an organization sets it');
  }
  if (org.merge !== 'override' && typeof org.merge !== 'function') {
    throw new Error("org.merge must be 'override' or a function");
  }
  for (const field of ['readPermission', 'writePermission'] as const) {
    if (typeof org[field] !== 'string' || !/^[a-z][a-z0-9_]*:[a-z][a-z0-9_]*$/.test(org[field])) {
      throw new Error(`org.${field} must be a permission id such as "org_settings:read"`);
    }
  }
  const secrets = findSecretFieldPaths(org.schema, denied);
  if (secrets.length > 0) throw new Error(secretFieldMessage('org.schema', secrets, 'org'));
  if (ns.storedSchema instanceof z.ZodObject) {
    const stored = Object.keys((ns.storedSchema as z.ZodObject<z.ZodRawShape>).shape);
    const unknown = Object.keys(org.schema.shape).filter((name) => !stored.includes(name));
    if (unknown.length > 0) {
      throw new Error(`org.schema declares field(s) ${unknown.join(', ')} the namespace does not store`);
    }
  }
}

/**
 * The system settings namespaces, in registration order: the order of the
 * stored JSON's keys, of every composed schema and of the OpenAPI document.
 * Filled by the app at import time (the reference app's
 * `settings/registry/system-settings.manifest.ts`), before
 * `SettingsModule.forRoot()` composes the request bodies from it.
 *
 * @extensionPoint registry
 * @stability experimental
 */
export const systemSettingsNamespaceRegistry = defineRegistry<SystemSettingsNamespace>({
  name: 'system-settings-namespaces',
  idOf: (ns) => ns.key,
  idPattern: SETTINGS_NAMESPACE_KEY_PATTERN,
  validate: (ns) => validateSystemNamespace(ns),
  describeDuplicate: (_existing, incoming) =>
    `System settings namespace "${incoming.key}" is already registered. Extend it with extendSystemSettingsNamespace instead of registering it twice.`,
});

/**
 * Registers system namespaces, all or nothing (see the registry primitive's
 * rules). Registration order is the stored JSON's key order and the OpenAPI
 * document's: append, never insert.
 *
 * @param namespaces - the declarations, in order.
 * @throws RegistryError naming the entry when one is invalid: a duplicate or
 *   malformed key, a missing part, defaults that fail `storedSchema`, a
 *   secret-named field (pointing to `CredentialsService`), or a bad `org` block.
 *
 * @example
 * ```ts
 * registerSystemSettingsNamespaces([COACH_SYSTEM_SETTINGS]);
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function registerSystemSettingsNamespaces(namespaces: readonly SystemSettingsNamespace[]): void {
  systemSettingsNamespaceRegistry.registerAll(namespaces);
}
