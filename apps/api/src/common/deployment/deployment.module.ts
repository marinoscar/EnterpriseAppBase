import { Global, Module } from '@nestjs/common';

import { DEPLOYMENT_NETWORK_SOURCE, NetworkEgressDoctorCheck } from '@marinoscar/platform-api/doctor';

import { SettingsModule } from '../../settings/settings.module';
import { DeploymentModeDoctorCheck } from './doctor/deployment-mode.doctor-check';
import { DeploymentModeService } from './deployment-mode.service';
import { DeploymentNetworkService } from './deployment-network.service';

/**
 * Deployment mode (#685): `DeploymentModeService` and the `core.deployment-mode`
 * doctor check. Deployment network (#773): `DeploymentNetworkService`, bound as
 * the doctor slice's `DEPLOYMENT_NETWORK_SOURCE`, and the platform's
 * `network.egress` check, which reads it and every module's egress contributor.
 *
 * `@Global()` because the mode is a property of the whole deployment and more
 * than one feature will ask it (the restore path today; tenancy and the support
 * bundle later). The service depends on nothing but `ConfigService`, so a global
 * provider here cannot drag any feature graph into the modules that inject it.
 *
 * `SettingsModule` is imported for the doctor check alone, which reads the
 * backup policy. The edge points one way (deployment → settings); nothing in
 * `SettingsModule` injects `DeploymentModeService`.
 */
@Global()
@Module({
  imports: [SettingsModule],
  providers: [
    DeploymentModeService,
    DeploymentModeDoctorCheck,
    DeploymentNetworkService,
    { provide: DEPLOYMENT_NETWORK_SOURCE, useExisting: DeploymentNetworkService },
    NetworkEgressDoctorCheck,
  ],
  exports: [DeploymentModeService, DeploymentNetworkService, DEPLOYMENT_NETWORK_SOURCE],
})
export class DeploymentModule {}
