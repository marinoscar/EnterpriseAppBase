import { Module } from '@nestjs/common';

import { CredentialsModule } from '../../credentials/credentials.module';
import { SettingsModule } from '../../settings/settings.module';
import { AiCoreModule } from '../core/ai-core.module';
import { AiAdminController } from './ai-admin.controller';
import { AiConfigAdminService } from './ai-config-admin.service';
import { AiConfigService } from './ai-config.service';
import { AiEnabledGuard } from './ai-enabled.guard';

// =============================================================================
// AiConfigModule (issue #428, epic #419)
// =============================================================================
//
// The AI platform's configuration: the cached kill-switch resolver every other
// AI story consumes (`AiConfigService`, `AiEnabledGuard`), and the admin HTTP
// surface under `/api/admin/ai/*` plus the public `GET /api/ai/config`.
//
// `CredentialsModule` is imported explicitly — it is deliberately not
// `@Global` (see that module), so this line is the visible record that this
// module can read the admin AI key.
// =============================================================================

@Module({
  imports: [SettingsModule, CredentialsModule, AiCoreModule],
  controllers: [AiAdminController],
  providers: [AiConfigService, AiEnabledGuard, AiConfigAdminService],
  exports: [AiConfigService, AiEnabledGuard],
})
export class AiConfigModule {}
