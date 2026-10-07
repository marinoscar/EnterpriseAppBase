import { createZodDto } from 'nestjs-zod';

import {
  telemetryConfigResponseSchema,
  telemetryPublicConfigSchema,
  updateTelemetryConfigSchema,
} from '@marinoscar/platform-contract/telemetry';

// =============================================================================
// /api/admin/telemetry/config and /api/telemetry/config — wire shapes
// (issue #534, epic #528)
// =============================================================================
//
// The schemas live in `@marinoscar/platform-contract/telemetry` (#702), shared
// with the web app; this file only wraps them as nestjs-zod DTOs (so the
// OpenAPI document is generated from them) and re-exports the names every
// service already imports. The PUT body IS the stored `telemetry` namespace,
// with `instanceId` optional; no credential is part of any of these shapes.
// =============================================================================

export { telemetryConfigResponseSchema, telemetryPublicConfigSchema, updateTelemetryConfigSchema };
export type {
  TelemetryConfigResponse,
  TelemetryPublicConfig,
  UpdateTelemetryConfigInput,
} from '@marinoscar/platform-contract/telemetry';

export class UpdateTelemetryConfigDto extends createZodDto(updateTelemetryConfigSchema) {}
export class TelemetryConfigResponseDto extends createZodDto(telemetryConfigResponseSchema) {}
export class TelemetryPublicConfigDto extends createZodDto(telemetryPublicConfigSchema) {}
