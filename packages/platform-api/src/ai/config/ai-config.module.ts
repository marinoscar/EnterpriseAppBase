import { Module } from '@nestjs/common';

import { CredentialsModule } from '../../credentials/index';
import { AiCatalogModule } from '../catalog/ai-catalog.module';
import { AiCoreModule } from '../core/ai-core.module';
import { AiAdminController } from './ai-admin.controller';
import { AiConfigAdminService } from './ai-config-admin.service';
import { AiConfigService } from './ai-config.service';
import { AiOrgEnabledInterceptor } from './ai-org-enabled.interceptor';
import { AiEnabledGuard } from './ai-enabled.guard';
import { AiModelsAdminService } from './ai-models-admin.service';
import { AiProviderTestService } from './ai-provider-test.service';
import { AiPublicController } from './ai-public.controller';
import { AiEnabledDoctorCheck } from './doctor/ai-enabled.doctor-check';
import { AiProvidersDoctorCheck } from './doctor/ai-providers.doctor-check';
import { AiProvidersEgressContributor } from './doctor/egress/ai-providers.egress.contributor';
import { AiRealtimeEgressContributor } from './doctor/egress/ai-realtime.egress.contributor';

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

/**
 * The AI policy module: `AiConfigService`, `AiEnabledGuard`,
 * `AiOrgEnabledInterceptor` and the admin AI configuration routes. Imported by
 * `AiModule.forRoot`; a feature module imports the configured `AiModule`.
 *
 * @stability experimental
 */
@Module({
  imports: [CredentialsModule, AiCoreModule, AiCatalogModule],
  controllers: [AiAdminController, AiPublicController],
  providers: [
    AiConfigService,
    AiEnabledGuard,
    AiOrgEnabledInterceptor,
    AiConfigAdminService,
    AiProviderTestService,
    AiModelsAdminService,
    // Doctor checks (#634): policy and key STATUS only — no model call.
    AiEnabledDoctorCheck,
    AiProvidersDoctorCheck,
    // Egress inventory (#773): provider endpoints and realtime voice hosts.
    AiProvidersEgressContributor,
    AiRealtimeEgressContributor,
  ],
  exports: [AiConfigService, AiEnabledGuard, AiOrgEnabledInterceptor, AiConfigAdminService],
})
export class AiConfigModule {}
