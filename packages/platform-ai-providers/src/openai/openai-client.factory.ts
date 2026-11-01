// =============================================================================
// OpenAI SDK client factory (issue #426, epic #419)
// =============================================================================
//
// One client PER CALL, built from that call's `AiCallContext`: the key is
// resolved per call by the runtime (org key or the user's own), so a
// long-lived client holding one key would be the wrong shape.
//
// Every option the SDK would otherwise read from the environment is pinned
// explicitly. There is no `OPENAI_API_KEY` / `OPENAI_BASE_URL` configuration
// in this application (docs/specs/ai-platform.md) and an ambient variable on
// a host must not silently change which account or endpoint a call uses.
//
// `maxRetries: 0` — retries are the caller's job (the queue for a job, the
// user for an interactive call); the SDK retrying underneath would multiply
// every attempt and hide a 429 from `toRateLimitError()`.
// =============================================================================

import { OpenAI } from 'openai';

import { AiError } from '../core/index';
import type { AiCallContext } from '../core/index';
import { OPENAI_FAMILY, type OpenAiFamily } from './openai-errors';

/**
 * The OpenAI API root used when the provider settings name no `baseUrl`.
 *
 * @stability experimental
 */
export const OPENAI_DEFAULT_BASE_URL = 'https://api.openai.com/v1';

/**
 * A generous ceiling for one request; long reasoning turns take minutes.
 *
 * @stability experimental
 */
export const OPENAI_DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * The `fetch` the SDK uses. Tests inject a mocked one; production uses the global.
 *
 * @stability experimental
 */
export type OpenAiFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/**
 * Options for the OpenAI-family client factories; tests inject a mocked `fetch`.
 *
 * @stability experimental
 */
export interface OpenAiClientOptions {
  /** The `fetch` the SDK uses; the global one when absent. */
  fetch?: OpenAiFetch;
  /** Per-request timeout in milliseconds; {@link OPENAI_DEFAULT_TIMEOUT_MS} when absent. */
  timeoutMs?: number;
}

/**
 * The SDK options {@link pinnedOpenAiClientOptions} returns.
 *
 * @stability experimental
 */
export interface PinnedOpenAiClientOptions {
  /** Never read `OPENAI_ORG_ID`. */
  organization: null;
  /** Never read `OPENAI_PROJECT_ID`. */
  project: null;
  /** Never read an admin key from the environment. */
  adminAPIKey: null;
  /** Never read a webhook secret from the environment. */
  webhookSecret: null;
  /** The SDK never retries: the caller (the queue or the user) does. */
  maxRetries: number;
  /** Per-request timeout in milliseconds. */
  timeout: number;
  /** The SDK never logs. */
  logLevel: 'off';
  /** The `fetch` the SDK uses, when one was given. */
  fetch?: OpenAiFetch;
}

/**
 * Every SDK option this application pins, whatever member of the OpenAI
 * family the client talks to (#448): nothing may be read from the
 * environment (`OPENAI_ORG_ID`, `OPENAI_PROJECT_ID`, `OPENAI_LOG`, ...), the
 * SDK never retries, and it never logs. The Azure and OpenAI-compatible
 * factories spread this into their own clients.
 *
 * @stability experimental
 */
export function pinnedOpenAiClientOptions(options: OpenAiClientOptions, fetch?: OpenAiFetch): PinnedOpenAiClientOptions {
  const chosenFetch = fetch ?? options.fetch;

  return {
    organization: null,
    project: null,
    adminAPIKey: null,
    webhookSecret: null,
    maxRetries: 0,
    timeout: options.timeoutMs ?? OPENAI_DEFAULT_TIMEOUT_MS,
    // The SDK's own logger writes to the console and, at debug level, the
    // request — never let an ambient OPENAI_LOG turn that on.
    logLevel: 'off' as const,
    ...(chosenFetch ? { fetch: chosenFetch } : {}),
  };
}

/**
 * Throws `AI_KEY_INVALID` for an empty key — before any client is built.
 *
 * @stability experimental
 */
export function assertOpenAiApiKey(ctx: AiCallContext, family: OpenAiFamily = OPENAI_FAMILY): void {
  if (!ctx.apiKey || ctx.apiKey.trim().length === 0) {
    throw new AiError('AI_KEY_INVALID', `No ${family.label} API key was supplied.`, {
      details: { provider: family.providerId },
    });
  }
}

/**
 * Builds one OpenAI SDK client per call from that call's key and base URL, with every option pinned (no retries, no environment reads, no SDK logging).
 *
 * @stability experimental
 */
export class OpenAiClientFactory {
  private readonly options: OpenAiClientOptions;

  constructor(options?: OpenAiClientOptions) {
    this.options = options ?? {};
  }

  /** The SDK client for one call. Throws `AI_KEY_INVALID` for an empty key. */
  create(ctx: AiCallContext): OpenAI {
    assertOpenAiApiKey(ctx);

    return new OpenAI({
      apiKey: ctx.apiKey,
      baseURL: ctx.baseUrl ?? OPENAI_DEFAULT_BASE_URL,
      ...pinnedOpenAiClientOptions(this.options),
    });
  }
}
