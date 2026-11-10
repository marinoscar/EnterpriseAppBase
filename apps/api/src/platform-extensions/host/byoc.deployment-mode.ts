import {
  registerDeploymentCapability,
  registerDeploymentMode,
  type DeploymentCapabilityDef,
  type DeploymentModeDef,
} from '@marinoscar/platform-api/host';

// =============================================================================
// EXAMPLE: a deployment mode and a capability of the app's own (PP-14.13)
// =============================================================================
//
// `DEPLOYMENT_MODE` is `self-hosted` or `saas` unless the app registers more.
// A mode is a name plus the capabilities it sets; a capability is a yes/no fact
// with a default and, optionally, a value per mode. What a mode permits is the
// mode's own entry, else the capability's `byMode` entry, else its default
// (`capabilitiesFor`, `DeploymentModeService.can(id)`).
//
// Here: customers who run the app in their own cloud ("bring your own cloud")
// recover through their cloud's database backups, so in-app restore is off
// (like `saas`), and a `bulkExport` capability the app's own code asks about is
// on everywhere but `saas`.
//
// Register both AT IMPORT TIME, before `main.ts` parses `DEPLOYMENT_MODE`.
// Opt in with `registerHostExamples()` (`app-registrations/host.ts`).
// =============================================================================

/** An app capability: the app's bulk export is not offered in `saas`. */
export const bulkExportCapability: DeploymentCapabilityDef = {
  id: 'bulkExport',
  default: true,
  byMode: { saas: false },
};

/** A customer-operated cloud: no in-app restore. */
export const byocDeploymentMode: DeploymentModeDef = {
  id: 'byoc',
  capabilities: { inAppRestore: false },
};

/** Registers the example capability and mode. */
export function registerByocExample(): void {
  registerDeploymentCapability(bulkExportCapability);
  registerDeploymentMode(byocDeploymentMode);
}
