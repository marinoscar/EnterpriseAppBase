// The slice's default `USER_DATA_ENVIRONMENT` (issue #880): the deployment mode
// from the host slice and the tenancy mode from the identity slice, so an app
// binds only the bypass client (`USER_DATA_DB`).

import { Injectable } from '@nestjs/common';

import { DeploymentModeService } from '../host/index';
import { TenancyService } from '../identity/index';
import type { UserDataEnvironment } from './ports';

/**
 * `USER_DATA_ENVIRONMENT` from `DEPLOYMENT_MODE` ({@link DeploymentModeService})
 * and `TENANCY_MODE` (`TenancyService`).
 *
 * @stability experimental
 */
@Injectable()
export class DefaultUserDataEnvironment implements UserDataEnvironment {
  constructor(
    private readonly deployment: DeploymentModeService,
    private readonly tenancy: TenancyService,
  ) {}

  /** The parsed `DEPLOYMENT_MODE`. */
  deploymentMode(): 'self-hosted' | 'saas' {
    return this.deployment.mode;
  }

  /** The parsed `TENANCY_MODE`. */
  tenancyMode(): 'single' | 'multi' {
    return this.tenancy.mode();
  }
}
