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
// PP-14.21 adds two things on top of that:
//
//   - a DOT PATH (`path: 'query'`) puts the fields INSIDE a nested object of the
//     namespace instead of beside its top-level keys. An existing leaf key is
//     refused; the parent is not.
//   - an ORG LAYER for the added fields (`org`): the namespace gains an org
//     layer, or its existing org layer gains the fields. Only the ADDED fields
//     can become org-overridable, so an extension can never open a system-only
//     setting to organizations.
//
// Framework-free, zod only.
// =============================================================================

import { ORG_SETTINGS_READ_PERMISSION, ORG_SETTINGS_WRITE_PERMISSION } from '@marinoscar/platform-contract/settings';
import type { OrgSettingsMergeMode } from '@marinoscar/platform-contract/settings';
import { z } from 'zod';
import {
  extendSchemaAtPath,
  getAtPath,
  omitAtPath,
  parseSettingsPath,
  setAtPath,
  type SettingsObjectSchema,
} from './nested';
import type { SettingsNamespaceOrgLayer, SettingsReadHelpers, SystemSettingsNamespace } from './system-settings-namespace';
import type { UserSettingsNamespace } from './user-settings-namespace';

/**
 * Any zod object schema.
 *
 * @stability experimental
 */
export type AnyObject = SettingsObjectSchema;

/**
 * Anything with a namespace key.
 *
 * @stability experimental
 */
export interface KeyedNamespace {
  /** The namespace key. */
  readonly key: string;
}

/**
 * The platform and app namespace lists, before and after folding.
 *
 * @typeParam N - the namespace type.
 *
 * @stability experimental
 */
export interface NamespaceLists<N> {
  /** The platform's namespaces, in order. */
  platform: readonly N[];
  /** The app's namespaces, in order. */
  app: readonly N[];
}

/**
 * Fields an app adds inside a registered SYSTEM settings namespace.
 *
 * @stability experimental
 */
export interface SystemSettingsNamespaceExtension {
  /** The namespace to extend (platform or app). */
  readonly key: string;
  /**
   * A dot path to an object field of the namespace (`query`, `a.b`): the added
   * fields go INSIDE that object. Absent: beside the namespace's top-level
   * fields. The segment names must exist and be objects; an existing LEAF key
   * is refused, the parent is not.
   */
  readonly path?: string;
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
  /**
   * Which of the ADDED fields an organization may set, and how. The namespace
   * gains an org layer (or its org layer gains these fields), validated like
   * any org layer when the namespace is registered. A base field can never be
   * made org-overridable from here.
   */
  readonly org?: SettingsExtensionOrgLayer;
}

/**
 * How one org-overridable field tightens the system value: `'and'` (a boolean
 * the organization can only switch off), `'or'` (a boolean it can only switch
 * on, for a flag where `true` is the stricter side), `'min'` (a number it can
 * only lower), `'max'` (a number it can only raise, a floor), or a function
 * `(system, org) => value` that must itself only restrict.
 *
 * @stability experimental
 */
export type SettingsOrgTightener = 'and' | 'or' | 'min' | 'max' | ((system: unknown, org: unknown) => unknown);

/**
 * The org layer of a {@link SystemSettingsNamespaceExtension}.
 *
 * @stability experimental
 */
export interface SettingsExtensionOrgLayer {
  /**
   * The added fields an organization may set, by name. Default: every added
   * field. Each must be one of the extension's `storedSchema` fields.
   */
  readonly fields?: readonly string[];
  /**
   * `'override'`: the organization's value replaces the system value.
   * `'tighten'`: it may only restrict it, per field as `tighten` says.
   */
  readonly mode: OrgSettingsMergeMode;
  /** For `'tighten'`: how each org field restricts; one entry per org field, required. */
  readonly tighten?: Readonly<Record<string, SettingsOrgTightener>>;
  /**
   * The org-scope permission that reads the layer. Default
   * `org_settings:read`; when the namespace already has an org layer it must
   * equal that layer's.
   */
  readonly readPermission?: string;
  /** The org-scope permission that writes the layer. Default `org_settings:write`; same rule. */
  readonly writePermission?: string;
}

/**
 * Fields an app adds inside a registered USER settings namespace.
 *
 * @stability experimental
 */
export interface UserSettingsNamespaceExtension {
  /** The namespace to extend (platform or app). Its `schema` must be a `z.object`. */
  readonly key: string;
  /**
   * A dot path to an object field of the namespace: the added fields go INSIDE
   * that object (see {@link SystemSettingsNamespaceExtension.path}). A user
   * namespace has no org layer, so there is no `org` here.
   */
  readonly path?: string;
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

function extendObject(base: unknown, added: AnyObject, what: string, path: readonly string[]): AnyObject {
  return extendSchemaAtPath(base as z.ZodType, path, added, what);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** The defaults with `added` merged into the object at `path`. */
function defaultsAtPath(base: unknown, path: readonly string[], added: Record<string, unknown>): Record<string, unknown> {
  if (path.length === 0) return { ...(asRecord(base) ?? {}), ...added };
  const leaf = { ...(asRecord(getAtPath(base, path)) ?? {}), ...added };
  return setAtPath(structuredClone(base), path, leaf) as Record<string, unknown>;
}

/**
 * The tightened value of one org field: the organization's value may only
 * restrict the system's. A value of the wrong type for the tightener keeps the
 * system value (an organization never gets to widen by sending nonsense).
 */
function tightenValue(tightener: SettingsOrgTightener, system: unknown, org: unknown): unknown {
  if (typeof tightener === 'function') return tightener(system, org);
  const bothBooleans = typeof system === 'boolean' && typeof org === 'boolean';
  const bothNumbers = typeof system === 'number' && typeof org === 'number' && Number.isFinite(system) && Number.isFinite(org);
  switch (tightener) {
    case 'and':
      return bothBooleans ? system && org : system;
    case 'or':
      return bothBooleans ? system || org : system;
    case 'min':
      return bothNumbers ? Math.min(system, org) : system;
    case 'max':
      return bothNumbers ? Math.max(system, org) : system;
  }
}

/**
 * The org layer of `base` with the extension's org fields folded in.
 *
 * Only the ADDED fields can be org-overridable: the names must be fields the
 * extension adds, so a base (system-only) field can never be opened to
 * organizations here. An extension at a nested path stores its org fields
 * under the same path, and merges them into the system value at that path
 * only, so the base fields beside them stay system-only.
 */
function extendOrgLayer(
  base: SystemSettingsNamespace,
  extension: SystemSettingsNamespaceExtension,
  extensionOrg: SettingsExtensionOrgLayer,
  path: readonly string[],
  where: string,
): SettingsNamespaceOrgLayer<unknown> {
  const added = Object.keys(extension.storedSchema.shape);
  const names = [...(extensionOrg.fields ?? added)];
  if (names.length === 0) throw new Error(`${where}: org.fields is empty; name at least one added field or leave org out`);
  for (const name of names) {
    if (!added.includes(name)) {
      throw new Error(
        `${where}: org.fields names "${name}", which the extension does not add. ` +
          'An extension can only make the fields it adds overridable per organization, never a field the namespace already has.',
      );
    }
  }
  if (new Set(names).size !== names.length) throw new Error(`${where}: org.fields lists a field twice`);

  if (extensionOrg.mode !== 'override' && extensionOrg.mode !== 'tighten') {
    throw new Error(`${where}: org.mode must be 'override' or 'tighten'`);
  }
  const tighten = extensionOrg.tighten ?? {};
  if (extensionOrg.mode === 'tighten') {
    for (const name of names) {
      const tightener = tighten[name];
      if (tightener === undefined) {
        throw new Error(
          `${where}: org.mode 'tighten' needs org.tighten.${name} ('and', 'or', 'min', 'max' or a function): ` +
            'the platform cannot tell which direction is stricter for a field.',
        );
      }
      if (typeof tightener !== 'function' && !['and', 'or', 'min', 'max'].includes(tightener)) {
        throw new Error(`${where}: org.tighten.${name} must be 'and', 'or', 'min', 'max' or a function`);
      }
    }
    for (const name of Object.keys(tighten)) {
      if (!names.includes(name)) throw new Error(`${where}: org.tighten names "${name}", which is not an org field`);
    }
  }

  const baseOrg = base.org;
  const readPermission = extensionOrg.readPermission ?? baseOrg?.readPermission ?? ORG_SETTINGS_READ_PERMISSION;
  const writePermission = extensionOrg.writePermission ?? baseOrg?.writePermission ?? ORG_SETTINGS_WRITE_PERMISSION;
  if (baseOrg && (readPermission !== baseOrg.readPermission || writePermission !== baseOrg.writePermission)) {
    throw new Error(
      `${where}: the org layer is already gated by ${baseOrg.readPermission} / ${baseOrg.writePermission}; ` +
        'an extension cannot gate its fields differently (a namespace has one org permission pair)',
    );
  }

  // The org schema of the added fields: every field optional, nothing defaulted.
  const mask = Object.fromEntries(names.map((name) => [name, true as const]));
  const leaf = extension.storedSchema.pick(mask).partial();
  let addedShape: z.ZodRawShape;
  if (path.length === 0) {
    addedShape = leaf.shape;
  } else {
    // `.strict()` so an org that names a field beside the extension's (a system-only
    // one) gets a 400 instead of a silent drop.
    const nest = (rest: readonly string[]): z.ZodType =>
      rest.length === 0 ? leaf.strict() : z.object({ [rest[0] as string]: nest(rest.slice(1)).optional() }).strict();
    addedShape = { [path[0] as string]: nest(path.slice(1)).optional() };
  }
  const baseShape = baseOrg ? baseOrg.schema.shape : {};
  for (const key of Object.keys(addedShape)) {
    if (key in baseShape) {
      throw new Error(
        path.length === 0
          ? `${where}: the org layer already declares "${key}"`
          : `${where}: the org layer already owns "${key}"; put every org field under one path root in one extension`,
      );
    }
  }
  const schema = z.object({ ...baseShape, ...addedShape });

  // Plain top-level override on an override (or absent) layer needs no function.
  const baseIsOverride = baseOrg === undefined || baseOrg.merge === 'override';
  const modeOfBase = baseOrg === undefined ? extensionOrg.mode : (baseOrg.mode ?? (baseOrg.merge === 'override' ? 'override' : 'tighten'));
  const mode = modeOfBase === 'override' && extensionOrg.mode === 'override' ? 'override' : 'tighten';
  if (path.length === 0 && extensionOrg.mode === 'override' && baseIsOverride) {
    return { schema, merge: 'override', mode, readPermission, writePermission };
  }

  const baseNames = Object.keys(baseShape);
  const merge = (system: unknown, org: Partial<unknown>): unknown => {
    const orgRecord = asRecord(org) ?? {};
    let result: unknown = system;
    if (baseOrg) {
      const baseFields = Object.fromEntries(Object.entries(orgRecord).filter(([key]) => baseNames.includes(key)));
      result =
        baseOrg.merge === 'override'
          ? { ...(asRecord(system) ?? {}), ...structuredClone(baseFields) }
          : (baseOrg.merge as (s: unknown, o: unknown) => unknown)(structuredClone(system), structuredClone(baseFields));
    }
    // A base merge function may not know the fields the extension added (it
    // builds its result field by field), so carry every added field from the
    // system value first; the organization's own values apply on top.
    const systemLeaf = asRecord(getAtPath(system, path)) ?? {};
    const nextLeaf: Record<string, unknown> = { ...(asRecord(getAtPath(result, path)) ?? (path.length > 0 ? systemLeaf : {})) };
    for (const field of added) {
      if (systemLeaf[field] !== undefined) nextLeaf[field] = structuredClone(systemLeaf[field]);
    }
    const orgLeaf = asRecord(getAtPath(orgRecord, path)) ?? {};
    for (const name of names) {
      const value = orgLeaf[name];
      if (value === undefined) continue;
      nextLeaf[name] =
        extensionOrg.mode === 'override'
          ? structuredClone(value)
          : tightenValue(tighten[name] as SettingsOrgTightener, systemLeaf[name], value);
    }
    return setAtPath(result, path, nextLeaf);
  };
  return { schema, merge: merge as SettingsNamespaceOrgLayer<unknown>['merge'], mode, readPermission, writePermission };
}

/**
 * The base SYSTEM namespace with the extension's fields folded into every
 * schema, its defaults, its merge and (when the base has one) its `read`.
 * With `path` the fields go inside that nested object; with `org` they are
 * also overridable per organization.
 *
 * @param base - the registered declaration to extend.
 * @param extension - the added fields; see {@link SystemSettingsNamespaceExtension}.
 * @returns the extended declaration; `base` is not modified.
 * @throws Error when a base schema is not a `z.object`, the path names no
 *   object field, the object already declares an added LEAF key, or the org
 *   block is invalid (a field the extension does not add, a `tighten` field
 *   without a tightener, different permissions from the existing org layer).
 *
 * @example
 * ```ts
 * extendSystemSettingsNamespace(TELEMETRY_SYSTEM_SETTINGS, {
 *   key: 'telemetry',
 *   path: 'query',
 *   storedSchema: z.object({ slowQuerySeconds: z.number().int().min(1).max(120) }),
 *   defaults: { slowQuerySeconds: 10 },
 *   org: { mode: 'tighten', tighten: { slowQuerySeconds: 'min' } },
 * });
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function extendSystemSettingsNamespace(
  base: SystemSettingsNamespace,
  extension: SystemSettingsNamespaceExtension,
): SystemSettingsNamespace {
  const where = `system settings namespace "${base.key}"`;
  const path = parseSettingsPath(extension.path, `${where} extension`);
  const added = Object.keys(extension.storedSchema.shape);
  const patchAdded = extension.patchSchema ?? extension.storedSchema.partial();
  const storedSchema = extendObject(base.storedSchema, extension.storedSchema, `${where} storedSchema`, path);
  const baseRead = base.read;
  const extensionDefaults = extension.defaults;
  const org = extension.org ? extendOrgLayer(base, extension, extension.org, path, `${where} extension`) : undefined;

  const merge = (current: unknown, patch: unknown): unknown => {
    const baseMerge = (c: unknown, p: unknown) => base.merge(c, p);
    if (extension.merge) {
      return extension.merge(asRecord(current) ?? {}, asRecord(patch), baseMerge);
    }
    let merged: unknown = asRecord(base.merge(current, patch)) ?? {};
    const currentLeaf = asRecord(getAtPath(current, path)) ?? {};
    const patchLeaf = asRecord(getAtPath(patch, path));
    const leaf: Record<string, unknown> = { ...(path.length === 0 ? {} : (asRecord(getAtPath(merged, path)) ?? {})) };
    for (const field of added) {
      leaf[field] = patchLeaf?.[field] !== undefined ? patchLeaf[field] : currentLeaf[field];
    }
    merged = path.length === 0 ? { ...(merged as Record<string, unknown>), ...leaf } : setAtPath(merged, path, leaf);
    return merged;
  };

  // Top-level fields are salvaged by the service's default field-by-field read,
  // unless the base brings its own. A NESTED field cannot be: the default read
  // validates the whole parent object, so a stored object without the new
  // field would fall back to ALL of the parent's defaults and lose what an
  // administrator saved. The nested read salvages the base fields with the
  // added ones taken out, then each added field against its own schema.
  let read: SystemSettingsNamespace['read'];
  if (path.length === 0) {
    read = baseRead
      ? (stored: unknown, helpers: SettingsReadHelpers) => ({
          ...(asRecord(baseRead(stored, helpers)) ?? {}),
          ...helpers.readNamespace(stored, extension.storedSchema, extensionDefaults),
        })
      : undefined;
  } else {
    read = (stored: unknown, helpers: SettingsReadHelpers) => {
      const without = omitAtPath(stored, path, added);
      const baseValue = baseRead
        ? baseRead(without, helpers)
        : helpers.readNamespace(without, base.storedSchema as AnyObject, (asRecord(base.defaults) ?? {}) as Record<string, unknown>);
      const salvaged = helpers.readNamespace(getAtPath(stored, path), extension.storedSchema, extensionDefaults);
      return setAtPath(baseValue, path, { ...(asRecord(getAtPath(baseValue, path)) ?? {}), ...salvaged });
    };
  }

  return {
    ...base,
    storedSchema,
    patchSchema: extendObject(base.patchSchema, patchAdded, `${where} patchSchema`, path),
    putSchema: extendObject(base.putSchema, extension.putSchema ?? extension.storedSchema, `${where} putSchema`, path),
    wirePatchSchema: extendObject(
      base.wirePatchSchema,
      extension.wirePatchSchema ?? patchAdded,
      `${where} wirePatchSchema`,
      path,
    ),
    responseSchema:
      base.responseSchema === null
        ? null
        : extendObject(base.responseSchema, extension.responseSchema ?? extension.storedSchema, `${where} responseSchema`, path),
    defaults: defaultsAtPath(base.defaults, path, extensionDefaults),
    read,
    merge,
    ...(org ? { org } : {}),
  };
}

/**
 * The base USER namespace with the extension's fields folded into every
 * schema, its merge and its cap check. With `path` the fields go inside that
 * nested object.
 *
 * @param base - the registered declaration to extend.
 * @param extension - the added fields; see {@link UserSettingsNamespaceExtension}.
 * @returns the extended declaration; `base` is not modified.
 * @throws Error when a base schema is not a `z.object`, the path names no
 *   object field, or the object already declares an added LEAF key.
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function extendUserSettingsNamespace(
  base: UserSettingsNamespace,
  extension: UserSettingsNamespaceExtension,
): UserSettingsNamespace {
  const where = `user settings namespace "${base.key}"`;
  const path = parseSettingsPath(extension.path, `${where} extension`);
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

    let merged: unknown = asRecord(base.merge(current, patch)) ?? {};
    const currentLeaf = asRecord(getAtPath(current, path)) ?? {};
    const patchLeaf = asRecord(getAtPath(patch, path)) ?? {};
    const leaf: Record<string, unknown> = { ...(path.length === 0 ? {} : (asRecord(getAtPath(merged, path)) ?? {})) };
    for (const field of added) {
      const value = patchLeaf[field] !== undefined ? patchLeaf[field] : currentLeaf[field];
      if (value === null || value === undefined) delete leaf[field];
      else leaf[field] = value;
    }
    if (path.length === 0) {
      merged = { ...(merged as Record<string, unknown>) };
      for (const field of added) delete (merged as Record<string, unknown>)[field];
      Object.assign(merged as Record<string, unknown>, leaf);
    } else if (Object.keys(leaf).length > 0 || getAtPath(merged, path) !== undefined) {
      merged = setAtPath(merged, path, leaf);
    }
    return Object.keys(merged as Record<string, unknown>).length > 0 ? merged : undefined;
  };

  const baseLimits = base.assertLimits;
  const extensionLimits = extension.assertLimits;

  return {
    ...base,
    schema: extendObject(base.schema, extension.schema, `${where} schema`, path),
    patchSchema: extendObject(base.patchSchema, patchAdded, `${where} patchSchema`, path),
    putSchema: extendObject(base.putSchema ?? base.schema, extension.putSchema ?? extension.schema, `${where} putSchema`, path),
    wirePatchSchema: extendObject(
      base.wirePatchSchema ?? base.patchSchema,
      extension.wirePatchSchema ?? patchAdded,
      `${where} wirePatchSchema`,
      path,
    ),
    responseSchema:
      base.responseSchema === null
        ? null
        : extendObject(base.responseSchema ?? base.schema, extension.responseSchema ?? extension.schema, `${where} responseSchema`, path),
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
 *
 * @stability experimental
 */
export function foldSettingsExtensions<N extends KeyedNamespace, E extends KeyedNamespace>(
  lists: NamespaceLists<N>,
  extensions: readonly E[],
  extend: (base: N, extension: E) => N,
  registryName: string,
): NamespaceLists<N> {
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
