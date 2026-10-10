// =============================================================================
// Storage settings: the legacy flat fields and their 400s (PP-14.7, #925)
// =============================================================================
//
// The `storage` namespace stores `{ provider, drivers }`. Before drivers were
// pluggable it stored six flat fields (`bucket`, `region`, `endpoint`,
// `accountId`, `accessKeyId`, `forcePathStyle`); they are still accepted on a
// stored row, a PUT, a PATCH and on the admin routes as aliases of the active
// built-in driver's settings. These pure helpers are the ONE place that folds
// them into `drivers.<provider>` and refuses the ambiguous case, so the
// settings namespace and the admin routes cannot disagree.
// =============================================================================

import { BadRequestException } from '@nestjs/common';
import { LEGACY_STORAGE_FLAT_FIELDS } from '@marinoscar/platform-contract/storage';

import { PluggableSettingsError, PluggableUnknownError } from '../../core/index';
import { storageDriverKind } from '../drivers/storage-driver';

/** One driver's settings record. */
export type DriverSettings = Record<string, unknown>;
/** The `drivers` record: driver id to its settings. */
export type DriversRecord = Record<string, DriverSettings>;
/** The legacy flat field names. */
export type LegacyField = (typeof LEGACY_STORAGE_FLAT_FIELDS)[number];

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The legacy flat fields present in `source`, whatever their value. */
export function legacyFieldsOf(source: Record<string, unknown>): Partial<Record<LegacyField, unknown>> {
  const picked: Partial<Record<LegacyField, unknown>> = {};
  for (const field of LEGACY_STORAGE_FLAT_FIELDS) {
    if (source[field] !== undefined) picked[field] = source[field];
  }
  return picked;
}

/** The part of the legacy fields `id`'s `settingsSchema` declares. */
export function legacyFieldsFor(id: string, flat: Partial<Record<LegacyField, unknown>>): DriverSettings {
  if (!storageDriverKind.has(id)) return {};
  const shape = storageDriverKind.get(id).settingsSchema.shape;
  return Object.fromEntries(Object.entries(flat).filter(([field]) => field in shape));
}

/** The 400 for a driver id nobody registered. */
export function unknownDriverRejection(id: string, registeredIds: readonly string[] = storageDriverKind.ids()): never {
  throw new BadRequestException({
    message: `Unknown storage driver "${id}". Registered: ${registeredIds.join(', ') || '(none)'}.`,
    details: { reason: 'STORAGE_UNKNOWN_DRIVER', driver: id },
  });
}

/** The 400 for a `drivers` write the registry refuses. */
export function driverRejection(error: unknown): never {
  if (error instanceof PluggableUnknownError) {
    return unknownDriverRejection(error.id, error.registeredIds);
  }
  if (error instanceof PluggableSettingsError) {
    throw new BadRequestException({
      message: `The settings for storage driver "${error.id}" are not valid: ${error.message}`,
      details: {
        reason: 'STORAGE_DRIVER_SETTINGS_INVALID',
        driver: error.id,
        fields: [...new Set(error.issues.map((issue) => String(issue.path[0] ?? '')))].filter(Boolean),
      },
    });
  }
  throw error;
}

/** The 400 for a flat field and `drivers.<provider>` naming one setting with two values. */
export function conflictingFields(provider: string, fields: string[]): never {
  throw new BadRequestException({
    message:
      `The storage setting(s) ${fields.join(', ')} are given both as top-level fields and in drivers.${provider} ` +
      'with different values. Send them once (drivers is the current shape; the top-level fields are the legacy alias).',
    details: { reason: 'STORAGE_CONFLICTING_SETTINGS', driver: provider, fields },
  });
}

export function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The flat fields `legacy` and the entry `entry` both name, with different values. */
export function conflictsBetween(legacy: DriverSettings, entry: DriverSettings | undefined): string[] {
  if (!entry) return [];
  return Object.keys(legacy).filter((field) => entry[field] !== undefined && !sameValue(entry[field], legacy[field]));
}


/**
 * The settings of driver `id` a submitted admin body describes: the stored
 * ones, then the legacy flat aliases, then `drivers.<id>` (`null` there resets
 * the driver to its defaults), parsed with the driver's own schema. Used by the
 * connection test and the provisioning route, which act on the SUBMITTED,
 * unsaved configuration.
 *
 * @param id - a registered driver id.
 * @param stored - the driver's stored settings, if any.
 * @param input - the request body (`drivers` and the flat aliases).
 * @throws BadRequestException when the aliases and `drivers.<id>` disagree, or the settings do not parse.
 */
export function submittedDriverSettings(id: string, stored: DriverSettings | undefined, input: Record<string, unknown>): DriverSettings {
  const flat = legacyFieldsFor(id, legacyFieldsOf(input));
  const drivers = isRecord(input.drivers) ? input.drivers : {};
  const named = drivers[id];
  const conflicts = conflictsBetween(flat, isRecord(named) ? named : undefined);
  if (conflicts.length > 0) conflictingFields(id, conflicts);

  const base = named === null ? {} : (stored ?? {});

  try {
    return storageDriverKind.parseSettings(id, { ...base, ...flat, ...(isRecord(named) ? named : {}) });
  } catch (error) {
    return driverRejection(error);
  }
}

/**
 * The secrets a submitted admin body carries for driver `id`, by declared
 * name: `secrets.<id>.<name>`, or `secretAccessKey` for the built-ins' secret.
 * A blank value is absent (blank preserves the stored one).
 *
 * @param id - a registered driver id.
 * @param input - the request body.
 */
export function submittedSecretValues(id: string, input: Record<string, unknown>): Record<string, string> {
  const declared = storageDriverKind.get(id).secrets ?? [];
  const bySecrets = isRecord(input.secrets) && isRecord(input.secrets[id]) ? (input.secrets[id] as Record<string, unknown>) : {};
  const values: Record<string, string> = {};

  for (const spec of declared) {
    const candidate = bySecrets[spec.name] ?? (spec.name === 'secretAccessKey' ? input.secretAccessKey : undefined);
    if (typeof candidate === 'string' && candidate.length > 0) values[spec.name] = candidate;
  }

  return values;
}
