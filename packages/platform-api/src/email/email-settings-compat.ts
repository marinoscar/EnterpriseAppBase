// =============================================================================
// Email settings: the legacy flat fields and the `transports` record (PP-14.8)
// =============================================================================
//
// The `email` row stores `{ provider, enabled, fromAddress, fromName,
// transports }`. Before transports were pluggable it stored six flat fields
// (`sesRegion`, `sesAccessKeyId`, `smtpHost`, `smtpPort`, `smtpUseTls`,
// `smtpUsername`). They are still READ from a stored row (folded into
// `transports.ses` / `transports.smtp`), still ACCEPTED on `PUT` as aliases,
// and still SERVED on the response as a deprecated read view, so no existing
// row, client or script breaks. These pure helpers are the ONE place that
// does the folding, so the settings service, the Doctor and the egress view
// cannot disagree.
// =============================================================================

import { BadRequestException } from '@nestjs/common';
import { LEGACY_EMAIL_FLAT_FIELDS, LEGACY_EMAIL_FLAT_FIELD_TARGETS } from '@marinoscar/platform-contract/email';

import { PluggableSettingsError, PluggableUnknownError } from '../core/index';
import { emailTransportKind } from './transports/email-transport';

/**
 * One transport's settings record.
 *
 * @stability experimental
 */
export type EmailTransportSettingsRecord = Record<string, unknown>;
/**
 * The `transports` record: transport id to its settings.
 *
 * @stability experimental
 */
export type EmailTransportsRecord = Record<string, EmailTransportSettingsRecord>;
/** A legacy flat field name. */
export type LegacyEmailField = (typeof LEGACY_EMAIL_FLAT_FIELDS)[number];

/** The deprecated flat read view of the built-in transports' settings. */
export interface LegacyFlatView {
  sesRegion?: string;
  sesAccessKeyId?: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpUseTls?: boolean;
  smtpUsername?: string;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Folds the legacy flat fields of a stored row (or any object carrying them)
 * into `transports`, and drops them. A setting already present in
 * `transports.<id>` wins over its flat alias. A value that is not an object is
 * returned unchanged, so the schema reports it.
 *
 * @param raw - the stored `email` row value.
 * @returns the same row in the current shape.
 */
export function foldLegacyEmailFields(raw: unknown): unknown {
  if (!isRecord(raw)) return raw;

  const folded: Record<string, unknown> = { ...raw };
  const transports: Record<string, unknown> = isRecord(raw.transports) ? { ...raw.transports } : {};

  for (const field of LEGACY_EMAIL_FLAT_FIELDS) {
    if (!(field in folded)) continue;
    const value = folded[field];
    delete folded[field];
    if (value === undefined) continue;
    const { transport, setting } = LEGACY_EMAIL_FLAT_FIELD_TARGETS[field];
    const entry: Record<string, unknown> = isRecord(transports[transport]) ? { ...(transports[transport] as Record<string, unknown>) } : {};
    if (entry[setting] === undefined) entry[setting] = value;
    transports[transport] = entry;
  }

  if (isRecord(raw.transports) || Object.keys(transports).length > 0) folded.transports = transports;
  return folded;
}

/**
 * The deprecated flat read view of `transports`: only what is explicitly
 * stored (a non-empty text setting, a stored port or TLS flag), so a row
 * written by an earlier release reads back exactly as it was stored.
 *
 * @param transports - the stored `transports` record.
 * @returns the flat fields that apply.
 */
export function legacyFlatView(transports: EmailTransportsRecord | undefined): LegacyFlatView {
  const view: Record<string, string | number | boolean> = {};
  if (!transports) return view;

  for (const field of LEGACY_EMAIL_FLAT_FIELDS) {
    const { transport, setting } = LEGACY_EMAIL_FLAT_FIELD_TARGETS[field];
    const value = transports[transport]?.[setting];
    if (typeof value === 'string' && value.length > 0) view[field] = value;
    else if (typeof value === 'number' || typeof value === 'boolean') view[field] = value;
  }

  return view as LegacyFlatView;
}

/**
 * `transports` as an object carrying the flat fields describes it (a row's
 * folded settings, or an admin view built by an older caller).
 *
 * @param source - an object that may carry the legacy flat fields.
 */
export function transportsFromFlat(source: object): EmailTransportsRecord {
  const folded = foldLegacyEmailFields(source) as { transports?: EmailTransportsRecord };
  return folded.transports ?? {};
}

/**
 * The stored settings of transport `id` in an object that carries `transports`
 * and/or the legacy flat fields; `{}` when there are none.
 *
 * @param source - settings, or an admin view.
 * @param id - the transport id.
 */
export function storedTransportSettings(source: { transports?: EmailTransportsRecord }, id: string): EmailTransportSettingsRecord {
  const merged = transportsFromFlat({ ...source, transports: source.transports });
  return merged[id] ?? {};
}

/**
 * The settings of transport `id`, parsed with its own schema and with its
 * defaults filled; the defaults when the stored entry does not parse.
 *
 * @param source - settings, or an admin view.
 * @param id - a registered transport id.
 */
export function parsedTransportSettings(source: { transports?: EmailTransportsRecord }, id: string): EmailTransportSettingsRecord {
  try {
    return emailTransportKind.parseSettings(id, storedTransportSettings(source, id));
  } catch (error) {
    if (!(error instanceof PluggableSettingsError)) throw error;
    return emailTransportKind.parseSettings(id, {});
  }
}

/**
 * The field paths of the stored `transports` that a REGISTERED transport's
 * schema refuses (`transports.smtp.port`). An unregistered id is not an error
 * here (removing a plugin never bricks the row). Paths only, never values.
 *
 * @param transports - the stored `transports` record.
 */
export function invalidTransportPaths(transports: EmailTransportsRecord | undefined): string[] {
  const paths: string[] = [];
  for (const [id, value] of Object.entries(transports ?? {})) {
    if (!emailTransportKind.has(id)) continue;
    try {
      emailTransportKind.parseSettings(id, value);
    } catch (error) {
      if (!(error instanceof PluggableSettingsError)) throw error;
      for (const issue of error.issues) paths.push(['transports', id, ...issue.path.map(String)].join('.'));
    }
  }
  return paths;
}

/** The 400 for a transport id nobody registered. */
export function unknownTransportRejection(id: string, registeredIds: readonly string[] = emailTransportKind.ids()): never {
  throw new BadRequestException({
    message: `Unknown email transport "${id}". Registered: ${registeredIds.join(', ') || '(none)'}.`,
    details: { reason: 'EMAIL_UNKNOWN_TRANSPORT', transport: id },
  });
}

/** The 400 for a `transports` write the registry refuses. */
export function transportRejection(error: unknown): never {
  if (error instanceof PluggableUnknownError) {
    return unknownTransportRejection(error.id, error.registeredIds);
  }
  if (error instanceof PluggableSettingsError) {
    throw new BadRequestException({
      message: `The settings for email transport "${error.id}" are not valid: ${error.message}`,
      details: {
        reason: 'EMAIL_TRANSPORT_SETTINGS_INVALID',
        transport: error.id,
        fields: [...new Set(error.issues.map((issue) => String(issue.path[0] ?? '')))].filter(Boolean),
      },
    });
  }
  throw error;
}

/** The 400 for a secret a transport never declared. */
export function unknownSecretRejection(transport: string, name: string, declared: readonly string[]): never {
  throw new BadRequestException({
    message: `Email transport "${transport}" declares no secret "${name}". Declared: ${declared.join(', ') || '(none)'}.`,
    details: { reason: 'EMAIL_UNKNOWN_SECRET', transport, secret: name },
  });
}

/** Whether a PUT value is an "empty box" (`''` or `null`). */
function isBlank(value: unknown): boolean {
  return value === '' || value === null;
}

/**
 * The `transports` patch the legacy flat aliases of a PUT body describe. A
 * blank alias (`''` or `null`) resets that setting to the transport's default,
 * which is what "clear this field" meant when the row was replaced wholesale.
 *
 * @param body - the PUT body (or any object carrying the flat aliases).
 * @returns `{ <transportId>: { <setting>: value } }`; only transports that are registered.
 */
export function legacyAliasPatch(body: Record<string, unknown>): Record<string, Record<string, unknown>> {
  const patch: Record<string, Record<string, unknown>> = {};

  for (const field of LEGACY_EMAIL_FLAT_FIELDS) {
    const value = body[field];
    if (value === undefined) continue;
    const { transport, setting } = LEGACY_EMAIL_FLAT_FIELD_TARGETS[field];
    if (!emailTransportKind.has(transport)) continue;
    const defaults = emailTransportKind.get(transport).defaults as Record<string, unknown>;
    (patch[transport] ??= {})[setting] = isBlank(value) ? defaults[setting] : value;
  }

  return patch;
}
