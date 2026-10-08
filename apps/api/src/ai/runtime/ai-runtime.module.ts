import { Module } from '@nestjs/common';

import { JobsModule } from '../../platform/jobs/jobs.config';
import { SettingsModule } from '../../platform/settings/settings.config';
import { AiConfigModule } from '../config/ai-config.module';
import { AiCoreModule } from '../core/ai-core.module';
import { AiKeysModule } from '../keys/ai-keys.module';
import { AiStorageModule } from '../storage/ai-storage.module';
import { AiService } from './ai.service';
import { AiAudioSpeechHandler } from './ai-audio-speech.handler';
import { AiAudioTranscribeHandler } from './ai-audio-transcribe.handler';
import { AiImageGenerateHandler } from './ai-image-generate.handler';
import { AiLimitsService } from './ai-limits.service';
import { AiResponseRunHandler } from './ai-response-run.handler';
import { AiRunsPurgeHandler } from './ai-runs-purge.handler';
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
// Also the server-only jobs that execute background runs: `ai.response.run`,
// `ai.image.generate` (#437), `ai.audio.transcribe` (#438) and
// `ai.audio.speech` (#439). And `ai.runs.purge` (#681), the server-only,
// batched retention purge of `ai_runs` (`retention.aiRuns`), enqueued nightly
// by `RetentionPurgeTask` and not gated on the kill switch.
// =============================================================================

@Module({
  // `AiStorageModule` (#437): an image edit's inputs, and a transcription's
  // recording (#438), are storage objects.
  // `SettingsModule` (#681): `ai.runs.purge` reads `retention.aiRuns`.
  imports: [AiCoreModule, AiConfigModule, AiKeysModule, AiStorageModule, JobsModule, SettingsModule],
  providers: [
    AiService,
    AiUsageRecorder,
    // #450: per-user and per-model rate limits, applied by the facade.
    AiLimitsService,
    AiRunsService,
    AiResponseRunHandler,
    AiImageGenerateHandler,
    AiAudioTranscribeHandler,
    AiAudioSpeechHandler,
    AiRunsPurgeHandler,
  ],
  // `AiRunsService` is exported for the HTTP surface (#433): a run's owner
  // reads and cancels it there.
  exports: [AiService, AiRunsService],
})
export class AiRuntimeModule {}
