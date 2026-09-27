import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// =============================================================================
// POST /api/admin/telemetry/assistant/stream — wire shapes (issue #536, epic #528)
// =============================================================================
//
// The request body is validated by the global `ZodValidationPipe`. The
// response is a `text/event-stream`; the frame payloads below are the
// binding web ↔ API contract (see the controller's OpenAPI description).
// =============================================================================

export const TELEMETRY_ASSISTANT_QUESTION_MAX = 4_000;
export const TELEMETRY_ASSISTANT_HISTORY_MAX_TURNS = 20;
export const TELEMETRY_ASSISTANT_HISTORY_CONTENT_MAX = 8_000;

export const telemetryAssistantTurnSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().max(TELEMETRY_ASSISTANT_HISTORY_CONTENT_MAX),
});

export const telemetryAssistantRequestSchema = z.object({
  /** The new question, in natural language. */
  question: z.string().trim().min(1).max(TELEMETRY_ASSISTANT_QUESTION_MAX),
  /** Earlier turns of this conversation, oldest first. */
  history: z.array(telemetryAssistantTurnSchema).max(TELEMETRY_ASSISTANT_HISTORY_MAX_TURNS).optional(),
});

export class TelemetryAssistantRequestDto extends createZodDto(telemetryAssistantRequestSchema) {}
export type TelemetryAssistantRequest = z.infer<typeof telemetryAssistantRequestSchema>;
export type TelemetryAssistantTurn = z.infer<typeof telemetryAssistantTurnSchema>;

export const TELEMETRY_ASSISTANT_TOOLS = ['list_tables', 'describe_table', 'run_query'] as const;
export type TelemetryAssistantToolName = (typeof TELEMETRY_ASSISTANT_TOOLS)[number];

/** `event: step` — one tool call the assistant made. */
export interface TelemetryAssistantStepEvent {
  /** 0-based, across the whole turn. */
  index: number;
  tool: TelemetryAssistantToolName;
  input?: { table?: string; sql?: string };
  /** `run_query` only: rows the query returned (up to the row cap). */
  rowCount?: number;
  /** `run_query` only: more rows matched than the row cap allowed. */
  truncated?: boolean;
  durationMs: number;
  /** Why the call failed; the model was told the same and may retry. */
  error?: string;
}

/** `event: answer` — the final answer. */
export interface TelemetryAssistantAnswerEvent {
  sql: string | null;
  explanation: string;
}

/** `event: error` — the turn failed after the stream opened. */
export interface TelemetryAssistantErrorEvent {
  code: string;
  message: string;
}

export interface TelemetryAssistantEventMap {
  step: TelemetryAssistantStepEvent;
  answer: TelemetryAssistantAnswerEvent;
  error: TelemetryAssistantErrorEvent;
  done: Record<string, never>;
}

export type TelemetryAssistantEventName = keyof TelemetryAssistantEventMap;

export type TelemetryAssistantEmit = <E extends TelemetryAssistantEventName>(
  event: E,
  data: TelemetryAssistantEventMap[E],
) => void;
