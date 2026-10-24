/**
 * The maintenance hooks, from `@marinoscar/platform-web/host/headless` (#891).
 * Re-exported here so the banner, the gate and their tests keep one app-side
 * import path.
 */

export {
  MAINTENANCE_POLL_INTERVAL_MS,
  useMaintenance,
  useMaintenanceBlock,
} from '@marinoscar/platform-web/host/headless';
export type {
  UseMaintenanceBlockReturn,
  UseMaintenanceOptions,
  UseMaintenanceReturn,
} from '@marinoscar/platform-web/host/headless';
