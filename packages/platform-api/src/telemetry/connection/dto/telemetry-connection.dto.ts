import { createZodDto } from 'nestjs-zod';

import {
  telemetryConnectionResponseSchema,
  telemetryConnectionTestResultSchema,
  testTelemetryConnectionSchema,
  updateTelemetryConnectionSchema,
} from '@marinoscar/platform-contract/telemetry';

// =============================================================================
// /api/admin/telemetry/connection — wire shapes (issue #558, epic #528)
// =============================================================================
//
// The schemas live in `@marinoscar/platform-contract/telemetry` (#702), shared
// with the web app; this file wraps them as nestjs-zod DTOs and re-exports the
// names services import.
//
// Passwords are WRITE-ONLY. They appear in the two request bodies and in no
// response: a response carries a masked `credentials.<login>` status built
// from `CredentialsService.describe`, which cannot decrypt anything — the same
// shape as storage's `secretStatus` and AI's `keyStatus`.
// =============================================================================

export {
  telemetryConnectionProbeSchema,
  telemetryConnectionSkippedSchema,
  telemetryCredentialStatusSchema,
  telemetryDeploymentConnectionSchema,
  TELEMETRY_CONNECTION_SOURCES,
} from '@marinoscar/platform-contract/telemetry';
export {
  telemetryConnectionResponseSchema,
  telemetryConnectionTestResultSchema,
  testTelemetryConnectionSchema,
  updateTelemetryConnectionSchema,
};
export type {
  TelemetryConnectionProbe,
  TelemetryConnectionResponse,
  TelemetryConnectionTestResult,
  TestTelemetryConnectionInput,
  UpdateTelemetryConnectionInput,
} from '@marinoscar/platform-contract/telemetry';

export class UpdateTelemetryConnectionDto extends createZodDto(updateTelemetryConnectionSchema) {}
export class TestTelemetryConnectionDto extends createZodDto(testTelemetryConnectionSchema) {}
export class TelemetryConnectionResponseDto extends createZodDto(telemetryConnectionResponseSchema) {}
export class TelemetryConnectionTestResultDto extends createZodDto(telemetryConnectionTestResultSchema) {}
