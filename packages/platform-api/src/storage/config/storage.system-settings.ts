// =============================================================================
// System settings namespace `storage` (issue #677; namespace #373, epic #372; drivers: PP-14.7)
// =============================================================================
//
// A declaration file: imports leaf modules and the storage driver registry.
// Registered by the app's system-settings manifest. Recipe:
// packages/platform-api/src/settings/README.md.
//
// THE STORED SHAPE is `{ provider, drivers }`: the id of the active storage
// driver and a record of every driver's own non-secret settings, each validated
// by the driver that owns it (`storageDriverKind`). The six flat fields the
// namespace stored before drivers were pluggable (`bucket`, `region`,
// `endpoint`, `accountId`, `accessKeyId`, `forcePathStyle`) are still ACCEPTED
// (a stored row, a PUT, a PATCH) and still PUBLISHED (the GET response), as the
// settings of the active built-in driver:
//
//   READ    an old row has no `drivers`; `read` folds its flat fields into
//           `drivers.<provider>` (field by field, so one damaged field keeps the
//           bucket next to it) and the response republishes the active
//           built-in's settings as the flat fields. Nothing is migrated.
//   WRITE   `merge` (PATCH) and the stored schema's transform (PUT) store the
//           new shape only: the flat fields are folded into `drivers` and
//           dropped, so the first write after an upgrade converts the row.
//
// A flat field and `drivers.<provider>` naming the same setting with different
// values is a 400: guessing which one the caller meant would silently ignore a
// change.
//
// NO SECRET HERE, AND THERE NEVER MAY BE ONE: a driver's secrets are declared
// by the driver and live in the encrypted credential store (the built-ins' at
// `(purpose 'storage', name 'default')`). Proved at compile time in
// `@marinoscar/platform-contract/storage` (`StorageSettingsCarriesNoSecret`),
// at registration (`registerStorageDriver` refuses a secret-named setting) and
// at import time by the settings registry.
// =============================================================================

import { Logger } from '@nestjs/common';
import {
  LEGACY_STORAGE_FLAT_FIELDS,
  STORAGE_DRIVER_ID_PATTERN,
  storageResponseSchema,
  storageSettingsPatchSchema,
  storageSettingsSchema,
  systemStoragePatchSchema,
  systemStorageSchema,
  type StorageSettingsPatchInput,
  type SystemStorageValue,
} from '@marinoscar/platform-contract/storage';
import { z } from 'zod';

import { PluggableSettingsError, PluggableUnknownError } from '../../core/index';
import type { SettingsReadHelpers, SystemSettingsNamespace } from '../../settings/index';
// Registers the three built-in drivers (side effect): the namespace below reads the registry.
import '../drivers/builtin-storage-drivers';
import { storageDriverKind } from '../drivers/storage-driver';
import {
  conflictingFields,
  conflictsBetween,
  driverRejection,
  isRecord,
  legacyFieldsFor,
  legacyFieldsOf,
  type DriverSettings,
  type DriversRecord,
  type LegacyField,
} from './storage-settings-compat';

const DEFAULT_PROVIDER = 's3';
const logger = new Logger('StorageSettings');

/**
 * Each distinct read warning is logged ONCE per process: the namespace is read
 * on every settings read and every five seconds by the policy cache, and a
 * stored entry for a driver that is no longer registered stays stored until the
 * next save.
 */
const warnedOnce = new Set<string>();
function warnOnce(message: string): void {
  if (warnedOnce.has(message)) return;
  warnedOnce.add(message);
  logger.warn(message);
}

/** The defaults of every registered driver, in registration order. */
function defaultDrivers(): DriversRecord {
  return Object.fromEntries(storageDriverKind.ids().map((id) => [id, structuredClone(storageDriverKind.parseSettings(id, {}))]));
}

/**
 * One stored driver entry, salvaged FIELD BY FIELD against the driver's own
 * `settingsSchema`: "not configured" is already an empty string, so a damaged
 * `region` that dragged the whole entry back to the defaults would also blank
 * the bucket an operator typed. A field that is absent or fails its schema
 * falls back to the driver's default for that field.
 */
function salvageDriverEntry(id: string, raw: unknown): DriverSettings {
  const impl = storageDriverKind.get(id);
  const source = isRecord(raw) ? raw : {};
  const defaults = impl.defaults as DriverSettings;
  const salvaged: DriverSettings = {};
  const damaged: string[] = [];

  for (const [key, field] of Object.entries(impl.settingsSchema.shape as Record<string, z.ZodType>)) {
    if (source[key] === undefined) {
      salvaged[key] = structuredClone(defaults[key]);
      continue;
    }
    const parsed = field.safeParse(source[key]);
    if (parsed.success) {
      salvaged[key] = parsed.data;
    } else {
      damaged.push(key);
      salvaged[key] = structuredClone(defaults[key]);
    }
  }

  if (damaged.length > 0) {
    warnOnce(`Stored storage settings for "${id}" have unusable field(s) ${damaged.join(', ')}; those fall back to their defaults.`);
  }

  try {
    return storageDriverKind.parseSettings(id, salvaged);
  } catch (error) {
    if (!(error instanceof PluggableSettingsError)) throw error;
    warnOnce(`Stored storage settings for "${id}" no longer parse (${error.message}); using its defaults.`);
    return structuredClone(storageDriverKind.parseSettings(id, {}));
  }
}

/**
 * `source` (the raw `storage` namespace, in either shape) as the new shape:
 * every REGISTERED driver present with its defaults filled, the legacy flat
 * fields folded into `drivers.<provider>` when that entry is absent, and a
 * stored entry for a driver that is no longer registered dropped with one
 * warning.
 */
function adaptStored(source: Record<string, unknown>): { provider: string; drivers: DriversRecord } {
  const provider =
    typeof source.provider === 'string' && STORAGE_DRIVER_ID_PATTERN.test(source.provider) ? source.provider : DEFAULT_PROVIDER;
  const stored = isRecord(source.drivers) ? source.drivers : {};

  const unknown = Object.keys(stored).filter((id) => !storageDriverKind.has(id));
  if (unknown.length > 0) {
    warnOnce(
      `Ignoring stored storage settings for ${unknown.map((id) => `"${id}"`).join(', ')}: ` +
        `no such driver is registered (registered: ${storageDriverKind.ids().join(', ') || '(none)'}).`,
    );
  }

  const legacy = legacyFieldsFor(provider, legacyFieldsOf(source));
  const drivers: DriversRecord = {};
  for (const id of storageDriverKind.ids()) {
    const entry = stored[id];
    // A legacy row has no entry for the active provider: its flat fields ARE
    // that entry. Never the other way round: a new-shape row keeps its entry.
    const raw = !isRecord(entry) && id === provider && Object.keys(legacy).length > 0 ? legacy : entry;
    drivers[id] = salvageDriverEntry(id, raw);
  }

  return { provider, drivers };
}

/**
 * The deprecated flat view of the active driver, for readers of `GET
 * /api/system-settings` written before drivers were pluggable: the six legacy
 * fields from `drivers.<provider>` when it declares them, empty otherwise.
 */
function legacyMirror(provider: string, drivers: DriversRecord): Required<Pick<SystemStorageValue, LegacyField>> {
  const active = drivers[provider] ?? {};
  const text = (field: 'bucket' | 'region' | 'endpoint' | 'accountId' | 'accessKeyId') =>
    typeof active[field] === 'string' ? (active[field] as string) : '';

  return {
    bucket: text('bucket'),
    region: text('region'),
    endpoint: text('endpoint'),
    accountId: text('accountId'),
    accessKeyId: text('accessKeyId'),
    forcePathStyle: typeof active.forcePathStyle === 'boolean' ? active.forcePathStyle : null,
  };
}

/**
 * The stored `storage` schema. A PUT body (and any value that reaches the
 * composed stored schema) is checked by the driver that owns each entry; the
 * legacy flat fields are folded into `drivers.<provider>` and dropped, so a
 * PUT converts the row exactly as a PATCH does.
 */
const storedStorageSchema = systemStorageSchema
  .extend({
    drivers: z.preprocess((value) => value ?? {}, systemStorageSchema.shape.drivers),
  })
  .superRefine((value, ctx) => {
    for (const [id, entry] of Object.entries(value.drivers)) {
      try {
        storageDriverKind.parseSettings(id, entry);
      } catch (error) {
        if (!(error instanceof PluggableUnknownError) && !(error instanceof PluggableSettingsError)) throw error;
        ctx.addIssue({ code: 'custom', message: error.message, path: ['drivers', id] });
      }
    }

    const legacy = legacyFieldsFor(value.provider, legacyFieldsOf(value));
    const conflicts = conflictsBetween(legacy, value.drivers[value.provider]);
    if (conflicts.length > 0) {
      ctx.addIssue({
        code: 'custom',
        message: `${conflicts.join(', ')} given both as top-level fields and in drivers.${value.provider} with different values`,
        path: ['drivers', value.provider],
      });
    }
  })
  .transform((value): SystemStorageValue => {
    const legacy = legacyFieldsFor(value.provider, legacyFieldsOf(value));
    const drivers: DriversRecord = {};
    for (const [id, entry] of Object.entries(value.drivers)) {
      drivers[id] = storageDriverKind.has(id) ? storageDriverKind.parseSettings(id, id === value.provider ? { ...legacy, ...entry } : entry) : entry;
    }
    if (!(value.provider in drivers) && Object.keys(legacy).length > 0 && storageDriverKind.has(value.provider)) {
      drivers[value.provider] = storageDriverKind.parseSettings(value.provider, legacy);
    }
    return { provider: value.provider, drivers };
  });

/**
 * The PUT body's `storage` branch: the wire schema, plus "the provider is a
 * registered driver" (the contract cannot see the registry).
 */
const putStorageSchema = storageSettingsSchema.refine((value) => storageDriverKind.has(value.provider), {
  message: 'provider must be the id of a registered storage driver',
  path: ['provider'],
});

// UNCONFIGURED: `provider: 's3'` names the driver the empty fields would be
// filled in for, and every field that would actually make a request go
// somewhere is empty. These are the ONLY source of a storage configuration
// (`STORAGE_PROVIDER`/`S3_*` were removed in #377), so a fresh deployment
// refuses storage operations with a 503 naming the empty fields until an
// administrator fills them in at /admin/settings/storage. `'s3'` rather than
// `null` because "no storage configured" is a driver whose settings are
// incomplete (`bucket === ''`): one question with one answer, not a second way
// to spell the same state. Only the built-ins are known when this module loads;
// `read` fills in every driver registered since.
const STORAGE_SYSTEM_DEFAULTS: SystemStorageValue = {
  provider: DEFAULT_PROVIDER,
  drivers: defaultDrivers(),
};

/**
 * The `storage` namespace's PATCH merge. `provider` replaces the active
 * driver (an unregistered id is a 400). `drivers.<id>` merges over that
 * driver's stored settings and is validated by the driver (`null` resets it to
 * its defaults); a driver the patch does not name keeps its settings. The
 * legacy flat fields merge into the settings of the driver named by
 * `provider`, with the semantics they always had: a field the patch names
 * replaces the stored one (an empty string included: `''` un-configures a
 * field), an absent field is kept, and `forcePathStyle` is replaced on any
 * value but `undefined` (`null` restores the vendor convention).
 *
 * Writes the new shape only; the legacy flat fields are never persisted.
 *
 * @param current - the stored value.
 * @param patch - the PATCH body's `storage` branch, when present.
 * @returns the merged value.
 *
 * @stability experimental
 */
export function mergeStorageSettings(current: SystemStorageValue, patch?: StorageSettingsPatchInput): SystemStorageValue {
  const provider = patch?.provider ?? current.provider;
  if (patch?.provider !== undefined && !storageDriverKind.has(provider)) {
    driverRejection(new PluggableUnknownError('storage-driver', provider, storageDriverKind.ids()));
  }

  const stored: DriversRecord = structuredClone(current.drivers);
  if (!patch) return { provider, drivers: stored };

  // `??` is the RIGHT operator for every STRING flat field even though it is
  // the wrong one for `maintenance.startedAt`: none of them is nullable, so a
  // caller can never send `null`, and a spread of the defined keys passes an
  // empty string through unchanged. That last part is load-bearing: `''` is
  // how an operator un-configures a field, and a `||` would silently turn
  // "clear the endpoint" into "keep the old endpoint", the class of bug that
  // leaves a deployment writing to a bucket it was told to stop writing to.
  // `forcePathStyle` is tri-state, so only `undefined` means "leave it alone":
  // the spread keeps an explicit `null`.
  const legacy = legacyFieldsFor(provider, legacyFieldsOf(patch as Record<string, unknown>));
  const named = patch.drivers?.[provider];
  const conflicts = conflictsBetween(legacy, isRecord(named) ? named : undefined);
  if (conflicts.length > 0) conflictingFields(provider, conflicts);

  const entries: Record<string, DriverSettings | null> = {};
  for (const [id, entry] of Object.entries(patch.drivers ?? {})) entries[id] = entry;
  if (Object.keys(legacy).length > 0) entries[provider] = { ...legacy, ...(entries[provider] ?? {}) };

  // NOTHING HERE TOUCHES A SECRET. A driver's secrets are not in the DTO, not in
  // the stored value and not in this merge; they are written through
  // `CredentialsService` on their own path.
  let drivers: DriversRecord;
  try {
    drivers = storageDriverKind.mergeSettingsRecord(stored, entries) as DriversRecord;
  } catch (error) {
    return driverRejection(error);
  }

  return { provider, drivers };
}

/**
 * The `storage` system-settings namespace (#373, epic #372; drivers: PP-14.7):
 * the object-storage driver configuration. Registered by the app's system
 * settings manifest, after the operations namespaces. No secret, ever.
 *
 * @stability experimental
 */
export const STORAGE_SYSTEM_SETTINGS = {
  /** The namespace key (permanent). */
  key: 'storage',
  /** What it holds. */
  description: 'Object-storage configuration: the active driver and each driver\'s own non-secret settings (bucket, region, endpoint, access key id, ...).',
  /** The stored shape. */
  storedSchema: storedStorageSchema,
  /** The stored partial. */
  patchSchema: systemStoragePatchSchema,
  /** The PUT body's branch. */
  putSchema: putStorageSchema,
  /** The PATCH body's branch. */
  wirePatchSchema: storageSettingsPatchSchema,
  /** The GET response's branch. */
  responseSchema: storageResponseSchema,
  /** Unconfigured: every field that would send a request somewhere is empty. */
  defaults: STORAGE_SYSTEM_DEFAULTS,
  /** Optional in a PUT body. */
  requiredOnPut: false,
  /**
   * Salvage a stored value in either shape (see the file header): every
   * registered driver present with defaults filled, an old flat row folded into
   * `drivers.<provider>`, field by field, and the active built-in's settings
   * republished as the deprecated flat fields.
   */
  read(stored: unknown, helpers: SettingsReadHelpers): SystemStorageValue {
    const { provider, drivers } = adaptStored(helpers.asPlainObject(stored) ?? {});
    return { provider, drivers, ...legacyMirror(provider, drivers) };
  },
  /** The PATCH merge (`mergeStorageSettings`). */
  merge: mergeStorageSettings,
} satisfies SystemSettingsNamespace<'storage', SystemStorageValue, StorageSettingsPatchInput>;

declare module '../../settings/index' {
  interface SystemSettingsNamespaces {
    /**
     * Object-storage configuration (#373, epic #372; drivers: PP-14.7): the
     * active driver and each driver's own non-secret settings. "Not configured"
     * is a driver whose settings are incomplete, never the block being absent;
     * see `systemStorageSchema`.
     */
    storage: SystemStorageValue;
  }
  interface SystemSettingsNamespaceDeclarations {
    /** The `storage` declaration. */
    storage: typeof STORAGE_SYSTEM_SETTINGS;
  }
}
