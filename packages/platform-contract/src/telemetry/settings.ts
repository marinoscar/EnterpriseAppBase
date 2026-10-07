// =============================================================================
// The `telemetry` system-settings namespace (issue #702; declared by #533 and
// #565 in the API's `common/schemas/settings.schema.ts`, moved here verbatim)
// =============================================================================
//
// The stored namespace is also the body of `PUT /api/admin/telemetry/config`,
// so it is a wire shape: the admin form sends back what it loaded.
//
// NO API KEY OR CREDENTIAL IS PART OF THIS NAMESPACE, and none may be added:
// `TelemetrySettingsCarriesNoSecret` below stops compiling if one is. The AI
// assistant's provider key is resolved per call on the server, and the
// GreptimeDB passwords live in the encrypted credential store.
// =============================================================================

import { z } from 'zod';

import { TELEMETRY_INSTANCE_ID_PATTERN, TELEMETRY_LIMITS } from './constants.js';

const { retentionDays, maxRows, timeoutSeconds, maxResultRowsToModel, maxSteps } = TELEMETRY_LIMITS;

/**
 * `telemetry.instanceId` when set: the label stamped as the OTel resource
 * attribute `app.instance.id`, matching {@link TELEMETRY_INSTANCE_ID_PATTERN}.
 *
 * @extensionPoint schema
 * @stability stable
 */
export const telemetryInstanceIdSchema = z
  .string()
  .regex(
    TELEMETRY_INSTANCE_ID_PATTERN,
    'instanceId must be 1-63 characters: lowercase letters, digits, ".", "_" or "-", starting with a letter or digit',
  );

/**
 * The stored `telemetry` namespace: `enabled` (collect at all; off by
 * default), `retentionDays`, `instanceId` (`null` follows the application
 * slug), `query` (`maxRows`, `timeoutSeconds`) and `assistant` (`enabled`,
 * `provider`, `modelId`, `shareResults`, `maxResultRowsToModel`, `maxSteps`).
 * Every bound is a {@link TELEMETRY_LIMITS} entry.
 *
 * @extensionPoint schema
 * @stability stable
 */
export const telemetrySettingsSchema = z.object({
  /** Whether this deployment collects telemetry at all. Off by default. */
  enabled: z.boolean(),
  /** How many days telemetry is kept (the database TTL). */
  retentionDays: z.number().int().min(retentionDays.min).max(retentionDays.max),
  /** The `app.instance.id` label stamped on exported telemetry; `null` follows the application slug. */
  instanceId: telemetryInstanceIdSchema.nullable(),
  /** Bounds of one ad-hoc explorer query. */
  query: z.object({
    /** Most rows one query may return. */
    maxRows: z.number().int().min(maxRows.min).max(maxRows.max),
    /** Longest one query may run, in seconds. */
    timeoutSeconds: z.number().int().min(timeoutSeconds.min).max(timeoutSeconds.max),
  }),
  /** The telemetry AI assistant. */
  assistant: z.object({
    /** Whether the assistant may be used (on top of telemetry and AI being on). */
    enabled: z.boolean(),
    /** The AI provider the assistant uses, or `null` when not configured. */
    provider: z.string().nullable(),
    /** The model the assistant uses, or `null` when not configured. */
    modelId: z.string().nullable(),
    /** Whether the rows a query returns are sent to the model (not only the query and its metadata). */
    shareResults: z.boolean(),
    /** Most result rows handed to the model per call. */
    maxResultRowsToModel: z.number().int().min(maxResultRowsToModel.min).max(maxResultRowsToModel.max),
    /** Most tool-call round trips one assistant turn may take. */
    maxSteps: z.number().int().min(maxSteps.min).max(maxSteps.max),
  }),
});

/**
 * The stored `telemetry` namespace.
 *
 * @stability stable
 */
export type TelemetrySettings = z.infer<typeof telemetrySettingsSchema>;

/**
 * Field names that would mean a secret had been added to the `telemetry`
 * namespace; {@link TelemetrySettingsCarriesNoSecret} refuses each.
 *
 * @stability stable
 */
export type TelemetrySecretFieldNames =
  | 'secretAccessKey'
  | 'secretKey'
  | 'sessionToken'
  | 'secret'
  | 'password'
  | 'apiKey'
  | 'apiKeys'
  | 'key'
  | 'token';

/**
 * Compile-time proof that the `telemetry` namespace carries no secret:
 * `true`, or `never` (and this package stops compiling) once a field such as
 * `apiKey` or `password` is added to {@link telemetrySettingsSchema}.
 *
 * @stability stable
 */
export type TelemetrySettingsCarriesNoSecret =
  Extract<keyof TelemetrySettings, TelemetrySecretFieldNames> extends never ? true : never;

/**
 * The value of {@link TelemetrySettingsCarriesNoSecret}; it only compiles
 * while the proof holds.
 *
 * @stability stable
 */
export const TELEMETRY_SETTINGS_CARRIES_NO_SECRET: TelemetrySettingsCarriesNoSecret = true;
