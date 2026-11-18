// =============================================================================
// /api/admin/telemetry/store (PP-14.11)
// =============================================================================
//
// The settings of the telemetry store a deployment selected with
// `TelemetryModule.forRoot({ store })`, for a store that is not the built-in
// GreptimeDB (whose connection form is `/api/admin/telemetry/connection`).
//
// Each registered store brings its own settings schema and secrets, so the
// shape of `settings` is described by `descriptor` (the pluggable-kind
// descriptor a generated form renders) and not fixed here. SECRETS ARE
// WRITE-ONLY: they appear in the request body and in no response; the
// descriptor carries only whether each one is stored (`hasValue`).
// =============================================================================

import { z } from 'zod';

import { pluggableDescriptorSchema } from '../settings/index.js';

/**
 * One registered telemetry store.
 *
 * @extensionPoint schema
 * @stability experimental
 */
export const telemetryStoreSummarySchema = z.object({
  /** The store id (`greptime`); permanent once settings or secrets are stored under it. */
  id: z.string(),
  /** The human label. */
  label: z.string(),
  /** One sentence on what the store is, when it has one. */
  description: z.string().optional(),
});

/**
 * `GET /api/admin/telemetry/store` (and the `PUT` response): the active store,
 * the registered ones, and, for a store with a generated form, its descriptor
 * and current settings.
 *
 * @extensionPoint schema
 * @stability experimental
 */
export const telemetryStoreResponseSchema = z.object({
  /** The store this deployment uses. */
  active: telemetryStoreSummarySchema,
  /** Every registered store, in registration order. */
  stores: z.array(telemetryStoreSummarySchema),
  /**
   * The active store's generated form (its non-secret fields, then one
   * write-only `secret` field per declared secret), or `null` for the built-in
   * GreptimeDB, whose form is `/api/admin/telemetry/connection`.
   */
  descriptor: pluggableDescriptorSchema.nullable(),
  /** The active store's settings in force (defaults filled). Never a secret. `{}` for the built-in store. */
  settings: z.record(z.string(), z.unknown()),
  /** Whether the store is built and configured, so telemetry can be queried. */
  ready: z.boolean(),
  /** Why the store could not be built (its stored settings do not parse, `build` threw), or `null`. No secret material. */
  error: z.string().nullable(),
  /** The `telemetry_store` settings row version — send it back as `If-Match` on `PUT`. `0` when nothing is stored yet. */
  version: z.number().int(),
  /** When the settings were last saved, or `null` when nothing is stored yet. */
  updatedAt: z.iso.datetime().nullable(),
});

/**
 * `PUT /api/admin/telemetry/store` body: a patch of the active store's
 * settings and secrets.
 *
 * @extensionPoint schema
 * @stability experimental
 */
export const updateTelemetryStoreSchema = z.object({
  /**
   * Fields of the store's settings to change; merged over the stored ones and
   * validated with the store's own schema. Absent keeps them.
   */
  settings: z.record(z.string(), z.unknown()).optional(),
  /**
   * Secrets to store, by the names the store declares. A string stores it
   * (encrypted); `null` or `''` removes it; an absent name keeps the stored one.
   */
  secrets: z.record(z.string(), z.string().nullable()).optional(),
});

/**
 * One registered telemetry store.
 *
 * @stability experimental
 */
export type TelemetryStoreSummary = z.infer<typeof telemetryStoreSummarySchema>;

/**
 * `GET /api/admin/telemetry/store`.
 *
 * @stability experimental
 */
export type TelemetryStoreResponse = z.infer<typeof telemetryStoreResponseSchema>;

/**
 * The `PUT /api/admin/telemetry/store` body.
 *
 * @stability experimental
 */
export type UpdateTelemetryStoreInput = z.infer<typeof updateTelemetryStoreSchema>;
