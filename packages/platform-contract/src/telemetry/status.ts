// =============================================================================
// GET /api/admin/telemetry/status (issue #534; moved here from the API's
// `telemetry/dto/telemetry-status.dto.ts` by #702)
// =============================================================================
//
// A diagnosis, never an error: an unconfigured or unreachable store is
// reported in these fields with a 200, so the admin page can say what is
// wrong instead of rendering a failure.
// =============================================================================

import { z } from 'zod';

/**
 * The database-level TTL in force: `raw` (as `SHOW CREATE DATABASE` prints
 * it) and `days` (whole days, or `null` for `forever` or an unparseable value).
 *
 * @extensionPoint schema
 * @stability stable
 */
export const telemetryTtlSchema = z.object({
  /** The TTL exactly as `SHOW CREATE DATABASE` prints it, e.g. `7days` or `1month 13h 26m 24s`. */
  raw: z.string(),
  /** `raw` in whole days (rounded), or null for `forever` / an unparseable value. */
  days: z.number().int().nullable(),
});

/**
 * One table of the telemetry database: `name` and `rows` (GreptimeDB's
 * estimate, or `null`).
 *
 * @extensionPoint schema
 * @stability stable
 */
export const telemetryTableSchema = z.object({
  /** The table name. */
  name: z.string(),
  /** GreptimeDB's row estimate from `information_schema.tables`, or null when not reported. */
  rows: z.number().nullable(),
});

/**
 * `GET /api/admin/telemetry/status`: `configured`, `reachable`, `version`,
 * `database`, `ttl`, `retentionDays`, `tables` and `error`.
 *
 * @extensionPoint schema
 * @stability stable
 */
export const telemetryStatusSchema = z.object({
  /** GreptimeDB is configured (admin UI or deployment default) — see `GET /api/admin/telemetry/connection`. */
  configured: z.boolean(),
  /** A `SELECT version()` round trip succeeded just now. */
  reachable: z.boolean(),
  /** e.g. `PostgreSQL 16.3 GreptimeDB 1.2.1`, or null when unreachable. */
  version: z.string().nullable(),
  /** The GreptimeDB database telemetry is written to. */
  database: z.string(),
  /** The database-level TTL currently in force, or null when none is set or it could not be read. */
  ttl: telemetryTtlSchema.nullable(),
  /** `telemetry.retentionDays` — what the TTL should be. */
  retentionDays: z.number().int(),
  /** Every table in the database, by name. Empty when unreachable. */
  tables: z.array(telemetryTableSchema),
  /** Why `reachable` is false, or a partial failure (the TTL or table list could not be read). */
  error: z.string().nullable(),
});

/**
 * `GET /api/admin/telemetry/status`.
 *
 * @stability stable
 */
export type TelemetryStatus = z.infer<typeof telemetryStatusSchema>;

/**
 * The database-level TTL in force.
 *
 * @stability stable
 */
export type TelemetryTtl = z.infer<typeof telemetryTtlSchema>;

/**
 * One table of the telemetry database.
 *
 * @stability stable
 */
export type TelemetryTable = z.infer<typeof telemetryTableSchema>;
