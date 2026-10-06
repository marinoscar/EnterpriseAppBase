import type { ConfigService } from '@nestjs/config';

import type { DeploymentMode } from '../../src/common/deployment/deployment-mode';
import { DeploymentModeService } from '../../src/common/deployment/deployment-mode.service';

/**
 * A real `DeploymentModeService` for a given mode (#685), built through the same
 * parser production uses rather than a hand-rolled stub, so a test cannot assert
 * against a capability table the service would never produce.
 */
export function deploymentModeFor(mode: DeploymentMode = 'self-hosted'): DeploymentModeService {
  return new DeploymentModeService({
    get: (key: string) => (key === 'deployment.mode' ? mode : undefined),
  } as unknown as ConfigService);
}
