// =============================================================================
// AiError: the platform integration (issue #991; taxonomy #424, epic #419)
// =============================================================================
//
// The error taxonomy (`AI_ERROR_STATUS`, `AiError`, `aiErrorLogDetails`, ...)
// moved to `@marinoscar/platform-ai-providers`, where `AiError` extends plain
// `Error` so the adapters run without Nest. Inside the platform it must stay
// what it always was: a Nest `HttpException` (the global
// `HttpExceptionFilter` and Nest's own handlers test `instanceof
// HttpException`) with `toRateLimitError()` for job handlers. This module
// restores both, ONCE, when it is first loaded:
//
//   1. `HttpException.prototype` is spliced into `AiError`'s prototype chain
//      (and `HttpException` into the static side), so `new AiError(...)
//      instanceof HttpException` holds. The lean class already carries every
//      member `HttpException`'s constructor would have set (`response`,
//      `status`, `options`, `message`, `name`, in that order) and its own
//      `getResponse()`/`getStatus()`, so the filter reads the same body and
//      status as before. Its `[CLASSIFY_RATE_LIMIT]` method is keyed by the
//      registered `Symbol.for('jobs.classifyRateLimit')`, the very symbol
//      `jobs/` exports, so `classifyRateLimit` already believes it.
//   2. `toRateLimitError()` is added to the prototype, returning the queue's
//      `RateLimitError` for `AI_RATE_LIMITED` and `null` otherwise.
//   3. A module augmentation gives the type the same two facts, so
//      platform code (and `@marinoscar/platform-api/ai` consumers) still see
//      an `AiError` that extends `HttpException` and has
//      `toRateLimitError(): RateLimitError | null`.
//
// Every platform file that uses `AiError` reaches it through this module:
// the `ai/core/*` re-export shims import it for its side effect, and the
// provider wrappers import it directly, so the patch has always run before
// a platform code path can construct or catch an `AiError`.
// =============================================================================

import { HttpException } from '@nestjs/common';
import { AiError } from '@marinoscar/platform-ai-providers';

import { CLASSIFY_RATE_LIMIT, RateLimitError, type SelfClassifyingRateLimit } from '../../jobs/index';

declare module '@marinoscar/platform-ai-providers' {
  // Declaration merging onto the lean class: inside the platform the
  // prototype chain carries `HttpException` (patched below), and the queue's
  // self-classification symbol is the same registered symbol.
  interface AiError extends HttpException, SelfClassifyingRateLimit {
    /**
     * The queue's rate-limit signal for this error, or `null` when this
     * error is not a rate limit. A job handler does
     * `throw err.toRateLimitError() ?? err;` so a provider throttle defers
     * the job instead of charging an attempt.
     *
     * @returns a `RateLimitError` for `AI_RATE_LIMITED`, otherwise `null`.
     */
    toRateLimitError(): RateLimitError | null;
  }
}

/** True once this module has patched the class (it is evaluated once per module instance). */
const PATCHED = Symbol.for('platform-api.ai.AiErrorHttpException');

type PatchableAiError = typeof AiError & { [PATCHED]?: true };

if (!(AiError as PatchableAiError)[PATCHED]) {
  Object.setPrototypeOf(AiError.prototype, HttpException.prototype);
  Object.setPrototypeOf(AiError, HttpException);

  Object.defineProperty(AiError.prototype, 'toRateLimitError', {
    value: function toRateLimitError(this: AiError): RateLimitError | null {
      if (this.code !== 'AI_RATE_LIMITED') {
        return null;
      }

      return new RateLimitError(this.message, this.retryAfterMs);
    },
    enumerable: false,
    writable: true,
    configurable: true,
  });

  // The lean class keys its classifier by `Symbol.for('jobs.classifyRateLimit')`;
  // fail loudly at load time if the queue ever changes the symbol.
  if (typeof (AiError.prototype as Partial<SelfClassifyingRateLimit>)[CLASSIFY_RATE_LIMIT] !== 'function') {
    throw new Error('AiError does not implement the job queue CLASSIFY_RATE_LIMIT contract.');
  }

  Object.defineProperty(AiError, PATCHED, { value: true });
}

export {
  AI_ERROR_CODES,
  AI_ERROR_LOG_DETAIL_KEYS,
  AI_ERROR_STATUS,
  AiError,
  aiErrorLogDetails,
  isAiErrorCode,
} from '@marinoscar/platform-ai-providers';
export type { AiErrorBody, AiErrorCode, AiErrorOptions } from '@marinoscar/platform-ai-providers';
