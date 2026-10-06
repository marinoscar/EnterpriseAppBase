import { Global, Module } from '@nestjs/common';

import { SettingsModule } from '../../settings/settings.module';
import { DeploymentModeDoctorCheck } from './doctor/deployment-mode.doctor-check';
import { DeploymentModeService } from './deployment-mode.service';

/**
 * Deployment mode (#685): `DeploymentModeService` and the `core.deployment-mode`
 * doctor check.
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
  providers: [DeploymentModeService, DeploymentModeDoctorCheck],
  exports: [DeploymentModeService],
})
export class DeploymentModule {}
