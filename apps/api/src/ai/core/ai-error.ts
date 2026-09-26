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

export const AI_ERROR_STATUS = {
  AI_DISABLED: 403,
  AI_PROVIDER_DISABLED: 403,
  AI_KEY_REQUIRED: 403,
  AI_KEY_INVALID: 400,
  AI_MODEL_NOT_ENABLED: 403,
  AI_MODEL_NOT_REACHABLE: 403,
  AI_CAPABILITY_UNSUPPORTED: 400,
  AI_RATE_LIMITED: 429,
  AI_PROVIDER_UNAVAILABLE: 503,
  AI_CONTENT_FILTERED: 422,
  AI_INVALID_REQUEST: 400,
  AI_STRUCTURED_OUTPUT_INVALID: 502,
} as const;

export type AiErrorCode = keyof typeof AI_ERROR_STATUS;

/** Every code, in declaration order. */
export const AI_ERROR_CODES = Object.keys(AI_ERROR_STATUS) as AiErrorCode[];

/** Type guard for a string that arrived from somewhere untyped. */
export function isAiErrorCode(value: unknown): value is AiErrorCode {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(AI_ERROR_STATUS, value);
}
