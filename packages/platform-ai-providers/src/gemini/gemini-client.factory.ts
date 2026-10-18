// =============================================================================
// Google Gen AI SDK client factory (issue #447, epic #421)
// =============================================================================
//
// One client PER CALL, built from that call's `AiCallContext` — the same
// shape as `OpenAiClientFactory` and `AnthropicClientFactory`, for the same
// reason: the key is resolved per call (org key or the user's own).
//
// EVERYTHING THE SDK WOULD DISCOVER ON ITS OWN IS PINNED. `@google/genai`
// reads a surprising amount of ambient configuration, and none of it may
// decide which account or endpoint a call uses (there is no Gemini
// configuration in this application's environment — docs/specs/ai-platform.md
// §2.1):
//
//   GOOGLE_GENAI_USE_VERTEXAI / _ENTERPRISE  -> `vertexai: false`: always the
//                                               Gemini Developer API, never a
//                                               Vertex project's ADC
//   GOOGLE_API_KEY / GEMINI_API_KEY          -> `apiKey` always passed (an
//                                               empty key is refused first)
//   GOOGLE_GEMINI_BASE_URL                   -> `httpOptions.baseUrl` always
//                                               passed
//   GOOGLE_CLOUD_PROJECT / _LOCATION         -> unused off Vertex
//
// NO RETRIES. The SDK retries only when `httpOptions.retryOptions` is set, and
// it never is: retries are the caller's job (the queue for a job, the user
// for an interactive call), and an SDK retrying a 429 underneath would
// multiply every attempt and hide the throttle from `toRateLimitError()`.
//
// The API version is pinned to `v1beta`, where every feature this adapter
// maps (thinking config, `responseJsonSchema`, `thoughtSignature`) lives.
//
// TIMEOUT. `httpOptions.timeout` bounds each request, and the SDK aborts it
// with the same `AbortError` a caller's signal raises — `mapGeminiError`
// tells the two apart by whether the CALLER's signal fired. Setting it also
// makes the SDK raise (never lower) the process-wide undici header/body
// timeouts to match, so a long non-streaming thinking turn is not cut off by
// undici's five-minute default first.
// =============================================================================

import { GoogleGenAI } from '@google/genai';

import { AiError } from '../core/index';
import type { AiCallContext } from '../core/index';
import { GEMINI_PROVIDER_ID } from './gemini-errors';

/**
 * The Gemini API host used when the provider settings name no `baseUrl`.
 *
 * @stability experimental
 */
export const GEMINI_DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com';

/**
 * The Gemini API version the client speaks.
 *
 * @stability experimental
 */
export const GEMINI_API_VERSION = 'v1beta';

/**
 * A generous ceiling for one request; long thinking turns take minutes.
 *
 * @stability experimental
 */
export const GEMINI_DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * The `fetch` the SDK uses. Tests inject a mocked one; production uses the global.
 *
 * @stability experimental
 */
export type GeminiFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/**
 * Options for {@link GeminiClientFactory}; tests inject a mocked `fetch`.
 *
 * @stability experimental
 */
export interface GeminiClientOptions {
  /** The `fetch` the SDK uses; the global one when absent. */
  fetch?: GeminiFetch;
  /** Per-request timeout in milliseconds; {@link GEMINI_DEFAULT_TIMEOUT_MS} when absent. */
  timeoutMs?: number;
}

/**
 * Builds one Google Gen AI SDK client per call from that call's key and base URL, with every option pinned.
 *
 * @stability experimental
 */
export class GeminiClientFactory {
  private readonly options: GeminiClientOptions;

  constructor(options?: GeminiClientOptions) {
    this.options = options ?? {};
  }

  /** The timeout every request of a client from this factory carries. */
  get timeoutMs(): number {
    return this.options.timeoutMs ?? GEMINI_DEFAULT_TIMEOUT_MS;
  }

  /** The SDK client for one call. Throws `AI_KEY_INVALID` for an empty key. */
  create(ctx: AiCallContext): GoogleGenAI {
    if (!ctx.apiKey || ctx.apiKey.trim().length === 0) {
      throw new AiError('AI_KEY_INVALID', 'No Google Gemini API key was supplied.', {
        details: { provider: GEMINI_PROVIDER_ID },
      });
    }

    return new GoogleGenAI({
      vertexai: false,
      apiKey: ctx.apiKey,
      apiVersion: GEMINI_API_VERSION,
      httpOptions: {
        baseUrl: ctx.baseUrl ?? GEMINI_DEFAULT_BASE_URL,
        apiVersion: GEMINI_API_VERSION,
        timeout: this.timeoutMs,
        ...(this.options.fetch ? { fetch: this.options.fetch } : {}),
      },
    });
  }
}
