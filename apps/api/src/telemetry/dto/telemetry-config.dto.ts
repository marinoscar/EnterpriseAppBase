import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { systemTelemetrySchema } from '../../common/schemas/settings.schema';

// =============================================================================
// /api/admin/telemetry/config and /api/telemetry/config — wire shapes
// (issue #534, epic #528)
// =============================================================================
//
// The PUT body IS the stored `telemetry` namespace (`systemTelemetrySchema`),
// so a form can send back exactly what it loaded (minus the provenance fields
// the response adds). Full replace: `assistant.provider` / `assistant.modelId`
// sent as `null` clear a stored value.
//
// No credential is part of any of these shapes and none may be added — the
// namespace carries a compile-time proof of that (`settings.schema.ts`), and
// the GreptimeDB connection is deployment configuration, never a setting.
// =============================================================================

export const updateTelemetryConfigSchema = systemTelemetrySchema;

export class UpdateTelemetryConfigDto extends createZodDto(updateTelemetryConfigSchema) {}
export type UpdateTelemetryConfigInput = z.infer<typeof updateTelemetryConfigSchema>;

export const telemetryConfigResponseSchema = systemTelemetrySchema.extend({
  /**
   * Whether this deployment has a telemetry store at all (`GREPTIME_HOST` and
   * the reader credential are set). Deployment configuration, not a setting:
   * while false, `enabled` is stored but nothing is exported or queryable.
   */
  available: z.boolean(),
  /**
   * Whether the GreptimeDB admin credential is set, which retention needs.
   * While false, `retentionDays` is stored but not applied.
   */
  retentionApplicable: z.boolean(),
  /** The system-settings row version — send it back as `If-Match` on `PUT`. `0` when nothing is stored yet. */
  version: z.number().int(),
  updatedAt: z.iso.datetime().nullable(),
  updatedBy: z.object({ id: z.string(), email: z.string() }).nullable(),
});

export class TelemetryConfigResponseDto extends createZodDto(telemetryConfigResponseSchema) {}
export type TelemetryConfigResponse = z.infer<typeof telemetryConfigResponseSchema>;

/** `GET /api/telemetry/config` — the feature flag every signed-in client reads. */
export const telemetryPublicConfigSchema = z.object({
  /** A telemetry store is deployed (GreptimeDB is configured). False hides every telemetry surface. */
  available: z.boolean(),
  /** `telemetry.enabled` — whether this deployment is currently collecting telemetry. */
  enabled: z.boolean(),
  /**
   * `telemetry.assistant.enabled` — whether the telemetry AI assistant is
   * switched on. Whether the AI platform itself is on is `GET /api/ai/config`.
   */
  assistantEnabled: z.boolean(),
});

export class TelemetryPublicConfigDto extends createZodDto(telemetryPublicConfigSchema) {}
export type TelemetryPublicConfig = z.infer<typeof telemetryPublicConfigSchema>;
