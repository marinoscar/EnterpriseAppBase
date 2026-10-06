// =============================================================================
// Extending a registered settings namespace (issue #677)
// =============================================================================
//
// An app sometimes needs fields INSIDE a platform namespace rather than a
// namespace of its own: EvoPath's user `ai` namespace adds `{ training }` beside
// the base's `ai.defaultModel`. Replacing the platform declaration would fork
// it; registering the key twice is refused (`DUPLICATE_ID`). Instead the app
// lists an EXTENSION in `app-registrations/settings.ts`, and the manifest folds
// it into the base declaration before registering it:
//
//   - every schema of the namespace gains the extension's fields (`.extend`),
//     so a base field and an app field coexist and both validate;
//   - the merge runs the base merge for the base fields and merges the app's
//     fields on top (or the extension's own `merge`);
//   - for a system namespace, the defaults gain the extension's defaults and a
//     custom `read` salvages the app's fields field by field.
//
// Framework-free, zod only.
// =============================================================================

import { z } from 'zod';
import type { SettingsReadHelpers, SystemSettingsNamespace } from './system-settings-namespace';
import type { UserSettingsNamespace } from './user-settings-namespace';

type AnyObject = z.ZodObject<z.ZodRawShape>;

/** Fields an app adds inside a registered SYSTEM settings namespace. */
export interface SystemSettingsNamespaceExtension {
  /** The namespace to extend (platform or app). */
  readonly key: string;
  /** The added stored fields. Required, never `.default()`. */
  readonly storedSchema: AnyObject;
  /** The added canonical-partial fields. Default: `storedSchema.partial()`. */
  readonly patchSchema?: AnyObject;
  /** The added PUT fields. Default: `storedSchema`. */
  readonly putSchema?: AnyObject;
  /** The added PATCH fields. Default: `patchSchema`. */
  readonly wirePatchSchema?: AnyObject;
  /** The added response fields. Default: `storedSchema`. Ignored when the base response is `null`. */
  readonly responseSchema?: AnyObject;
  /** Defaults for the added fields; must satisfy `storedSchema`. */
  readonly defaults: Record<string, unknown>;
  /**
   * Merge for the whole extended value. Default: the base merge, then each
   * added field replaced when the patch carries it (`undefined` keeps it).
   */
  merge?(current: Record<string, unknown>, patch: Record<string, unknown> | undefined, baseMerge: (current: unknown, patch: unknown) => unknown): unknown;
}

/** Fields an app adds inside a registered USER settings namespace. */
export interface UserSettingsNamespaceExtension {
  /** The namespace to extend (platform or app). Its `schema` must be a `z.object`. */
  readonly key: string;
  /** The added stored fields, never `.default()`. */
  readonly schema: AnyObject;
  /** The added PATCH fields. Default: each of `schema`'s fields `.nullable().optional()` (`null` deletes it). */
  readonly patchSchema?: AnyObject;
  /** The added PUT fields. Default: `schema`. */
  readonly putSchema?: AnyObject;
  /** The added PATCH body fields. Default: `patchSchema`. */
  readonly wirePatchSchema?: AnyObject;
  /** The added response fields. Default: `schema`. Ignored when the base response is `null`. */
  readonly responseSchema?: AnyObject;
  /**
   * Merge for the whole extended value. Default: `undefined` keeps, `null`
   * clears the namespace; otherwise the base merge for the base fields, then
   * each added field set (`null` deletes it, `undefined` keeps the stored one).
   */
  merge?(current: Record<string, unknown> | undefined, patch: Record<string, unknown> | null | undefined, baseMerge: (current: unknown, patch: unknown) => unknown): unknown;
  /** An extra cap check on the merged value, after the base's. */
  assertLimits?(value: Record<string, unknown> | undefined): void;
}

function requireObject(schema: unknown, what: string): AnyObject {
  if (!(schema instanceof z.ZodObject)) {
    throw new Error(`${what} must be a z.object to be extended`);
  }
  return schema as AnyObject;
}

function extendObject(base: unknown, added: AnyObject, what: string): AnyObject {
  const object = requireObject(base, what);
  for (const key of Object.keys(added.shape)) {
    if (key in object.shape) throw new Error(`${what} already declares "${key}"; an extension only adds fields`);
  }
  return object.extend(added.shape);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * The base SYSTEM namespace with the extension's fields folded into every
 * schema, its defaults, its merge and (when the base has one) its `read`.
 *
 * @throws Error when a base schema is not a `z.object` or already declares an added field.
 */
export function extendSystemSettingsNamespace(
  base: SystemSettingsNamespace,
  extension: SystemSettingsNamespaceExtension,
): SystemSettingsNamespace {
  const where = `system settings namespace "${base.key}"`;
  const added = Object.keys(extension.storedSchema.shape);
  const patchAdded = extension.patchSchema ?? extension.storedSchema.partial();
  const storedSchema = extendObject(base.storedSchema, extension.storedSchema, `${where} storedSchema`);
  const baseRead = base.read;
  const extensionDefaults = extension.defaults;

  const merge = (current: unknown, patch: unknown): unknown => {
    const baseMerge = (c: unknown, p: unknown) => base.merge(c, p);
    if (extension.merge) {
      return extension.merge(asRecord(current) ?? {}, asRecord(patch), baseMerge);
    }
    const merged = { ...(asRecord(base.merge(current, patch)) ?? {}) };
    const currentRecord = asRecord(current) ?? {};
    const patchRecord = asRecord(patch);
    for (const field of added) {
      merged[field] = patchRecord?.[field] !== undefined ? patchRecord[field] : currentRecord[field];
    }
    return merged;
  };

  return {
    ...base,
    storedSchema,
    patchSchema: extendObject(base.patchSchema, patchAdded, `${where} patchSchema`),
    putSchema: extendObject(base.putSchema, extension.putSchema ?? extension.storedSchema, `${where} putSchema`),
    wirePatchSchema: extendObject(
      base.wirePatchSchema,
      extension.wirePatchSchema ?? patchAdded,
      `${where} wirePatchSchema`,
    ),
    responseSchema:
      base.responseSchema === null
        ? null
        : extendObject(base.responseSchema, extension.responseSchema ?? extension.storedSchema, `${where} responseSchema`),
    defaults: { ...(asRecord(base.defaults) ?? {}), ...extensionDefaults },
    // A base with its own salvage keeps it for the base fields; the added
    // fields are salvaged field by field against their own schemas.
    read: baseRead
      ? (stored: unknown, helpers: SettingsReadHelpers) => ({
          ...(asRecord(baseRead(stored, helpers)) ?? {}),
          ...helpers.readNamespace(stored, extension.storedSchema, extensionDefaults),
        })
      : undefined,
    merge,
  };
}

/**
 * The base USER namespace with the extension's fields folded into every
 * schema, its merge and its cap check.
 *
 * @throws Error when a base schema is not a `z.object` or already declares an added field.
 */
export function extendUserSettingsNamespace(
  base: UserSettingsNamespace,
  extension: UserSettingsNamespaceExtension,
): UserSettingsNamespace {
  const where = `user settings namespace "${base.key}"`;
  const added = Object.keys(extension.schema.shape);
  const patchAdded =
    extension.patchSchema ??
    z.object(
      Object.fromEntries(
        Object.entries(extension.schema.shape).map(([key, field]) => [key, (field as z.ZodType).nullable().optional()]),
      ),
    );
  const baseMerge = (c: unknown, p: unknown) => base.merge(c, p);

  const merge = (current: unknown, patch: unknown): unknown => {
    if (extension.merge) {
      return extension.merge(asRecord(current), patch === null ? null : asRecord(patch), baseMerge);
    }
    if (patch === undefined) return current;
    if (patch === null) return undefined;

    const merged = { ...(asRecord(base.merge(current, patch)) ?? {}) };
    const currentRecord = asRecord(current) ?? {};
    const patchRecord = asRecord(patch) ?? {};
    for (const field of added) {
      const value = patchRecord[field] !== undefined ? patchRecord[field] : currentRecord[field];
      if (value === null || value === undefined) delete merged[field];
      else merged[field] = value;
    }
    return Object.keys(merged).length > 0 ? merged : undefined;
  };

  const baseLimits = base.assertLimits;
  const extensionLimits = extension.assertLimits;

  return {
    ...base,
    schema: extendObject(base.schema, extension.schema, `${where} schema`),
    patchSchema: extendObject(base.patchSchema, patchAdded, `${where} patchSchema`),
    putSchema: extendObject(base.putSchema ?? base.schema, extension.putSchema ?? extension.schema, `${where} putSchema`),
    wirePatchSchema: extendObject(
      base.wirePatchSchema ?? base.patchSchema,
      extension.wirePatchSchema ?? patchAdded,
      `${where} wirePatchSchema`,
    ),
    responseSchema:
      base.responseSchema === null
        ? null
        : extendObject(base.responseSchema ?? base.schema, extension.responseSchema ?? extension.schema, `${where} responseSchema`),
    merge,
    assertLimits:
      baseLimits || extensionLimits
        ? (value: unknown) => {
            baseLimits?.(value);
            extensionLimits?.(asRecord(value));
          }
        : undefined,
  };
}

/**
 * The platform and app namespace lists with every extension folded into the
 * namespace it names, in the order given. Used by the manifests before they
 * register anything, so the registry only ever holds the final declaration.
 *
 * @throws Error when an extension names a namespace in neither list.
 */
export function foldSettingsExtensions<N extends { readonly key: string }, E extends { readonly key: string }>(
  lists: { platform: readonly N[]; app: readonly N[] },
  extensions: readonly E[],
  extend: (base: N, extension: E) => N,
  registryName: string,
): { platform: N[]; app: N[] } {
  const keys = new Set([...lists.platform, ...lists.app].map((ns) => ns.key));
  for (const extension of extensions) {
    if (!keys.has(extension.key)) {
      throw new Error(
        `Cannot extend ${registryName} namespace "${extension.key}": no such namespace. Known: ${[...keys].join(', ')}.`,
      );
    }
  }
  const fold = (list: readonly N[]) =>
    list.map((ns) =>
      extensions.filter((extension) => extension.key === ns.key).reduce((acc, extension) => extend(acc, extension), ns),
    );
  return { platform: fold(lists.platform), app: fold(lists.app) };
}
