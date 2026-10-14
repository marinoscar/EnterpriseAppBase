import { createZodDto } from 'nestjs-zod';

import { telemetryStatusSchema, telemetryTableSchema, telemetryTtlSchema } from '@marinoscar/platform-contract/telemetry';

// =============================================================================
// GET /api/admin/telemetry/status — response (issue #534, epic #528)
// =============================================================================
//
// The schemas live in `@marinoscar/platform-contract/telemetry` (#702); this
// file wraps them as nestjs-zod DTOs and re-exports the names services import.
// A diagnosis, never an error: an unconfigured or unreachable store is
// reported in the fields with a 200.
// =============================================================================

export { telemetryStatusSchema, telemetryTableSchema, telemetryTtlSchema };
export type { TelemetryStatus, TelemetryTtl } from '@marinoscar/platform-contract/telemetry';

export class TelemetryStatusDto extends createZodDto(telemetryStatusSchema) {}
