// =============================================================================
// AnthropicClientFactory: the Nest binding (issue #991)
// =============================================================================
//
// The factory itself (one SDK client per call, every SDK option pinned) lives
// in `@marinoscar/platform-ai-providers/anthropic`. This subclass keeps the
// platform's injectable class, its constructor signature and its optional
// `ANTHROPIC_CLIENT_OPTIONS` injection token, so the provider module and any test
// that provides the token wire it exactly as before. It imports no SDK.
// =============================================================================

import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  AnthropicClientFactory as BaseAnthropicClientFactory,
  type AnthropicClientOptions,
} from '@marinoscar/platform-ai-providers/anthropic';

/** DI token for `AnthropicClientOptions` (optional; tests and forks provide it). */
export const ANTHROPIC_CLIENT_OPTIONS = Symbol('ANTHROPIC_CLIENT_OPTIONS');

/**
 * The injectable AnthropicClientFactory: the framework-free factory of
 * `@marinoscar/platform-ai-providers/anthropic` with its options injected.
 *
 * @stability experimental
 */
@Injectable()
export class AnthropicClientFactory extends BaseAnthropicClientFactory {
  /**
   * @param options - the client options (a mocked `fetch` in tests); none in production.
   */
  constructor(@Optional() @Inject(ANTHROPIC_CLIENT_OPTIONS) options?: AnthropicClientOptions) {
    super(options);
  }
}

// The rest of what this path exported before #991, unchanged.
export { ANTHROPIC_DEFAULT_BASE_URL, ANTHROPIC_DEFAULT_TIMEOUT_MS } from '@marinoscar/platform-ai-providers/anthropic';
export type { AnthropicFetch, AnthropicClientOptions } from '@marinoscar/platform-ai-providers/anthropic';
