// =============================================================================
// OpenAiCompatibleClientFactory: the Nest binding (issue #991)
// =============================================================================
//
// The factory itself (one SDK client per call, every SDK option pinned) lives
// in `@marinoscar/platform-ai-providers/openai`. This subclass keeps the
// platform's injectable class, its constructor signature and its optional
// `OPENAI_COMPATIBLE_CLIENT_OPTIONS` injection token, so the provider module and any test
// that provides the token wire it exactly as before. It imports no SDK.
// =============================================================================

import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  OpenAiCompatibleClientFactory as BaseOpenAiCompatibleClientFactory,
  type OpenAiClientOptions,
} from '@marinoscar/platform-ai-providers/openai';

/** DI token for `OpenAiClientOptions` (optional; tests and forks provide it). */
export const OPENAI_COMPATIBLE_CLIENT_OPTIONS = Symbol('OPENAI_COMPATIBLE_CLIENT_OPTIONS');

/**
 * The injectable OpenAiCompatibleClientFactory: the framework-free factory of
 * `@marinoscar/platform-ai-providers/openai` with its options injected.
 *
 * @stability experimental
 */
@Injectable()
export class OpenAiCompatibleClientFactory extends BaseOpenAiCompatibleClientFactory {
  /**
   * @param options - the client options (a mocked `fetch` in tests); none in production.
   */
  constructor(@Optional() @Inject(OPENAI_COMPATIBLE_CLIENT_OPTIONS) options?: OpenAiClientOptions) {
    super(options);
  }
}
