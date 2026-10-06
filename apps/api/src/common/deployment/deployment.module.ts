import { Global, Module } from '@nestjs/common';

import { DeploymentModeService } from './deployment-mode.service';

/**
 * Deployment mode (#685): `DeploymentModeService`.
 *
 * `@Global()` because the mode is a property of the whole deployment and more
 * than one feature will ask it (the restore path today; tenancy and the support
 * bundle later). The service depends on nothing but `ConfigService`, so a global
 * provider here cannot drag any feature graph into the modules that inject it.
 */
@Global()
@Module({
  providers: [DeploymentModeService],
  exports: [DeploymentModeService],
})
export class DeploymentModule {}
