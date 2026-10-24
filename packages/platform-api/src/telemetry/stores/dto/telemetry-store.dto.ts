import { createZodDto } from 'nestjs-zod';

import {
  telemetryStoreResponseSchema,
  telemetryStoreSummarySchema,
  updateTelemetryStoreSchema,
} from '@marinoscar/platform-contract/telemetry';

// =============================================================================
// /api/admin/telemetry/store: wire shapes (PP-14.11)
// =============================================================================
//
// The schemas live in `@marinoscar/platform-contract/telemetry`, shared with the
// web app; this file wraps them as nestjs-zod DTOs. Secrets are WRITE-ONLY:
// they appear in the request body and in no response (the descriptor carries
// `hasValue`, never a value).
// =============================================================================

export { telemetryStoreResponseSchema, telemetryStoreSummarySchema, updateTelemetryStoreSchema };
export type {
  TelemetryStoreResponse,
  TelemetryStoreSummary,
  UpdateTelemetryStoreInput,
} from '@marinoscar/platform-contract/telemetry';

export class TelemetryStoreResponseDto extends createZodDto(telemetryStoreResponseSchema) {}
export class UpdateTelemetryStoreDto extends createZodDto(updateTelemetryStoreSchema) {}
