// =============================================================================
// /api/admin/telemetry/config and /api/telemetry/config (issue #534; moved
// here from the API's `telemetry/dto/telemetry-config.dto.ts` by #702)
// =============================================================================
//
// The PUT body IS the stored `telemetry` namespace, so a form can send back
// exactly what it loaded (minus the provenance fields the response adds).
// Full replace: `assistant.provider` / `assistant.modelId` sent as `null`
// clear a stored value.
//
// ONE EXCEPTION TO "FULL": `instanceId` (#565) is OPTIONAL in the PUT body.
// Absent keeps the stored value, `null` returns to the application-slug
// default, a string overrides it. A client written before it existed must not
// get a 400, nor silently reset an identity an administrator set, merely by
// saving the page. The response always carries it, plus `instanceIdDefault` /
// `instanceIdEffective` so a form can show what `null` currently means.
//
// No credential is part of any of these shapes and none may be added.
// =============================================================================

import { z } from 'zod';

import { telemetrySettingsSchema } from './settings.js';

/**
 * `PUT /api/admin/telemetry/config` body: the stored namespace, with
 * `instanceId` optional (absent keeps the stored value).
 *
 * @extensionPoint schema
 * @stability stable
 */
export const updateTelemetryConfigSchema = telemetrySettingsSchema.extend({
  /** Optional here: absent keeps the stored value, `null` returns to the default, a string overrides it. */
  instanceId: telemetrySettingsSchema.shape.instanceId.optional(),
});

/**
 * The `PUT /api/admin/telemetry/config` body.
 *
 * @stability stable
 */
export type UpdateTelemetryConfigInput = z.infer<typeof updateTelemetryConfigSchema>;

/**
 * `GET /api/admin/telemetry/config` (and the `PUT` response): the stored
 * namespace plus `available`, `retentionApplicable`, `instanceIdDefault`,
 * `instanceIdEffective`, `version` (send it back as `If-Match`), `updatedAt`
 * and `updatedBy`.
 *
 * @extensionPoint schema
 * @stability stable
 */
export const telemetryConfigResponseSchema = telemetrySettingsSchema.extend({
  /**
   * Whether a telemetry store is configured (admin UI or deployment default):
   * a host and the reader login with its password. While false, `enabled` is
   * stored but nothing is exported or queryable.
   */
  available: z.boolean(),
  /**
   * Whether the GreptimeDB admin login is configured (admin UI or deployment
   * default), which retention needs. While false, `retentionDays` is stored
   * but not applied.
   */
  retentionApplicable: z.boolean(),
  /**
   * What a `null` `instanceId` resolves to: the application slug (`APP_SLUG`,
   * derived from the product name). Read-only.
   */
  instanceIdDefault: z.string(),
  /**
   * The identifier currently stamped as the `app.instance.id` resource
   * attribute on exported telemetry: `instanceId` when set, else
   * `instanceIdDefault`. Read-only.
   */
  instanceIdEffective: z.string(),
  /** The system-settings row version — send it back as `If-Match` on `PUT`. `0` when nothing is stored yet. */
  version: z.number().int(),
  /** When the namespace was last saved, or `null` when nothing is stored yet. */
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
 * `GET /api/admin/telemetry/config`.
 *
 * @stability stable
 */
export type TelemetryConfigResponse = z.infer<typeof telemetryConfigResponseSchema>;

/**
 * `GET /api/telemetry/config`: the feature flag every signed-in client reads
 * (`available`, `enabled`, `assistantEnabled`).
 *
 * @extensionPoint schema
 * @stability stable
 */
export const telemetryPublicConfigSchema = z.object({
  /** A telemetry store is configured (admin UI or deployment default). False hides every telemetry surface. */
  available: z.boolean(),
  /** `telemetry.enabled` — whether this deployment is currently collecting telemetry. */
  enabled: z.boolean(),
  /**
   * `telemetry.assistant.enabled` — whether the telemetry AI assistant is
   * switched on. Whether the AI platform itself is on is `GET /api/ai/config`.
   */
  assistantEnabled: z.boolean(),
});

/**
 * `GET /api/telemetry/config`.
 *
 * @stability stable
 */
export type TelemetryPublicConfig = z.infer<typeof telemetryPublicConfigSchema>;
