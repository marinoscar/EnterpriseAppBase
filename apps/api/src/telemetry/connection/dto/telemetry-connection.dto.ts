import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import {
  telemetryDatabaseSchema,
  telemetryHostSchema,
  telemetryPgPortSchema,
  telemetryUserSchema,
} from '../telemetry-connection.schema';

// =============================================================================
// /api/admin/telemetry/connection — wire shapes (issue #558, epic #528)
// =============================================================================
//
// Passwords are WRITE-ONLY. They appear in the two request bodies and in no
// response: a response carries a masked `credentials.<login>` status built
// from `CredentialsService.describe`, which cannot decrypt anything — the same
// shape as storage's `secretStatus` and AI's `keyStatus`.
// =============================================================================

/** A password as submitted. Not trimmed: a secret is stored byte for byte. */
const passwordSchema = z.string().max(1024);

/**
 * `adminUser` — null (or an empty string) means "no admin login", which
 * removes a stored admin password.
 */
const adminUserSchema = z
  .string()
  .trim()
  .max(128)
  .nullable()
  .transform((value) => (value ? value : null));

export const updateTelemetryConnectionSchema = z.object({
  /** Hostname or IP address of GreptimeDB's Postgres-wire endpoint. No scheme, port or path. */
  host: telemetryHostSchema,
  /** GreptimeDB's Postgres-wire port (4003 by default). */
  pgPort: telemetryPgPortSchema,
  /** The database telemetry is written to. A plain identifier (`public` by default). */
  database: telemetryDatabaseSchema,
  /** The `readonly` GreptimeDB user the explorer, assistant and status page use. */
  readerUser: telemetryUserSchema,
  /**
   * Write-only. Omit or send empty to KEEP the stored reader password; a
   * save with none stored and none sent is a 400.
   */
  readerPassword: passwordSchema.optional(),
  /** The DDL-capable user retention needs, or null for none (retention is then not applied). */
  adminUser: adminUserSchema,
  /**
   * Write-only. Omit or send empty to KEEP the stored admin password. Ignored
   * when `adminUser` is null (the stored one is then deleted).
   */
  adminPassword: passwordSchema.optional(),
});

export class UpdateTelemetryConnectionDto extends createZodDto(updateTelemetryConnectionSchema) {}
export type UpdateTelemetryConnectionInput = z.output<typeof updateTelemetryConnectionSchema>;

/**
 * `POST …/connection/test` — a CANDIDATE connection, not necessarily saved.
 * A blank password means "the password the connection in force uses for that
 * login" (the stored one, or the environment's while the deployment default
 * is in force).
 */
export const testTelemetryConnectionSchema = updateTelemetryConnectionSchema;

export class TestTelemetryConnectionDto extends createZodDto(testTelemetryConnectionSchema) {}
export type TestTelemetryConnectionInput = z.output<typeof testTelemetryConnectionSchema>;

/** Masked, non-secret facts about one stored password. Mirrors storage's `secretStatus`. */
export const telemetryCredentialStatusSchema = z.object({
  /** Whether a password is present for this login in the connection's source. */
  configured: z.boolean(),
  /**
   * The credential store's mask (`••••Xk9q`) so an admin can tell two
   * passwords apart. Never the password. Always null for the deployment
   * default: the environment's value is not the store's to describe.
   */
  hint: z.string().nullable(),
  updatedAt: z.iso.datetime().nullable(),
  updatedByUserId: z.string().nullable(),
});

export const TELEMETRY_CONNECTION_SOURCES = ['stored', 'environment', 'none'] as const;

export const telemetryConnectionResponseSchema = z.object({
  /**
   * Where the connection in force comes from: `stored` (saved on this page),
   * `environment` (the `GREPTIME_*` deployment default) or `none`.
   */
  source: z.enum(TELEMETRY_CONNECTION_SOURCES),
  /** Empty when `source` is `none`. */
  host: z.string(),
  pgPort: z.number().int(),
  database: z.string(),
  /** Empty when `source` is `none`. */
  readerUser: z.string(),
  adminUser: z.string().nullable(),
  /** A host, a reader login and its password: telemetry can be read. */
  configured: z.boolean(),
  /** The admin login is usable as well, so retention can be applied. */
  adminConfigured: z.boolean(),
  credentials: z.object({
    reader: telemetryCredentialStatusSchema,
    admin: telemetryCredentialStatusSchema,
  }),
  /** The stored connection's version — send it back as `If-Match`. `0` when nothing is stored. */
  version: z.number().int(),
  updatedAt: z.iso.datetime().nullable(),
  updatedBy: z.object({ id: z.string(), email: z.string() }).nullable(),
});

export class TelemetryConnectionResponseDto extends createZodDto(telemetryConnectionResponseSchema) {}
export type TelemetryConnectionResponse = z.infer<typeof telemetryConnectionResponseSchema>;

export const telemetryConnectionProbeSchema = z.object({
  success: z.boolean(),
  /** Wall-clock time of the connect + statement, in milliseconds. */
  latencyMs: z.number().int(),
  /** `SELECT version()` — reader check only. */
  version: z.string().optional(),
  /** The driver's or server's message. Never a password or connection string. */
  error: z.string().optional(),
});

export const telemetryConnectionSkippedSchema = z.object({
  /** No admin user in the candidate, so the admin login was not checked. */
  skipped: z.literal(true),
});

export const telemetryConnectionTestResultSchema = z.object({
  /** `SELECT version()` as the reader. */
  reader: telemetryConnectionProbeSchema,
  /** `SHOW CREATE DATABASE <database>` as the admin, or skipped. */
  admin: z.union([telemetryConnectionProbeSchema, telemetryConnectionSkippedSchema]),
});

export class TelemetryConnectionTestResultDto extends createZodDto(telemetryConnectionTestResultSchema) {}
export type TelemetryConnectionProbe = z.infer<typeof telemetryConnectionProbeSchema>;
export type TelemetryConnectionTestResult = z.infer<typeof telemetryConnectionTestResultSchema>;
