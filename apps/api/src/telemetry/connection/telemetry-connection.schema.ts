import { isIP } from 'node:net';

import { z } from 'zod';

// =============================================================================
// The stored GreptimeDB connection — `system_settings.key = 'telemetry_connection'`
// (issue #558, epic #528)
// =============================================================================
//
// WHAT IS STORED, AND WHERE
// -----------------------------------------------------------------------------
//
//   system_settings row 'telemetry_connection'   host, pgPort, database,
//                                                readerUser, adminUser
//   credentials (telemetry_greptime, reader)     the reader's password
//   credentials (telemetry_greptime, admin)      the admin's password
//
// The two passwords live in the encrypted credential store and nowhere else;
// the row carries no field able to hold one (compile-time proof below).
//
// WHY A ROW OF ITS OWN, NOT A NAMESPACE INSIDE 'global'. The same reason the
// email settings have one (`email/email-settings.service.ts`): the generic
// `PUT/PATCH /api/system-settings` owns the 'global' row, and a key it does
// not model is either clobbered by it or carried forward with a "preserved
// unknown key" warning on every unrelated save. A separate row cannot be
// touched by that endpoint at all, keeps the connection out of
// `GET /api/system-settings`, and gives `If-Match` a version counter of its
// own, so saving an unrelated setting cannot make this form's save conflict.
// ABSENT ROW = NOTHING STORED, which is what selects the deployment default
// (see `TelemetryConnectionService`).
//
// WHAT IS DELIBERATELY NOT HERE: THE WRITER CREDENTIAL AND THE HTTP PORT.
// `GREPTIME_WRITER_*` and `GREPTIME_HTTP_PORT` are consumed only by the OTel
// collector (which writes telemetry over HTTP) and the GreptimeDB container
// (which provisions its users from them). The API never writes telemetry and
// never speaks HTTP to GreptimeDB, so it has no use for either — and storing
// an unused write-capable secret here would widen what a compromise of the
// API's database yields, for nothing. They stay environment-only.
// =============================================================================

/** The `system_settings.key` the stored connection lives under. */
export const TELEMETRY_CONNECTION_SETTINGS_KEY = 'telemetry_connection';

/** Credential-store purpose (and cipher sub-key domain) of the two passwords. */
export const TELEMETRY_GREPTIME_CREDENTIAL_PURPOSE = 'telemetry_greptime';

/** The two logins the API uses. Also the credential names inside the purpose. */
export const TELEMETRY_CONNECTION_ROLES = ['reader', 'admin'] as const;
export type TelemetryConnectionRole = (typeof TELEMETRY_CONNECTION_ROLES)[number];

/** Admin-UI labels written alongside each credential. Non-secret. */
export const TELEMETRY_GREPTIME_CREDENTIAL_LABELS: Record<TelemetryConnectionRole, string> = {
  reader: 'GreptimeDB read-only login (telemetry explorer, status)',
  admin: 'GreptimeDB admin login (telemetry retention)',
};

/**
 * A hostname (RFC 1123 labels, plus `_`, which Docker Compose service names
 * use) or a bare IPv4/IPv6 address. No scheme, no port, no path: the port is
 * its own field and `pg` wants a bare host.
 */
const HOSTNAME_PATTERN =
  /^[A-Za-z0-9_](?:[A-Za-z0-9_-]{0,61}[A-Za-z0-9_])?(?:\.[A-Za-z0-9_](?:[A-Za-z0-9_-]{0,61}[A-Za-z0-9_])?)*$/;

/**
 * The database name is held to a plain identifier because the retention job
 * interpolates it UNQUOTED into `ALTER DATABASE` (GreptimeDB resolves a quoted
 * name literally there) and refuses anything else — see `PLAIN_IDENTIFIER` in
 * `handlers/telemetry-retention.handler.ts`. Accepting more here would save a
 * connection whose retention can never be applied.
 */
export const TELEMETRY_DATABASE_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const telemetryHostSchema = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .refine((value) => isIP(value) !== 0 || HOSTNAME_PATTERN.test(value), {
    message: 'host must be a hostname or an IP address — no scheme, port or path',
  });

export const telemetryPgPortSchema = z.number().int().min(1).max(65535);

export const telemetryDatabaseSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(TELEMETRY_DATABASE_PATTERN, {
    message: 'database must be a plain identifier (letters, digits and underscores, not starting with a digit)',
  });

export const telemetryUserSchema = z.string().trim().min(1).max(128);

/** The stored row's `value`. Non-secret by construction. */
export const telemetryConnectionValueSchema = z.object({
  host: telemetryHostSchema,
  pgPort: telemetryPgPortSchema,
  database: telemetryDatabaseSchema,
  readerUser: telemetryUserSchema,
  /** Null: no admin login, so retention cannot be applied (reads still work). */
  adminUser: telemetryUserSchema.nullable(),
});

export type TelemetryConnectionValue = z.infer<typeof telemetryConnectionValueSchema>;

// -----------------------------------------------------------------------------
// Compile-time proof that the stored connection carries no secret
// -----------------------------------------------------------------------------
//
// Identical technique to `TELEMETRY_SETTINGS_CARRIES_NO_SECRET` in
// `common/schemas/settings.schema.ts`. Adding a `readerPassword` (or any name
// below) to `telemetryConnectionValueSchema` makes this resolve to `never` and
// the file stops compiling. The passwords belong in `CredentialsService`
// under `TELEMETRY_GREPTIME_CREDENTIAL_PURPOSE`, never in a row whose value
// the audit trail copies.

type TelemetryConnectionSecretFieldNames =
  | 'password'
  | 'readerPassword'
  | 'adminPassword'
  | 'writerPassword'
  | 'secret'
  | 'secretKey'
  | 'apiKey'
  | 'key'
  | 'token'
  | 'connectionString'
  | 'url';

export type TelemetryConnectionCarriesNoSecret =
  Extract<keyof TelemetryConnectionValue, TelemetryConnectionSecretFieldNames> extends never
    ? true
    : never;

export const TELEMETRY_CONNECTION_CARRIES_NO_SECRET: TelemetryConnectionCarriesNoSecret = true;
