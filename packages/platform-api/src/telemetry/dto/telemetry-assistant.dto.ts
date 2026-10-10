import { createZodDto } from 'nestjs-zod';

import { telemetryAssistantRequestSchema } from '@marinoscar/platform-contract/telemetry';

// =============================================================================
// POST /api/admin/telemetry/assistant/stream — wire shapes (issue #536, epic #528)
// =============================================================================
//
// The request schema, the limits and the frame payload types live in
// `@marinoscar/platform-contract/telemetry` (#702), the binding web ↔ API
// contract; this file wraps the request as a nestjs-zod DTO and re-exports the
// names services import. The response is a `text/event-stream` (see the
// controller's OpenAPI description).
// =============================================================================

export {
  TELEMETRY_ASSISTANT_CONFIDENCES,
  TELEMETRY_ASSISTANT_HISTORY_CONTENT_MAX,
  TELEMETRY_ASSISTANT_HISTORY_MAX_TURNS,
  TELEMETRY_ASSISTANT_QUESTION_MAX,
  TELEMETRY_ASSISTANT_REPORT_STATUSES,
  TELEMETRY_ASSISTANT_SEVERITIES,
  TELEMETRY_ASSISTANT_TOOLS,
  telemetryAssistantTurnSchema,
} from '@marinoscar/platform-contract/telemetry';
export { telemetryAssistantRequestSchema };
export type {
  TelemetryAssistantAnswerEvent,
  TelemetryAssistantConfidence,
  TelemetryAssistantEmit,
  TelemetryAssistantErrorEvent,
  TelemetryAssistantEventMap,
  TelemetryAssistantEventName,
  TelemetryAssistantFinding,
  TelemetryAssistantQuery,
  TelemetryAssistantReport,
  TelemetryAssistantReportStatus,
  TelemetryAssistantRequest,
  TelemetryAssistantSeverity,
  TelemetryAssistantStepEvent,
  TelemetryAssistantToolName,
  TelemetryAssistantTurn,
} from '@marinoscar/platform-contract/telemetry';

export class TelemetryAssistantRequestDto extends createZodDto(telemetryAssistantRequestSchema) {}
