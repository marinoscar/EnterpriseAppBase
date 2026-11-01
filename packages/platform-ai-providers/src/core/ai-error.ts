// =============================================================================
// AI error taxonomy (issue #424, epic #419)
// =============================================================================
//
// Every failure an AI caller can see is one of these codes. Adapters map their
// SDK's errors onto them (an SDK error never escapes an adapter), and the
// runtime gates (#431) raise them directly.
//
// The HTTP status is part of the code's definition rather than a choice made
// at each throw site, so the same condition cannot surface as a 400 from one
// endpoint and a 403 from another.
// =============================================================================

/**
 * The registered symbol the platform job queue's `classifyRateLimit` reads
 * (`CLASSIFY_RATE_LIMIT` in `@marinoscar/platform-api/jobs`). `Symbol.for`
 * returns the SAME symbol in every module instance, so this package
 * implements the queue's self-classification contract without importing it.
 *
 * @stability experimental
 */
export const AI_CLASSIFY_RATE_LIMIT: unique symbol = Symbol.for('jobs.classifyRateLimit');

/**
 * What an error's {@link AI_CLASSIFY_RATE_LIMIT} method answers: the same
 * shape as the job queue's `RateLimitClassification`.
 *
 * @stability experimental
 */
export interface AiRateLimitClassification {
  /** Whether this error means "back off", as opposed to "this is broken". */
  rateLimited: boolean;
  /** The provider's requested delay in milliseconds, or `null` for no opinion. */
  retryAfterMs: number | null;
}

/**
 * Every AI error code and the HTTP status it answers with. The codes are
 * permanent API strings: clients switch on `details.reason`.
 *
 * @stability experimental
 */
export const AI_ERROR_STATUS = {
  /** AI is switched off (for the deployment, or for the caller's organization). */
  AI_DISABLED: 403,
  /** The provider is switched off, or not registered. */
  AI_PROVIDER_DISABLED: 403,
  /** No key may pay for this call (the policy needs the caller's own key). */
  AI_KEY_REQUIRED: 403,
  /** The provider rejected the key. */
  AI_KEY_INVALID: 400,
  /** An administrator has not enabled the model. */
  AI_MODEL_NOT_ENABLED: 403,
  /** The key that would pay cannot reach the model. */
  AI_MODEL_NOT_REACHABLE: 403,
  /** The request needs a capability the model or provider lacks. */
  AI_CAPABILITY_UNSUPPORTED: 400,
  /** A hosted tool type an administrator has not switched on, or an MCP host outside the allowlist (#442). */
  AI_TOOL_DISABLED: 403,
  /** Realtime voice sessions are switched off (`ai.defaults.allowRealtime`, #449). */
  AI_REALTIME_DISABLED: 403,
  /** A deployment limit, or the provider's own rate limit, refused the call. */
  AI_RATE_LIMITED: 429,
  /** The provider failed or could not be reached. */
  AI_PROVIDER_UNAVAILABLE: 503,
  /** The provider's content filter refused the request or the output. */
  AI_CONTENT_FILTERED: 422,
  /** The request itself is malformed. */
  AI_INVALID_REQUEST: 400,
  /** The model's output did not match the requested schema. */
  AI_STRUCTURED_OUTPUT_INVALID: 502,
  /** Object storage is not configured (or not usable) for this operation. */
  // Object storage is not configured (or not usable) for an operation whose
  // inputs or outputs are storage objects — image generation (#437) and the
  // media stories after it. An administrator fixes it at
  // `/admin/settings/storage`; the request itself was fine.
  AI_STORAGE_UNAVAILABLE: 503,
} as const;

/**
 * One AI error code (a key of {@link AI_ERROR_STATUS}).
 *
 * @stability experimental
 */
export type AiErrorCode = keyof typeof AI_ERROR_STATUS;

/**
 * Every code, in declaration order.
 *
 * @stability experimental
 */
export const AI_ERROR_CODES = Object.keys(AI_ERROR_STATUS) as AiErrorCode[];

/**
 * Type guard for a string that arrived from somewhere untyped.
 *
 * @stability experimental
 */
export function isAiErrorCode(value: unknown): value is AiErrorCode {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(AI_ERROR_STATUS, value);
}

// =============================================================================
// AiError
// =============================================================================
//
// WIRE SHAPE. The thrown body is `{ code, message, details: { reason, ... } }`
// and the global `HttpExceptionFilter` turns it into the standard envelope
// `{ statusCode, code, message, details, timestamp, path }`. The envelope's
// top-level `code` is ALWAYS status-derived (`FORBIDDEN`, `TOO_MANY_REQUESTS`,
// ...) — that is a published, closed enum (see `ErrorDto` in `@marinoscar/platform-api/core` and
// the filter's own comment) — so the AI-specific code travels in
// `details.reason`, exactly as `StorageNotConfiguredError` carries its reason.
// Clients switch on `details.reason`.
//
// ⚠ SECRETS. An adapter typically constructs this from a caught SDK error,
// and SDK errors can carry the request (headers included) or even echo a
// masked key in their message. So:
//
//   - `cause` is stored NON-ENUMERABLE and is never passed to
//     `HttpException`'s options (which would store it enumerably twice), so
//     `JSON.stringify(err)` and any structured logger that serialises own
//     enumerable properties never reach it;
//   - `toJSON()` returns only the public body;
//   - `wrap()` uses a generic message rather than copying the SDK's.
//
// Callers must still never put `AiCallContext.apiKey` into `message` or
// `details` themselves; `ai-error.spec.ts` pins the parts this class controls.
// =============================================================================

/**
 * What an {@link AiError} may carry besides its code and message.
 *
 * @stability experimental
 */
export interface AiErrorOptions {
  /** Provider-requested delay before retrying, when it named one. */
  retryAfterMs?: number;
  /** The underlying error. Kept for debugging, never serialised. */
  cause?: unknown;
  /** Extra machine-readable context. Must not contain secret material. */
  details?: Record<string, unknown>;
}

/**
 * The body an {@link AiError} throws (wrapped by the exception filter in the
 * standard envelope).
 *
 * @stability experimental
 */
export interface AiErrorBody {
  /** The AI error code. */
  code: AiErrorCode;
  /** A message safe to show. */
  message: string;
  /** Machine-readable context; `reason` is always the code. */
  details: Record<string, unknown> & {
    /** The AI error code, where clients read it. */
    reason: AiErrorCode;
    /** The provider-requested back-off, when it named one. */
    retryAfterMs?: number;
  };
}

/**
 * The one error the AI platform throws: an `Error` whose HTTP status follows
 * the code ({@link AI_ERROR_STATUS}) and whose body carries the code in
 * `details.reason`. Never carries key material; `cause` is never serialised.
 *
 * HTTP SHAPE WITHOUT NEST. It carries the members a Nest `HttpException`
 * carries (`response`, `status`, `options`, `getResponse()`, `getStatus()`,
 * an own `message` and `name`), set in the same order, so
 * `@marinoscar/platform-api/ai` can splice `HttpException.prototype` into
 * its prototype chain at load time and every platform code path that reads
 * an `HttpException` reads this one unchanged. This package itself never
 * imports Nest.
 *
 * @stability experimental
 */
export class AiError extends Error {
  /** The AI error code. */
  declare readonly code: AiErrorCode;
  /** The provider-requested back-off, when it named one. */
  declare readonly retryAfterMs?: number;
  /** The underlying error. Non-enumerable and never serialised. */
  declare readonly cause: unknown;

  /**
   * @param code - the AI error code; it fixes the HTTP status.
   * @param message - a message safe to show.
   * @param opts - the back-off, the (never serialised) cause and extra details.
   */
  constructor(code: AiErrorCode, message: string, opts: AiErrorOptions = {}) {
    // No message argument: like `HttpException`, the message is assigned
    // below as an own property, after `response`, `status` and `options`.
    super();

    const details: AiErrorBody['details'] = {
      ...(opts.details ?? {}),
      // `reason` is written LAST so a caller-supplied `details.reason` can
      // never make the body disagree with `code`.
      reason: code,
    };

    if (opts.retryAfterMs !== undefined) {
      details.retryAfterMs = opts.retryAfterMs;
    }

    const body: AiErrorBody = { code, message, details };
    const self = this as unknown as Record<string, unknown>;

    // The fields `HttpException`'s constructor writes, in its order. No
    // `options`: HttpException would copy `cause` onto two enumerable
    // properties (`options.cause` and `cause`). See header.
    self.response = body;
    self.status = AI_ERROR_STATUS[code];
    self.options = undefined;
    this.message = message;
    this.name = new.target.name;

    self.code = code;
    // An own `retryAfterMs` exists either way (undefined when the provider
    // named none), as it did when this class extended `HttpException`.
    self.retryAfterMs = opts.retryAfterMs;

    Object.defineProperty(this, 'cause', {
      value: opts.cause,
      enumerable: false,
      writable: false,
      configurable: true,
    });

    // Keep `instanceof AiError` working however the class is downlevelled —
    // see the same line in the platform's `jobs/rate-limit.error.ts`.
    Object.setPrototypeOf(this, AiError.prototype);
  }

  /**
   * The body this error answers with (what `HttpException.getResponse()` returns).
   *
   * @returns the body: code, message and details.
   */
  getResponse(): AiErrorBody {
    return (this as unknown as { response: AiErrorBody }).response;
  }

  /**
   * The HTTP status this error answers with (what `HttpException.getStatus()` returns).
   *
   * @returns the status {@link AI_ERROR_STATUS} assigns to the code.
   */
  getStatus(): number {
    return (this as unknown as { status: number }).status;
  }

  /**
   * The public body, and nothing else — no `cause`, no stack.
   *
   * @returns the same body as {@link AiError.getResponse}.
   */
  toJSON(): AiErrorBody {
    return this.getResponse();
  }

  /**
   * How the job queue's `classifyRateLimit` reads this error (issue #509):
   * a rate limit iff the CODE says so — `AI_RATE_LIMITED` — and never by
   * `.status`. That status is the HTTP response status this platform
   * assigned to the code (503 for `AI_STORAGE_UNAVAILABLE` and
   * `AI_PROVIDER_UNAVAILABLE`), not a provider's capacity signal, so without
   * this a thrown `AiError` 503 was deferred as a throttle instead of
   * failing or charging an attempt.
   *
   * A symbol-keyed prototype method: non-enumerable, so it never reaches
   * `toJSON()`, the exception filter's body, or a structured log line.
   *
   * @returns whether this error is a rate limit, and the provider's delay.
   */
  [AI_CLASSIFY_RATE_LIMIT](): AiRateLimitClassification {
    return this.code === 'AI_RATE_LIMITED'
      ? { rateLimited: true, retryAfterMs: this.retryAfterMs ?? null }
      : { rateLimited: false, retryAfterMs: null };
  }

  /**
   * Type guard.
   *
   * @param value - anything caught.
   * @returns whether it is an `AiError`.
   */
  static isAiError(value: unknown): value is AiError {
    return value instanceof AiError;
  }

  /**
   * Returns `err` unchanged when it is already an `AiError`, otherwise a new
   * `AiError(code)` with `err` as its (non-serialised) cause. The message is
   * generic ON PURPOSE — an SDK's own message may echo request details.
   */
  static wrap(
    err: unknown,
    code: AiErrorCode = 'AI_PROVIDER_UNAVAILABLE',
    message = 'The AI provider request failed.',
  ): AiError {
    if (err instanceof AiError) {
      return err;
    }

    return new AiError(code, message, { cause: err });
  }
}

/**
 * The provider metadata in an `AiError`'s `details` that is safe to log —
 * the HTTP status and the provider's own short error code, type, offending
 * parameter and request id — and nothing else: never a URL or
 * key material. For `AI_INVALID_REQUEST` only, the cause's message is appended
 * as `providerMessage` (log-only, never in `details`), with key-like tokens,
 * Bearer credentials and URLs redacted. Fields an error does not carry are
 * left out; string values are capped and quoted so no provider string can
 * forge a log line.
 *
 * @stability experimental
 */
export const AI_ERROR_LOG_DETAIL_KEYS = ['status', 'providerCode', 'providerType', 'param', 'providerRequestId'] as const;

const AI_ERROR_LOG_VALUE_MAX = 120;
const AI_ERROR_LOG_MESSAGE_MAX = 300;

const AI_ERROR_LOG_REDACTIONS: readonly RegExp[] = [
  /\b(sk|rk|pk|sess)-[A-Za-z0-9_\-*]{6,}/g,
  /Bearer\s+\S+/gi,
  /https?:\/\/\S+/gi,
];

/**
 * The provider's own message for a rejected request (the one field that says
 * WHY a 400 happened), redacted, whitespace-collapsed and capped; `null` when
 * the cause carries none.
 */
function providerMessageForLog(cause: unknown): string | null {
  if (!(cause instanceof Error) || typeof cause.message !== 'string' || cause.message.length === 0) {
    return null;
  }

  let message = cause.message;

  for (const pattern of AI_ERROR_LOG_REDACTIONS) {
    message = message.replace(pattern, '[redacted]');
  }

  message = message.replace(/\s+/g, ' ').trim().slice(0, AI_ERROR_LOG_MESSAGE_MAX);

  return message.length > 0 ? message : null;
}

/**
 * `status=400 providerCode="…" … providerMessage="…"` for `error`, or `''` when it carries none of the safe fields.
 *
 * @stability experimental
 */
export function aiErrorLogDetails(error: AiError): string {
  const details: Record<string, unknown> = (error.getResponse() as Partial<AiErrorBody>).details ?? {};
  const parts: string[] = [];

  for (const key of AI_ERROR_LOG_DETAIL_KEYS) {
    const value = details[key];

    if (typeof value === 'number' && Number.isFinite(value)) {
      parts.push(`${key}=${value}`);
    } else if (typeof value === 'string' && value.length > 0) {
      parts.push(`${key}=${JSON.stringify(value.slice(0, AI_ERROR_LOG_VALUE_MAX))}`);
    }
  }

  if (error.code === 'AI_INVALID_REQUEST') {
    const providerMessage = providerMessageForLog(error.cause);

    if (providerMessage !== null) {
      parts.push(`providerMessage=${JSON.stringify(providerMessage)}`);
    }
  }

  return parts.join(' ');
}
