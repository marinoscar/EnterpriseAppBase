// =============================================================================
// GeminiClientFactory: the Nest binding (issue #991)
// =============================================================================
//
// The factory itself (one SDK client per call, every SDK option pinned) lives
// in `@marinoscar/platform-ai-providers/gemini`. This subclass keeps the
// platform's injectable class, its constructor signature and its optional
// `GEMINI_CLIENT_OPTIONS` injection token, so the provider module and any test
// that provides the token wire it exactly as before. It imports no SDK.
// =============================================================================

import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  GeminiClientFactory as BaseGeminiClientFactory,
  type GeminiClientOptions,
} from '@marinoscar/platform-ai-providers/gemini';

/** DI token for `GeminiClientOptions` (optional; tests and forks provide it). */
export const GEMINI_CLIENT_OPTIONS = Symbol('GEMINI_CLIENT_OPTIONS');

/**
 * The injectable GeminiClientFactory: the framework-free factory of
 * `@marinoscar/platform-ai-providers/gemini` with its options injected.
 *
 * @stability experimental
 */
@Injectable()
export class GeminiClientFactory extends BaseGeminiClientFactory {
  /**
   * @param options - the client options (a mocked `fetch` in tests); none in production.
   */
  constructor(@Optional() @Inject(GEMINI_CLIENT_OPTIONS) options?: GeminiClientOptions) {
    super(options);
  }
}

// The rest of what this path exported before #991, unchanged.
export { GEMINI_API_VERSION, GEMINI_DEFAULT_BASE_URL, GEMINI_DEFAULT_TIMEOUT_MS } from '@marinoscar/platform-ai-providers/gemini';
export type { GeminiFetch, GeminiClientOptions } from '@marinoscar/platform-ai-providers/gemini';
