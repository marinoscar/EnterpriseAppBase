// =============================================================================
// GeminiProviderAdapter: the Nest binding (issue #991)
// =============================================================================
//
// The adapter itself (ports, mappers, error mapping, telemetry) lives in
// `@marinoscar/platform-ai-providers/gemini`, framework-free. This subclass keeps the
// platform's injectable class and constructor signature
// (`AiProviderRegistry`, `GeminiClientFactory`), hands the base a Nest `Logger` named
// after this class and the platform tracer (`../platform-ai-tracer.ts`), so
// log lines and `ai.provider.call` spans are unchanged, and registers itself
// with `AiProviderRegistry` in `onModuleInit` as it always did. It imports no
// SDK.
// =============================================================================

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { GeminiProviderAdapter as BaseGeminiProviderAdapter } from '@marinoscar/platform-ai-providers/gemini';

import '../../core/ai-error';
import { AiProviderRegistry } from '../../core/provider-registry';
import { PLATFORM_AI_TRACER } from '../platform-ai-tracer';
import { GeminiClientFactory } from './gemini-client.factory';

/**
 * The injectable GeminiProviderAdapter: registers itself with `AiProviderRegistry` when
 * its module initialises.
 *
 * @stability experimental
 */
@Injectable()
export class GeminiProviderAdapter extends BaseGeminiProviderAdapter implements OnModuleInit {
  /**
   * @param registry - the provider registry this adapter joins.
   * @param clients - the injectable SDK client factory.
   */
  constructor(
    private readonly registry: AiProviderRegistry,
    clients: GeminiClientFactory,
  ) {
    super({ clients, logger: new Logger(GeminiProviderAdapter.name), tracer: PLATFORM_AI_TRACER });
  }

  /** Adds this adapter to `AiProviderRegistry`. */
  onModuleInit(): void {
    this.registry.register(this);
  }
}

// The rest of what this path exported before #991, unchanged.
export { GEMINI_PROVIDER_CALL_SPAN } from '@marinoscar/platform-ai-providers/gemini';
