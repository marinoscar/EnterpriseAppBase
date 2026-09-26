import { Module } from '@nestjs/common';

import { AiCatalogModule } from './catalog/ai-catalog.module';
import { AiCoreModule } from './core/ai-core.module';
import { OpenAiProviderModule } from './providers/openai/openai.module';

/**
 * The AI platform's root module (epic #419).
 *
 * Deliberately just a list of imports. Each later story (providers, catalog,
 * config, keys, runtime, HTTP) adds ONE import line here, so the whole
 * platform's wiring is visible in one short file — the same "being in the
 * graph is the registration" rule `app.module.ts` states for `JobsModule`.
 */
@Module({
  imports: [AiCoreModule, OpenAiProviderModule, AiCatalogModule],
  exports: [AiCoreModule],
})
export class AiModule {}
