import { Module } from '@nestjs/common';

import { JobsModule } from '../../jobs/jobs.module';
import { AiConfigModule } from '../config/ai-config.module';
import { AiCoreModule } from '../core/ai-core.module';
import { AiKeysModule } from '../keys/ai-keys.module';
import { AiService } from './ai.service';
import { AiResponseRunHandler } from './ai-response-run.handler';
import { AiRunsService } from './ai-runs.service';
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
//
// Also the server-only `ai.response.run` job that executes background runs.
// =============================================================================

@Module({
  imports: [AiCoreModule, AiConfigModule, AiKeysModule, JobsModule],
  providers: [AiService, AiUsageRecorder, AiRunsService, AiResponseRunHandler],
  // `AiRunsService` is exported for the HTTP surface (#433): a run's owner
  // reads and cancels it there.
  exports: [AiService, AiRunsService],
})
export class AiRuntimeModule {}
