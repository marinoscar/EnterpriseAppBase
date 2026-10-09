import type { ConfigService } from '@nestjs/config';

import { DeploymentModeService, type DeploymentMode } from '@marinoscar/platform-api/host';

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
