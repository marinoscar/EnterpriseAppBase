/**
 * Normalising every way an AI call can fail into one shape — issue #434,
 * epic #419.
 *
 * An AI failure reaches the browser by one of three roads, and they carry the
 * AI code in three different places:
 *
 * 1. A gated or failed JSON call (`POST /ai/responses`, `POST /ai/runs`, a
 *    pre-stream gate failure on `POST /ai/responses/stream`) throws an
 *    `ApiError`. Its top-level `code` is the GENERIC HTTP code the global
 *    exception filter assigns (`FORBIDDEN`, `BAD_REQUEST`, …); the AI code is
 *    in `details.reason`, with `details.retryAfterMs` beside it for a rate
 *    limit (docs/specs/ai-platform.md §13). Switching on `code` alone never
 *    sees `AI_KEY_REQUIRED`.
 * 2. A failure AFTER a stream started arrives as an `error` SSE frame whose
 *    payload carries `code` directly.
 * 3. A background run that settled `failed` carries `errorCode` on the run.
 *
 * Everything that renders an AI failure (`components/ai/AiErrorAlert.tsx`)
 * takes the {@link AiErrorInfo} this module produces, so the three roads end
 * at one mapping.
 */
import { ApiError } from './api';

export interface AiErrorInfo {
  /** The AI code (`AI_KEY_REQUIRED`, …), or `null` when the failure had none. */
  code: string | null;
  /** The server's (or the browser's) own message — shown under the mapped copy. */
  message: string;
  /** HTTP status, when the failure was an HTTP response. */
  status?: number;
  /** Provider back-off hint on `AI_RATE_LIMITED`, in milliseconds. */
  retryAfterMs?: number;
}

function readDetails(details: unknown): { reason?: string; retryAfterMs?: number } {
  if (!details || typeof details !== 'object') return {};
  const record = details as Record<string, unknown>;
  return {
    reason: typeof record.reason === 'string' ? record.reason : undefined,
    retryAfterMs: typeof record.retryAfterMs === 'number' ? record.retryAfterMs : undefined,
  };
}

/** Any thrown value from an AI call → {@link AiErrorInfo}. */
export function toAiErrorInfo(err: unknown, fallback = 'Something went wrong'): AiErrorInfo {
  if (err instanceof ApiError) {
    const { reason, retryAfterMs } = readDetails(err.details);
    const code = reason ?? (err.code?.startsWith('AI_') ? err.code : null);
    return {
      code,
      message: err.message || fallback,
      status: err.status,
      ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
    };
  }
  if (err instanceof Error) {
    return { code: null, message: err.message || fallback };
  }
  return { code: null, message: fallback };
}
