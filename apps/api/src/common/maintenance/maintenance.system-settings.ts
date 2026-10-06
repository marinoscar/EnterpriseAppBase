// =============================================================================
// System settings namespace `maintenance` (issue #677; namespace #256, epic #254)
// =============================================================================
//
// A declaration file: pure data, imports only leaf modules. Registered by
// `settings/registry/system-settings.manifest.ts`. Recipe:
// `settings/registry/README.md`.
// =============================================================================

import type { z } from 'zod';
import {
  DEFAULT_MAINTENANCE_MESSAGE,
  systemMaintenancePatchSchema,
  systemMaintenanceSchema,
  type SystemMaintenanceValue,
} from '../schemas/settings.schema';
import {
  maintenanceSettingsPatchSchema,
  maintenanceSettingsSchema,
} from '../../settings/dto/system-settings-wire.schemas';
import { maintenanceResponseSchema } from '../../settings/dto/system-settings-response.schemas';
import type { SystemSettingsNamespace } from '../../settings/registry/system-settings-namespace';

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

export const MAINTENANCE_SYSTEM_SETTINGS = {
  key: 'maintenance',
  description: 'The persisted maintenance window: whether it is on, the banner message, whether admins may still sign in, and who started it when.',
  storedSchema: systemMaintenanceSchema,
  patchSchema: systemMaintenancePatchSchema,
  putSchema: maintenanceSettingsSchema,
  wirePatchSchema: maintenanceSettingsPatchSchema,
  responseSchema: maintenanceResponseSchema,
  defaults: MAINTENANCE_SYSTEM_DEFAULTS,
  requiredOnPut: false,
  merge(current, patch) {
    return {
      enabled: patch?.enabled ?? current.enabled,
      message: patch?.message ?? current.message,
      allowAdmins: patch?.allowAdmins ?? current.allowAdmins,
      // `!== undefined`, never `??` — an explicit `null` is a value here.
      // `??` treats a caller's `null` as absent, so clearing the window's
      // provenance would silently be a no-op.
      startedAt: patch?.startedAt !== undefined ? patch.startedAt : current.startedAt,
      startedById: patch?.startedById !== undefined ? patch.startedById : current.startedById,
    };
  },
} satisfies SystemSettingsNamespace<
  'maintenance',
  SystemMaintenanceValue,
  z.infer<typeof maintenanceSettingsPatchSchema>
>;

declare module '../../settings/registry/system-settings-namespace' {
  interface SystemSettingsNamespaces {
    /** The maintenance window (#256, epic #254). REQUIRED for the reason `jobs` gives. */
    maintenance: SystemMaintenanceValue;
  }
  interface SystemSettingsNamespaceDeclarations {
    maintenance: typeof MAINTENANCE_SYSTEM_SETTINGS;
  }
}
