import { Module } from '@nestjs/common';

import { AiConfigModule } from '../config/ai-config.module';
import { AiCoreModule } from '../core/ai-core.module';
import { AiKeysModule } from '../keys/ai-keys.module';
import { AiService } from './ai.service';
import { AiUsageRecorder } from './ai-usage.recorder';

// =============================================================================
// AiRuntimeModule (issue #432, epic #419) — THE module forks import
// =============================================================================
//
// Exports `AiService`, the runtime facade. A fork adds AI to a feature with
//
//   @Module({ imports: [AiModule], providers: [MyFeatureService] })
//
// (`AiModule` re-exports this module) and injects `AiService`. Nothing else
// in `ai/` is part of a fork's contract: no adapter, no key service, no
// registry — the facade applies every gate and resolves every key itself.
// =============================================================================

@Module({
  imports: [AiCoreModule, AiConfigModule, AiKeysModule],
  providers: [AiService, AiUsageRecorder],
  exports: [AiService],
})
export class AiRuntimeModule {}
