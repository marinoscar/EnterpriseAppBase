import { Module } from '@nestjs/common';

import { AiConfigModule } from '../config/ai-config.module';
import { AiCoreModule } from '../core/ai-core.module';
import { AiUsageAdminController } from './ai-usage-admin.controller';
import { AiUsageController } from './ai-usage.controller';
import { AiUsageService } from './ai-usage.service';

// =============================================================================
// AiUsageModule (issue #443, epic #420)
// =============================================================================
//
// Reads `ai_usage_events` (written by `AiUsageRecorder`, #432): the admin and
// per-user aggregate reports. `AiConfigModule` is here for `AiEnabledGuard`;
// `AiCoreModule` for provider display names.
// =============================================================================

@Module({
  imports: [AiCoreModule, AiConfigModule],
  controllers: [AiUsageAdminController, AiUsageController],
  providers: [AiUsageService],
  exports: [AiUsageService],
})
export class AiUsageModule {}
