// `@marinoscar/platform-web/host/headless`: the host slice's wire shapes, API
// calls, maintenance-block store and hooks, with no component (issue #891).
// Documented in ../README.md.

export {
  MAINTENANCE_ADMIN_PATH,
  MAINTENANCE_ERROR_MARKER,
  MAINTENANCE_FALLBACK_MESSAGE,
  MAINTENANCE_RETRY_AFTER_SECONDS,
  clearMaintenanceBlock,
  getMaintenanceBlock,
  isDecidingLayer,
  readMaintenanceBlock,
  reportMaintenanceBlock,
  subscribeToMaintenanceBlock,
} from './maintenance-block.js';
/** @stability experimental */
export type { MaintenanceBlock } from './maintenance-block.js';

export { createHostApi } from './host-client.js';
export type { HostApi } from './host-client.js';

export { MAINTENANCE_POLL_INTERVAL_MS, useMaintenance, useMaintenanceBlock } from './use-maintenance.js';
export type { UseMaintenanceBlockReturn, UseMaintenanceOptions, UseMaintenanceReturn } from './use-maintenance.js';
export { useAbout } from './use-about.js';
export type { UseAboutReturn } from './use-about.js';

/** @stability experimental */
export type {
  AboutApi,
  AboutApp,
  AboutDatabase,
  AboutDeployedBy,
  AboutHistoryEntry,
  AboutHost,
  AboutProxy,
  AboutRemote,
  AboutResponse,
  AboutRun,
  AboutRuntime,
  DeployCommand,
  DeployInfoStatus,
  MaintenanceOverride,
  MaintenancePolicy,
  MaintenanceSource,
  MaintenanceStatus,
  UpdateMaintenanceInput,
} from './contract.js';
