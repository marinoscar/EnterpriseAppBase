/**
 * The client half of the maintenance wire contract: the recogniser and the
 * block store, from `@marinoscar/platform-web/host/headless` (#891).
 * Re-exported so `services/api.ts` (which feeds the store from its
 * `onErrorResponse` hook), the gate and the banner keep one app-side import
 * path. There is exactly one store: the package's.
 */

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
} from '@marinoscar/platform-web/host/headless';
export type { MaintenanceBlock } from '@marinoscar/platform-web/host/headless';
