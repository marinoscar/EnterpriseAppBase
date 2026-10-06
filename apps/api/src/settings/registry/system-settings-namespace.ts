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
// Framework-free: zod and the registry primitive only. Recipe: README.md next
// to this file.
// =============================================================================

import { z } from 'zod';
import { defineRegistry } from '@marinoscar/platform-api/core';
import { SETTINGS_SECRET_FIELD_NAMES } from '../../common/schemas/settings.schema';
import { findSecretFieldPaths, isZodSchema } from './schema-walk';

/**
 * Helpers `SystemSettingsService` lends to a namespace's {@link SystemSettingsNamespace.read}.
 * They stay in the service; a namespace receives them rather than importing it.
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
  /** A stored `notifications.disabledEvents`, with every unusable entry dropped. */
  readDisabledEvents(stored: unknown): string[];
}

/**
 * One namespace of the system settings document.
 *
 * @typeParam K - the top-level key, e.g. `'jobs'`.
 * @typeParam V - the stored value type (what `SystemSettingsValue[K]` is).
 * @typeParam P - the parsed PATCH body branch `merge` receives.
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
}

/**
 * Key → stored value type of every registered system namespace. Each platform
 * declaration file adds its key by module augmentation; an app adds its own
 * the same way (see `app-registrations/settings.ts`).
 *
 * @example
 * declare module '../settings/registry/system-settings-namespace' {
 *   interface SystemSettingsNamespaces { coach: CoachSettings }
 * }
 */
export interface SystemSettingsNamespaces {}

/**
 * Key → `typeof` the declaration, for the precise static types of the composed
 * schemas (`updateSystemSettingsSchema.parse(...)` returning typed branches).
 * Optional for an app: a namespace augmented only in
 * {@link SystemSettingsNamespaces} is still validated, stored and returned;
 * its request-body branch is just not statically typed.
 */
export interface SystemSettingsNamespaceDeclarations {}

/** The stored system settings document, one property per registered namespace. */
export type SystemSettingsValue = {
  [K in keyof SystemSettingsNamespaces]: SystemSettingsNamespaces[K];
};

/** Top-level keys the response or the row reserve for core fields. */
export const RESERVED_SYSTEM_SETTINGS_KEYS = ['security', 'updatedAt', 'updatedBy', 'version'] as const;

/** The pattern every namespace key must match: a lower-case letter, then letters and digits. */
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
  for (const field of ['storedSchema', 'putSchema', 'wirePatchSchema', 'responseSchema'] as const) {
    const secrets = findSecretFieldPaths(ns[field], SETTINGS_SECRET_FIELD_NAMES);
    if (secrets.length > 0) {
      throw new Error(
        `${field} declares secret-named field(s) ${secrets.join(', ')}; secrets go in the encrypted credential store (CredentialsService), never in system settings`,
      );
    }
  }

  const parsed = ns.storedSchema.safeParse(ns.defaults);
  if (!parsed.success) {
    throw new Error(`defaults do not satisfy storedSchema: ${parsed.error.message}`);
  }
}

/**
 * The system settings namespaces, in registration order: the order of the
 * stored JSON's keys, of every composed schema and of the OpenAPI document.
 * Filled at import time by `system-settings.manifest.ts`.
 */
export const systemSettingsNamespaceRegistry = defineRegistry<SystemSettingsNamespace>({
  name: 'system-settings-namespaces',
  idOf: (ns) => ns.key,
  idPattern: SETTINGS_NAMESPACE_KEY_PATTERN,
  validate: (ns) => validateSystemNamespace(ns),
  describeDuplicate: (_existing, incoming) =>
    `System settings namespace "${incoming.key}" is already registered. Extend it with extendSystemSettingsNamespace instead of registering it twice.`,
});

/** Register namespaces, all or nothing (see the registry primitive's rules). */
export function registerSystemSettingsNamespaces(namespaces: readonly SystemSettingsNamespace[]): void {
  systemSettingsNamespaceRegistry.registerAll(namespaces);
}
