import { createZodDto } from 'nestjs-zod';

import { telemetryStackDeployStartedSchema, telemetryStackStatusSchema } from '@marinoscar/platform-contract/telemetry';

// =============================================================================
// /api/admin/telemetry/stack — responses (issue #567, epic #528)
// =============================================================================
//
// The schemas live in `@marinoscar/platform-contract/telemetry` (#702); this
// file wraps them as nestjs-zod DTOs and re-exports the names services import.
// A diagnosis, never an error: a deployment without a stack-agent is
// `agent: 'not_configured'` with a 200.
// =============================================================================

export {
  TELEMETRY_STACK_AGENT_STATES,
  telemetryStackDeploySchema,
  telemetryStackServiceSchema,
} from '@marinoscar/platform-contract/telemetry';
export { telemetryStackDeployStartedSchema, telemetryStackStatusSchema };
export type {
  TelemetryStackAgentState,
  TelemetryStackDeploy,
  TelemetryStackStatus,
} from '@marinoscar/platform-contract/telemetry';

export class TelemetryStackStatusDto extends createZodDto(telemetryStackStatusSchema) {}
export class TelemetryStackDeployStartedDto extends createZodDto(telemetryStackDeployStartedSchema) {}
