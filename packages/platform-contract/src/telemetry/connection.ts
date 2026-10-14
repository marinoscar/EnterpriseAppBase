// =============================================================================
// /api/admin/telemetry/connection (issue #558; moved here from the API's
// `telemetry/connection/dto/telemetry-connection.dto.ts` and the value
// schemas of `telemetry/connection/telemetry-connection.schema.ts` by #702)
// =============================================================================
//
// Passwords are WRITE-ONLY. They appear in the two request bodies and in no
// response: a response carries a masked `credentials.<login>` status built
// from the credential store's description, which cannot decrypt anything.
//
// The stored connection (`system_settings` row `telemetry_connection`) is
// non-secret by construction: `TelemetryConnectionCarriesNoSecret` below stops
// compiling if a password field is added to it. Where it is stored, its
// credential purpose and the deployment host resolution stay in the API.
// =============================================================================

import { z } from 'zod';

import {
  TELEMETRY_CONNECTION_DEFAULTS,
  TELEMETRY_CONNECTION_HOST_MODES,
  TELEMETRY_CONNECTION_SOURCES,
  TELEMETRY_DATABASE_PATTERN,
  TELEMETRY_HOSTNAME_PATTERN,
} from './constants.js';
import { wireEnum } from './enum.js';

// ---- IP literals -------------------------------------------------------------
//
// The same grammar as Node's `net.isIP` (lib/internal/net.js), so the host
// rule is identical in the browser, which has no `node:net`. The API's
// `telemetry-connection.schema.spec.ts` compares the two over a corpus.

const V4_SEG = '(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])';
const V4_STR = `(?:${V4_SEG}\\.){3}${V4_SEG}`;
const IPV4 = new RegExp(`^${V4_STR}$`);
const V6_SEG = '(?:[0-9a-fA-F]{1,4})';
const IPV6 = new RegExp(
  '^(?:' +
    `(?:${V6_SEG}:){7}(?:${V6_SEG}|:)|` +
    `(?:${V6_SEG}:){6}(?:${V4_STR}|:${V6_SEG}|:)|` +
    `(?:${V6_SEG}:){5}(?::${V4_STR}|(?::${V6_SEG}){1,2}|:)|` +
    `(?:${V6_SEG}:){4}(?:(?::${V6_SEG}){0,1}:${V4_STR}|(?::${V6_SEG}){1,3}|:)|` +
    `(?:${V6_SEG}:){3}(?:(?::${V6_SEG}){0,2}:${V4_STR}|(?::${V6_SEG}){1,4}|:)|` +
    `(?:${V6_SEG}:){2}(?:(?::${V6_SEG}){0,3}:${V4_STR}|(?::${V6_SEG}){1,5}|:)|` +
    `(?:${V6_SEG}:){1}(?:(?::${V6_SEG}){0,4}:${V4_STR}|(?::${V6_SEG}){1,6}|:)|` +
    `(?::(?:(?::${V6_SEG}){0,5}:${V4_STR}|(?::${V6_SEG}){1,7}|:))` +
    ')(?:%[0-9a-zA-Z-.:]{1,})?$',
);

/**
 * `4` for an IPv4 literal, `6` for an IPv6 literal (zone id allowed), `0`
 * otherwise: the same answers as Node's `net.isIP`, without Node.
 *
 * @stability stable
 */
export function telemetryIpVersion(value: string): 0 | 4 | 6 {
  if (IPV4.test(value)) return 4;
  if (IPV6.test(value)) return 6;
  return 0;
}

// ---- field validators ----------------------------------------------------------

/**
 * A GreptimeDB host: a hostname ({@link TELEMETRY_HOSTNAME_PATTERN}) or a bare
 * IPv4/IPv6 address, trimmed, 1..253 characters. No scheme, port or path.
 *
 * @extensionPoint schema
 * @stability stable
 */
export const telemetryHostSchema = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .refine((value) => telemetryIpVersion(value) !== 0 || TELEMETRY_HOSTNAME_PATTERN.test(value), {
    message: 'host must be a hostname or an IP address — no scheme, port or path',
  });

/**
 * A host as SUBMITTED on the admin form: absent, `null` or blank means
 * AUTOMATIC (output `null`: the deployment host, resolved at use); anything
 * else is a custom host validated by {@link telemetryHostSchema}.
 *
 * @extensionPoint schema
 * @stability stable
 */
export const telemetryOptionalHostSchema = z
  .string()
  .nullish()
  .transform((value) => (value?.trim() ? value.trim() : null))
  .pipe(telemetryHostSchema.nullable());

/**
 * GreptimeDB's Postgres-wire port: an integer 1..65535.
 *
 * @extensionPoint schema
 * @stability stable
 */
export const telemetryPgPortSchema = z.number().int().min(1).max(65535);

/**
 * A connection's database: trimmed, 1..128 characters, a plain identifier
 * ({@link TELEMETRY_DATABASE_PATTERN}).
 *
 * @extensionPoint schema
 * @stability stable
 */
export const telemetryDatabaseSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(TELEMETRY_DATABASE_PATTERN, {
    message: 'database must be a plain identifier (letters, digits and underscores, not starting with a digit)',
  });

/**
 * A GreptimeDB login name: trimmed, 1..128 characters.
 *
 * @extensionPoint schema
 * @stability stable
 */
export const telemetryUserSchema = z.string().trim().min(1).max(128);

// ---- the stored value ------------------------------------------------------------

/**
 * A stored CUSTOM connection: `host`, `pgPort`, `database`, `readerUser` and
 * `adminUser` (`null`: no admin login, so retention cannot be applied). The
 * two passwords live in the encrypted credential store, never here.
 *
 * @extensionPoint schema
 * @stability stable
 */
export const telemetryCustomConnectionValueSchema = z.object({
  /** The custom host. */
  host: telemetryHostSchema,
  /** GreptimeDB's Postgres-wire port. */
  pgPort: telemetryPgPortSchema,
  /** The database telemetry is written to. */
  database: telemetryDatabaseSchema,
  /** The read-only login. */
  readerUser: telemetryUserSchema,
  /** Null: no admin login, so retention cannot be applied (reads still work). */
  adminUser: telemetryUserSchema.nullable(),
});

/**
 * A stored AUTOMATIC connection: `{ host: null }`, a marker only. The
 * deployment supplies the host, port, database, logins and passwords at every
 * refresh; extra keys of older rows are stripped on parse.
 *
 * @extensionPoint schema
 * @stability stable
 */
export const telemetryAutomaticConnectionValueSchema = z.object({
  /** Always `null`: the host is the deployment's. */
  host: z.null(),
});

/**
 * The stored connection row's `value`: custom or automatic. Non-secret by
 * construction ({@link TelemetryConnectionCarriesNoSecret}).
 *
 * @extensionPoint schema
 * @stability stable
 */
export const telemetryConnectionValueSchema = z.union([
  telemetryCustomConnectionValueSchema,
  telemetryAutomaticConnectionValueSchema,
]);

/**
 * A stored custom connection.
 *
 * @stability stable
 */
export type TelemetryCustomConnectionValue = z.infer<typeof telemetryCustomConnectionValueSchema>;

/**
 * A stored automatic connection.
 *
 * @stability stable
 */
export type TelemetryAutomaticConnectionValue = z.infer<typeof telemetryAutomaticConnectionValueSchema>;

/**
 * The stored connection row's `value`.
 *
 * @stability stable
 */
export type TelemetryConnectionValue = z.infer<typeof telemetryConnectionValueSchema>;

/**
 * Field names that would mean a secret had been added to the stored
 * connection; {@link TelemetryConnectionCarriesNoSecret} refuses each.
 *
 * @stability stable
 */
export type TelemetryConnectionSecretFieldNames =
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

/**
 * Compile-time proof that the stored connection carries no secret: `true`,
 * or `never` (and this package stops compiling) once a field such as
 * `readerPassword` is added to either value schema.
 *
 * @stability stable
 */
export type TelemetryConnectionCarriesNoSecret =
  Extract<
    keyof TelemetryCustomConnectionValue | keyof TelemetryAutomaticConnectionValue,
    TelemetryConnectionSecretFieldNames
  > extends never
    ? true
    : never;

/**
 * The value of {@link TelemetryConnectionCarriesNoSecret}; it only compiles
 * while the proof holds.
 *
 * @stability stable
 */
export const TELEMETRY_CONNECTION_CARRIES_NO_SECRET: TelemetryConnectionCarriesNoSecret = true;

// ---- request bodies ----------------------------------------------------------------

/** A password as submitted. Not trimmed: a secret is stored byte for byte. */
const passwordSchema = z.string().max(1024);

/**
 * `readerUser` — blank is "not sent" (an automatic host needs none; a custom
 * one is refused without it, below).
 */
const readerUserSchema = z
  .string()
  .trim()
  .max(128)
  .optional()
  .transform((value) => (value ? value : undefined));

/**
 * `adminUser` — null (or an empty string) means "no admin login", which
 * removes a stored admin password. Absent (undefined) is only accepted for an
 * automatic host; a custom one must say which (or null).
 */
const adminUserSchema = z
  .string()
  .trim()
  .max(128)
  .nullish()
  .transform((value) => (value === undefined ? undefined : value ? value : null));

/**
 * AUTOMATIC vs CUSTOM (issue #570). A blank host means the GreptimeDB deployed
 * with this application, whose port, database, logins and passwords the
 * deployment supplies: every other field is then accepted (older clients send
 * them) and IGNORED. A custom host needs `readerUser` and `adminUser` (or
 * null), exactly as before.
 */
function requireLoginsForCustomHost(
  value: { host: string | null; readerUser?: string; adminUser?: string | null },
  ctx: z.RefinementCtx,
): void {
  if (value.host === null) return;

  if (!value.readerUser) {
    ctx.addIssue({ code: 'custom', path: ['readerUser'], message: 'readerUser is required for a custom host' });
  }

  if (value.adminUser === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['adminUser'],
      message: 'adminUser is required for a custom host (send null for no admin login)',
    });
  }
}

/**
 * `PUT /api/admin/telemetry/connection` body. A blank or absent `host` is
 * AUTOMATIC and every other field is ignored; a custom host needs
 * `readerUser` and `adminUser` (or `null`). An omitted or empty password
 * keeps the stored one. Output: `host` is `null` for automatic, `pgPort`
 * defaults to 4003 and `database` to `public`.
 *
 * @extensionPoint schema
 * @stability stable
 */
export const updateTelemetryConnectionSchema = z
  .object({
    /**
     * Hostname or IP address of GreptimeDB's Postgres-wire endpoint (no scheme,
     * port or path) — a CUSTOM GreptimeDB. Omit it, or send null or blank, for
     * AUTOMATIC: the GreptimeDB deployed with this application. Automatic is
     * stored as a marker only; its host, port, database, logins and passwords
     * all come from the deployment, and every other field of this body is
     * ignored.
     */
    host: telemetryOptionalHostSchema,
    /** Custom host only (ignored when automatic). GreptimeDB's Postgres-wire port. Omitted: 4003. */
    pgPort: telemetryPgPortSchema.default(TELEMETRY_CONNECTION_DEFAULTS.pgPort),
    /** Custom host only (ignored when automatic). A plain identifier. Omitted: `public`. */
    database: telemetryDatabaseSchema.default(TELEMETRY_CONNECTION_DEFAULTS.database),
    /** Custom host only, and required there: the read-only GreptimeDB user. Ignored when automatic. */
    readerUser: readerUserSchema,
    /**
     * Custom host only. Write-only. Omit or send empty to KEEP the stored
     * reader password; a save with none stored and none sent is a 400.
     * Ignored when automatic.
     */
    readerPassword: passwordSchema.optional(),
    /**
     * Custom host only, and required there: the DDL-capable user retention
     * needs, or null for none (retention is then not applied). Ignored when
     * automatic.
     */
    adminUser: adminUserSchema,
    /**
     * Custom host only. Write-only. Omit or send empty to KEEP the stored
     * admin password. Ignored when `adminUser` is null (the stored one is then
     * deleted) and when automatic.
     */
    adminPassword: passwordSchema.optional(),
  })
  .superRefine(requireLoginsForCustomHost);

/**
 * The `PUT /api/admin/telemetry/connection` body as a client sends it.
 *
 * @stability stable
 */
export type UpdateTelemetryConnectionRequest = z.input<typeof updateTelemetryConnectionSchema>;

/**
 * The `PUT /api/admin/telemetry/connection` body after parsing (defaults
 * applied, blanks normalized).
 *
 * @stability stable
 */
export type UpdateTelemetryConnectionInput = z.output<typeof updateTelemetryConnectionSchema>;

/**
 * `POST /api/admin/telemetry/connection/test` body: a CANDIDATE connection,
 * not necessarily saved, in the shape of {@link updateTelemetryConnectionSchema}.
 * A blank host probes the deployment's own GreptimeDB with its own logins;
 * for a custom host, a blank password means "the password the connection in
 * force uses for that login".
 *
 * @extensionPoint schema
 * @stability stable
 */
export const testTelemetryConnectionSchema = updateTelemetryConnectionSchema;

/**
 * The `POST /api/admin/telemetry/connection/test` body after parsing.
 *
 * @stability stable
 */
export type TestTelemetryConnectionInput = z.output<typeof testTelemetryConnectionSchema>;

// ---- responses ----------------------------------------------------------------------

/**
 * Masked, non-secret facts about one stored password: `configured`, `hint`
 * (the credential store's mask, never the password), `updatedAt` and
 * `updatedByUserId`.
 *
 * @extensionPoint schema
 * @stability stable
 */
export const telemetryCredentialStatusSchema = z.object({
  /**
   * Whether a password is present for this login in the connection's source
   * (the deployment's while `deploymentManaged`, the credential store's for a
   * custom host).
   */
  configured: z.boolean(),
  /**
   * The credential store's mask (`••••Xk9q`) so an admin can tell two
   * passwords apart. Never the password. Always null for the deployment
   * default: the environment's value is not the store's to describe.
   */
  hint: z.string().nullable(),
  /** When the password was last stored, or `null`. */
  updatedAt: z.iso.datetime().nullable(),
  /** Who stored it, or `null`. */
  updatedByUserId: z.string().nullable(),
});

/**
 * Masked facts about one stored password.
 *
 * @stability stable
 */
export type TelemetryCredentialStatus = z.infer<typeof telemetryCredentialStatusSchema>;

/**
 * The GreptimeDB deployed with this application, as the deployment describes
 * it: `host`, `pgPort`, `database`, `readerUser`, `adminUser`,
 * `readerConfigured` and `adminConfigured`. Non-secret: never a password.
 *
 * @extensionPoint schema
 * @stability stable
 */
export const telemetryDeploymentConnectionSchema = z.object({
  /** The deployment host an automatic connection uses. */
  host: z.string(),
  /** The deployment's Postgres-wire port. */
  pgPort: z.number().int(),
  /** The deployment's database. */
  database: z.string(),
  /** Empty when the deployment provisions no reader login. */
  readerUser: z.string(),
  /** The deployment's admin login, or `null` when it provisions none. */
  adminUser: z.string().nullable(),
  /** The deployment provides a reader user and its password. Never the password itself. */
  readerConfigured: z.boolean(),
  /** The deployment provides an admin user and its password. Never the password itself. */
  adminConfigured: z.boolean(),
});

/**
 * The GreptimeDB deployed with this application.
 *
 * @stability stable
 */
export type TelemetryDeploymentConnection = z.infer<typeof telemetryDeploymentConnectionSchema>;

/**
 * `GET /api/admin/telemetry/connection` (and the `PUT` / `DELETE`
 * responses): where the connection comes from, its host as configured and as
 * used, the deployment's own connection, the logins, masked password
 * statuses and the row `version` (send it back as `If-Match`).
 *
 * @extensionPoint schema
 * @stability stable
 */
export const telemetryConnectionResponseSchema = z.object({
  /**
   * Where the connection in force comes from: `stored` (saved on this page —
   * a custom host, or the automatic marker), `environment` (nothing saved:
   * the deployment's own GreptimeDB) or `none`.
   */
  source: wireEnum(TELEMETRY_CONNECTION_SOURCES),
  /**
   * The host as CONFIGURED: null when it is automatic (a stored automatic
   * connection, `source` `environment` or `source` `none`); a literal only for
   * a stored custom host.
   */
  host: z.string().nullable(),
  /**
   * The host actually used (or, for `source` `none`, the one an automatic
   * host would use: the deployment host). Empty only for a stored connection
   * that does not validate.
   */
  effectiveHost: z.string(),
  /** `auto` — `host` is null and `effectiveHost` is the deployment host; `custom` — a literal. */
  hostMode: wireEnum(TELEMETRY_CONNECTION_HOST_MODES),
  /**
   * True when the whole connection (port, database, logins, passwords) comes
   * from the deployment and nothing but the host mode is the administrator's
   * to set: `source` `environment`, or a stored automatic host. The form
   * then collects no credentials.
   */
  deploymentManaged: z.boolean(),
  /**
   * The GreptimeDB deployed with this application — what an automatic host
   * uses (and what `pgPort`/`database`/users show while `deploymentManaged`).
   * Present whatever is in force, so a form switching back to automatic can
   * say what it will get.
   */
  deployment: telemetryDeploymentConnectionSchema,
  /**
   * Why a deployment-managed connection cannot be used, in administrator
   * language (for example, the deployment provisions no reader login), or
   * null. Always null for a custom host: its problems are a test's to find.
   */
  problem: z.string().nullable(),
  /** The Postgres-wire port in force. */
  pgPort: z.number().int(),
  /** The database in force. */
  database: z.string(),
  /** Empty when `source` is `none`. */
  readerUser: z.string(),
  /** The admin login in force, or `null` for none. */
  adminUser: z.string().nullable(),
  /** A host, a reader login and its password: telemetry can be read. */
  configured: z.boolean(),
  /** The admin login is usable as well, so retention can be applied. */
  adminConfigured: z.boolean(),
  /** Masked status of the two stored passwords. Never a password. */
  credentials: z.object({
    /** The reader login's password. */
    reader: telemetryCredentialStatusSchema,
    /** The admin login's password. */
    admin: telemetryCredentialStatusSchema,
  }),
  /** The stored connection's version — send it back as `If-Match`. `0` when nothing is stored. */
  version: z.number().int(),
  /** When the connection was last saved, or `null`. */
  updatedAt: z.iso.datetime().nullable(),
  /** Who saved it last, or `null`. */
  updatedBy: z
    .object({
      /** The user's id. */
      id: z.string(),
      /** The user's email. */
      email: z.string(),
    })
    .nullable(),
});

/**
 * `GET /api/admin/telemetry/connection`.
 *
 * @stability stable
 */
export type TelemetryConnectionResponse = z.infer<typeof telemetryConnectionResponseSchema>;

/**
 * One login's probe in a connection test: `success`, `latencyMs`, `version`
 * (reader only) and `error` (never a password or connection string).
 *
 * @extensionPoint schema
 * @stability stable
 */
export const telemetryConnectionProbeSchema = z.object({
  /** Whether the login connected and the statement ran. */
  success: z.boolean(),
  /** Wall-clock time of the connect + statement, in milliseconds. */
  latencyMs: z.number().int(),
  /** `SELECT version()` — reader check only. */
  version: z.string().optional(),
  /** The driver's or server's message. Never a password or connection string. */
  error: z.string().optional(),
});

/**
 * One login's probe in a connection test.
 *
 * @stability stable
 */
export type TelemetryConnectionProbe = z.infer<typeof telemetryConnectionProbeSchema>;

/**
 * `{ skipped: true }`: the candidate had no admin user, so the admin login
 * was not checked.
 *
 * @extensionPoint schema
 * @stability stable
 */
export const telemetryConnectionSkippedSchema = z.object({
  /** No admin user in the candidate, so the admin login was not checked. */
  skipped: z.literal(true),
});

/**
 * A skipped admin probe.
 *
 * @stability stable
 */
export type TelemetryConnectionSkipped = z.infer<typeof telemetryConnectionSkippedSchema>;

/**
 * `POST /api/admin/telemetry/connection/test` response, always a 200: the
 * `host` probed, `hostMode`, the `reader` probe and the `admin` probe (or
 * skipped).
 *
 * @extensionPoint schema
 * @stability stable
 */
export const telemetryConnectionTestResultSchema = z.object({
  /** The host actually probed — the deployment host when the request left `host` blank. */
  host: z.string(),
  /**
   * `auto` — the request left `host` blank, so the deployment's own GreptimeDB
   * was probed with the deployment's logins (submitted credentials ignored);
   * `custom` — the submitted host and credentials.
   */
  hostMode: wireEnum(TELEMETRY_CONNECTION_HOST_MODES),
  /** `SELECT version()` as the reader. */
  reader: telemetryConnectionProbeSchema,
  /** `SHOW CREATE DATABASE <database>` as the admin, or skipped. */
  admin: z.union([telemetryConnectionProbeSchema, telemetryConnectionSkippedSchema]),
});

/**
 * The `POST /api/admin/telemetry/connection/test` response.
 *
 * @stability stable
 */
export type TelemetryConnectionTestResult = z.infer<typeof telemetryConnectionTestResultSchema>;
