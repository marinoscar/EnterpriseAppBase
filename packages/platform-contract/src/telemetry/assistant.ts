// =============================================================================
// POST /api/admin/telemetry/assistant/stream (issue #536; moved here from the
// API's `telemetry/dto/telemetry-assistant.dto.ts` by #702)
// =============================================================================
//
// The request body is a zod schema. The response is a `text/event-stream`;
// its frame payloads are the binding web ↔ API contract and are TYPES (the
// API writes them, nothing parses them on the server), as they always were.
// =============================================================================

import { z } from 'zod';

import {
  TELEMETRY_ASSISTANT_HISTORY_CONTENT_MAX,
  TELEMETRY_ASSISTANT_HISTORY_MAX_TURNS,
  TELEMETRY_ASSISTANT_QUESTION_MAX,
  TELEMETRY_ASSISTANT_TURN_ROLES,
  type TelemetryAssistantConfidence,
  type TelemetryAssistantReportStatus,
  type TelemetryAssistantSeverity,
  type TelemetryAssistantToolName,
} from './constants.js';

/**
 * One earlier turn of the conversation: `role` (`user` or `assistant`) and
 * `content` (at most {@link TELEMETRY_ASSISTANT_HISTORY_CONTENT_MAX} characters).
 *
 * @extensionPoint schema
 * @stability stable
 */
export const telemetryAssistantTurnSchema = z.object({
  role: z.enum(TELEMETRY_ASSISTANT_TURN_ROLES),
  content: z.string().max(TELEMETRY_ASSISTANT_HISTORY_CONTENT_MAX),
});

/**
 * One earlier turn of the conversation.
 *
 * @stability stable
 */
export type TelemetryAssistantTurn = z.infer<typeof telemetryAssistantTurnSchema>;

/**
 * `POST /api/admin/telemetry/assistant/stream` body: `question` (trimmed,
 * 1..{@link TELEMETRY_ASSISTANT_QUESTION_MAX} characters) and an optional
 * `history` (oldest first, at most {@link TELEMETRY_ASSISTANT_HISTORY_MAX_TURNS}).
 *
 * @extensionPoint schema
 * @stability stable
 */
export const telemetryAssistantRequestSchema = z.object({
  /** The new question, in natural language. */
  question: z.string().trim().min(1).max(TELEMETRY_ASSISTANT_QUESTION_MAX),
  /** Earlier turns of this conversation, oldest first. */
  history: z.array(telemetryAssistantTurnSchema).max(TELEMETRY_ASSISTANT_HISTORY_MAX_TURNS).optional(),
});

/**
 * The `POST /api/admin/telemetry/assistant/stream` body.
 *
 * @stability stable
 */
export type TelemetryAssistantRequest = z.infer<typeof telemetryAssistantRequestSchema>;

/**
 * `event: step` — one tool call the assistant made.
 *
 * @stability stable
 */
export interface TelemetryAssistantStepEvent {
  /** 0-based, across the whole turn. */
  index: number;
  /** The tool called. */
  tool: TelemetryAssistantToolName;
  /** `group` is `metrics_overview`'s metric group (#603). */
  input?: { table?: string; sql?: string; window?: string; traceId?: string; group?: string };
  /** `run_query` / `get_trace` only: rows the call returned (up to the row cap). */
  rowCount?: number;
  /** `run_query` / `get_trace` only: more rows matched than the row cap allowed. */
  truncated?: boolean;
  /** Wall time of the call. */
  durationMs: number;
  /** Why the call failed; the model was told the same and may retry. */
  error?: string;
  /** The model's interim reasoning for the round this call belongs to; only on the FIRST call of a round. Bounded to 1000 chars. */
  thought?: string;
}

/**
 * One finding of a report.
 *
 * @stability stable
 */
export interface TelemetryAssistantFinding {
  /** One line naming the finding. */
  title: string;
  /** How bad it is. */
  severity: TelemetryAssistantSeverity;
  /** What in the data shows it. */
  evidence: string;
  /** Index into `report.queries` of the query that shows this finding. */
  queryIndex?: number;
}

/**
 * A supporting query of a report, which the user can re-run.
 *
 * @stability stable
 */
export interface TelemetryAssistantQuery {
  /** What the query shows. */
  title: string;
  /** The statement. */
  sql: string;
}

/**
 * The investigation's structured result.
 *
 * @stability stable
 */
export interface TelemetryAssistantReport {
  /** The outcome. */
  status: TelemetryAssistantReportStatus;
  /** A short summary. */
  summary: string;
  /** What was found, most important first. */
  findings: TelemetryAssistantFinding[];
  /** The root cause, or null when none was established. */
  rootCause: string | null;
  /** How sure the report is. */
  confidence: TelemetryAssistantConfidence;
  /** What to do next. */
  recommendations: string[];
  /** Supporting queries the user can re-run (at most 5); the first is the most useful. */
  queries: TelemetryAssistantQuery[];
}

/**
 * `event: answer` — the final answer.
 *
 * @stability stable
 */
export interface TelemetryAssistantAnswerEvent {
  /** Back-compat: queries[0].sql, or null. */
  sql: string | null;
  /** Back-compat: the report summary (or the raw text when the model did not return a report). */
  explanation: string;
  /** The structured report, or null when the model gave no parseable one. */
  report: TelemetryAssistantReport | null;
}

/**
 * `event: error` — the turn failed after the stream opened.
 *
 * @stability stable
 */
export interface TelemetryAssistantErrorEvent {
  /** A stable error code. */
  code: string;
  /** A message for the user. */
  message: string;
}

/**
 * Every event of the stream, by name, with its payload.
 *
 * @stability stable
 */
export interface TelemetryAssistantEventMap {
  /** One tool call. */
  step: TelemetryAssistantStepEvent;
  /** The final answer. */
  answer: TelemetryAssistantAnswerEvent;
  /** The turn failed. */
  error: TelemetryAssistantErrorEvent;
  /** The stream ends. */
  done: Record<string, never>;
}

/**
 * The name of a stream event.
 *
 * @stability stable
 */
export type TelemetryAssistantEventName = keyof TelemetryAssistantEventMap;

/**
 * A function that writes one stream event (the server's side of the stream).
 *
 * @stability stable
 */
export type TelemetryAssistantEmit = <E extends TelemetryAssistantEventName>(
  event: E,
  data: TelemetryAssistantEventMap[E],
) => void;
