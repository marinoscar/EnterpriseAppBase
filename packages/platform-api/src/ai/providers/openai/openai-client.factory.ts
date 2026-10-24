// =============================================================================
// OpenAiClientFactory: the Nest binding (issue #991)
// =============================================================================
//
// The factory itself (one SDK client per call, every SDK option pinned) lives
// in `@marinoscar/platform-ai-providers/openai`. This subclass keeps the
// platform's injectable class, its constructor signature and its optional
// `OPENAI_CLIENT_OPTIONS` injection token, so the provider module and any test
// that provides the token wire it exactly as before. It imports no SDK.
// =============================================================================

import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  OpenAiClientFactory as BaseOpenAiClientFactory,
  type OpenAiClientOptions,
} from '@marinoscar/platform-ai-providers/openai';

/** DI token for `OpenAiClientOptions` (optional; tests and forks provide it). */
export const OPENAI_CLIENT_OPTIONS = Symbol('OPENAI_CLIENT_OPTIONS');

/**
 * The injectable OpenAiClientFactory: the framework-free factory of
 * `@marinoscar/platform-ai-providers/openai` with its options injected.
 *
 * @stability experimental
 */
@Injectable()
export class OpenAiClientFactory extends BaseOpenAiClientFactory {
  /**
   * @param options - the client options (a mocked `fetch` in tests); none in production.
   */
  constructor(@Optional() @Inject(OPENAI_CLIENT_OPTIONS) options?: OpenAiClientOptions) {
    super(options);
  }
}

// The rest of what this path exported before #991, unchanged.
export { assertOpenAiApiKey, OPENAI_DEFAULT_BASE_URL, OPENAI_DEFAULT_TIMEOUT_MS, pinnedOpenAiClientOptions } from '@marinoscar/platform-ai-providers/openai';
export type { OpenAiFetch, OpenAiClientOptions } from '@marinoscar/platform-ai-providers/openai';
