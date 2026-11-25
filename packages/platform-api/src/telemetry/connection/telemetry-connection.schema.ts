import { TELEMETRY_CONNECTION_DEFAULTS } from '@marinoscar/platform-contract/telemetry';

// =============================================================================
// The stored GreptimeDB connection — `system_settings.key = 'telemetry_connection'`
// (issue #558, epic #528)
// =============================================================================
//
// WHAT IS STORED, AND WHERE
// -----------------------------------------------------------------------------
//
//   system_settings row 'telemetry_connection'   custom:    host, pgPort, database,
//                                                           readerUser, adminUser
//                                                automatic: { host: null } only — the
//                                                           deployment supplies the rest (#570)
//   credentials (telemetry_greptime, reader)     the reader's password (custom host only)
//   credentials (telemetry_greptime, admin)      the admin's password  (custom host only)
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

/**
 * The host GreptimeDB answers on in every supported deployment: the Docker
 * Compose service name `greptimedb`, on the API's network, in both
 * `infra/compose/telemetry.compose.yml` and `vps.telemetry.compose.yml` (and
 * `.env.example` ships `GREPTIME_HOST=greptimedb`). It is the last resort of
 * the DEPLOYMENT HOST (`GREPTIME_HOST` when set and non-blank, else this), which
 * a stored connection with an AUTOMATIC host (`host: null`, issue #562)
 * resolves to at refresh time, so it follows the deployment instead of freezing
 * a literal an operator never chose.
 */
export const TELEMETRY_DEFAULT_HOST = 'greptimedb';

/** GreptimeDB's Postgres-wire default port, and its default database (`TELEMETRY_CONNECTION_DEFAULTS` in the contract). */
export const TELEMETRY_DEFAULT_PG_PORT = TELEMETRY_CONNECTION_DEFAULTS.pgPort;
export const TELEMETRY_DEFAULT_DATABASE = TELEMETRY_CONNECTION_DEFAULTS.database;

/** The deployment host: `GREPTIME_HOST` when set and non-blank, else `TELEMETRY_DEFAULT_HOST`. */
export function telemetryDeploymentHost(environmentHost: string | null | undefined): string {
  return environmentHost?.trim() || TELEMETRY_DEFAULT_HOST;
}

/**
 * Credential-store purpose (and cipher sub-key domain) of the two passwords.
 * Permanent: renaming it strands both stored passwords. The app declares it in
 * the credential purpose registry (`registerCredentialPurpose`, #735).
 *
 * @stability stable
 */
export const TELEMETRY_GREPTIME_CREDENTIAL_PURPOSE = 'telemetry_greptime';

/** The two logins the API uses. Also the credential names inside the purpose. */
export const TELEMETRY_CONNECTION_ROLES = ['reader', 'admin'] as const;
export type TelemetryConnectionRole = (typeof TELEMETRY_CONNECTION_ROLES)[number];

/** Admin-UI labels written alongside each credential. Non-secret. */
export const TELEMETRY_GREPTIME_CREDENTIAL_LABELS: Record<TelemetryConnectionRole, string> = {
  reader: 'GreptimeDB read-only login (telemetry explorer, status)',
  admin: 'GreptimeDB admin login (telemetry retention)',
};

// -----------------------------------------------------------------------------
// The stored value and its field validators
// -----------------------------------------------------------------------------
//
// The value schemas (`telemetryConnectionValueSchema` and its custom/automatic
// halves), the host, port, database and user validators and the compile-time
// proof that the stored row carries no secret
// (`TELEMETRY_CONNECTION_CARRIES_NO_SECRET`) live in
// `@marinoscar/platform-contract/telemetry` (#702): the admin form validates
// with the same rules. The host rule there reproduces `net.isIP` without Node
// (`telemetry-connection.schema.spec.ts` compares the two).
//
// The database name is held to a plain identifier because the retention job
// interpolates it UNQUOTED into `ALTER DATABASE` (GreptimeDB resolves a quoted
// name literally there) and refuses anything else — see `PLAIN_IDENTIFIER` in
// `handlers/telemetry-retention.handler.ts`. Accepting more would save a
// connection whose retention can never be applied.
//
// Adding a `readerPassword` (or any secret-like name) to the value schemas
// makes the proof resolve to `never` and the contract stops compiling. The
// passwords belong in `CredentialsService` under
// `TELEMETRY_GREPTIME_CREDENTIAL_PURPOSE`, never in a row whose value the
// audit trail copies.

export {
  TELEMETRY_CONNECTION_CARRIES_NO_SECRET,
  TELEMETRY_DATABASE_PATTERN,
  telemetryAutomaticConnectionValueSchema,
  telemetryConnectionValueSchema,
  telemetryCustomConnectionValueSchema,
  telemetryDatabaseSchema,
  telemetryHostSchema,
  telemetryOptionalHostSchema,
  telemetryPgPortSchema,
  telemetryUserSchema,
} from '@marinoscar/platform-contract/telemetry';
export type {
  TelemetryAutomaticConnectionValue,
  TelemetryConnectionCarriesNoSecret,
  TelemetryConnectionValue,
  TelemetryCustomConnectionValue,
} from '@marinoscar/platform-contract/telemetry';
