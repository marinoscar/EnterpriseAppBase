// =============================================================================
// System settings namespace `maintenance` (issue #677; namespace #256, epic #254)
// =============================================================================
//
// A declaration file: pure data, imports only leaf modules. Packaged with the
// maintenance switch by #867; the app registers it in its system settings
// manifest (before `SettingsModule.forRoot()` composes the request bodies).
// Recipe: packages/platform-api/src/settings/README.md.
// =============================================================================

import type { z } from 'zod';

import type { SystemSettingsNamespace } from '../../settings/index';
import {
  DEFAULT_MAINTENANCE_MESSAGE,
  maintenanceResponseSchema,
  maintenanceSettingsPatchSchema,
  maintenanceSettingsSchema,
  systemMaintenancePatchSchema,
  systemMaintenanceSchema,
  type SystemMaintenanceValue,
} from './maintenance.schemas';

// Inert, like every operations namespace: the maintenance window ships off.
const MAINTENANCE_SYSTEM_DEFAULTS: SystemMaintenanceValue = {
  enabled: false,
  // Shared with the schema so the banner's copy and its validation cannot
  // disagree, and so a fork renaming its product finds no product name here
  // to rename.
  message: DEFAULT_MAINTENANCE_MESSAGE,
  allowAdmins: true,
  startedAt: null,
  startedById: null,
};

/**
 * The `maintenance` PATCH merge. `startedAt`/`startedById` use `!== undefined`,
 * never `??`: an explicit `null` clears the window's provenance.
 *
 * @param current - the stored value.
 * @param patch - the PATCH body's `maintenance` branch, when present.
 * @returns the merged value.
 *
 * @stability experimental
 */
export function mergeMaintenanceSettings(
  current: SystemMaintenanceValue,
  patch?: z.infer<typeof maintenanceSettingsPatchSchema>,
): SystemMaintenanceValue {
  return {
    enabled: patch?.enabled ?? current.enabled,
    message: patch?.message ?? current.message,
    allowAdmins: patch?.allowAdmins ?? current.allowAdmins,
    startedAt: patch?.startedAt !== undefined ? patch.startedAt : current.startedAt,
    startedById: patch?.startedById !== undefined ? patch.startedById : current.startedById,
  };
}

/**
 * The `maintenance` system-settings namespace: the persisted maintenance
 * window. Registered by the app's system settings manifest. Inert by default:
 * the window ships closed.
 *
 * @stability experimental
 */
export const MAINTENANCE_SYSTEM_SETTINGS = {
  /** The namespace key (permanent). */
  key: 'maintenance',
  /** What it holds. */
  description: 'The persisted maintenance window: whether it is on, the banner message, whether admins may still sign in, and who started it when.',
  /** The stored shape. */
  storedSchema: systemMaintenanceSchema,
  /** The stored partial. */
  patchSchema: systemMaintenancePatchSchema,
  /** The PUT body's branch. */
  putSchema: maintenanceSettingsSchema,
  /** The PATCH body's branch. */
  wirePatchSchema: maintenanceSettingsPatchSchema,
  /** The GET response's branch. */
  responseSchema: maintenanceResponseSchema,
  /** Inert: the window ships closed. */
  defaults: MAINTENANCE_SYSTEM_DEFAULTS,
  /** Optional in a PUT body. */
  requiredOnPut: false,
  /** The PATCH merge ({@link mergeMaintenanceSettings}). */
  merge: mergeMaintenanceSettings,
} satisfies SystemSettingsNamespace<'maintenance', SystemMaintenanceValue, z.infer<typeof maintenanceSettingsPatchSchema>>;

declare module '../../settings/registry/system-settings-namespace' {
  interface SystemSettingsNamespaces {
    /** The maintenance window (#256, epic #254). REQUIRED for the reason `jobs` gives. */
    maintenance: SystemMaintenanceValue;
  }
  interface SystemSettingsNamespaceDeclarations {
    /** The `maintenance` declaration. */
    maintenance: typeof MAINTENANCE_SYSTEM_SETTINGS;
  }
}
