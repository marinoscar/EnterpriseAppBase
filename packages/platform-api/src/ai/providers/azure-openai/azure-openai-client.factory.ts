// =============================================================================
// AzureOpenAiClientFactory: the Nest binding (issue #991)
// =============================================================================
//
// The factory itself (one SDK client per call, every SDK option pinned) lives
// in `@marinoscar/platform-ai-providers/openai`. This subclass keeps the
// platform's injectable class, its constructor signature and its optional
// `AZURE_OPENAI_CLIENT_OPTIONS` injection token, so the provider module and any test
// that provides the token wire it exactly as before. It imports no SDK.
// =============================================================================

import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  AzureOpenAiClientFactory as BaseAzureOpenAiClientFactory,
  type OpenAiClientOptions,
} from '@marinoscar/platform-ai-providers/openai';

/** DI token for `OpenAiClientOptions` (optional; tests and forks provide it). */
export const AZURE_OPENAI_CLIENT_OPTIONS = Symbol('AZURE_OPENAI_CLIENT_OPTIONS');

/**
 * The injectable AzureOpenAiClientFactory: the framework-free factory of
 * `@marinoscar/platform-ai-providers/openai` with its options injected.
 *
 * @stability experimental
 */
@Injectable()
export class AzureOpenAiClientFactory extends BaseAzureOpenAiClientFactory {
  /**
   * @param options - the client options (a mocked `fetch` in tests); none in production.
   */
  constructor(@Optional() @Inject(AZURE_OPENAI_CLIENT_OPTIONS) options?: OpenAiClientOptions) {
    super(options);
  }
}

// The rest of what this path exported before #991, unchanged.
export { azureOpenAiBaseUrl } from '@marinoscar/platform-ai-providers/openai';
