// =============================================================================
// System settings namespace manifest (issue #677)
// =============================================================================
//
// The explicit, grep-able list of system settings namespaces. Registers every
// platform declaration IN TODAY'S KEY ORDER, then the app-owned file. Order is
// behaviour, not style: it is the key order of the stored JSON, of every
// composed schema and of the OpenAPI document (pinned by
// `test/settings/settings-catalog.spec.ts`). Append a new platform namespace;
// never insert one between existing entries.
//
// Imported for its side effect by `composed.ts` and the registry's `index.ts`,
// never by a declaration file (that would close an import cycle).
// =============================================================================

// Packages that contribute settings call `registerSettingsContribution` from a
// side-effect import listed here; it runs BEFORE the assembly below.
import '../../app-registrations/settings-contributions';
import {
  APP_SYSTEM_SETTINGS_DEFAULT_OVERRIDES,
  APP_SYSTEM_SETTINGS_EXTENSIONS,
  APP_SYSTEM_SETTINGS_NAMESPACES,
} from '../../app-registrations/settings';
import { AI_SYSTEM_SETTINGS } from '@marinoscar/platform-api/ai';
import { MAINTENANCE_SYSTEM_SETTINGS } from '@marinoscar/platform-api/host';
import { DATABASE_BACKUP_SYSTEM_SETTINGS } from '@marinoscar/platform-api/db-backup';
import { JOBS_SYSTEM_SETTINGS, RETENTION_SYSTEM_SETTINGS } from '@marinoscar/platform-api/jobs';
import { NODES_SYSTEM_SETTINGS } from '@marinoscar/platform-api/nodes';
import { NOTIFICATIONS_SYSTEM_SETTINGS } from '@marinoscar/platform-api/notifications';
import { STORAGE_SYSTEM_SETTINGS } from '../../platform/storage/storage.system-settings';
import { TELEMETRY_SYSTEM_SETTINGS } from '../../platform/telemetry/telemetry.system-settings';
import {
  assembleSystemSettingsNamespaces,
  registerSystemSettingsNamespaces,
  type SystemSettingsNamespace,
} from '@marinoscar/platform-api/settings';

const PLATFORM_NAMESPACES: readonly SystemSettingsNamespace[] = [
  NOTIFICATIONS_SYSTEM_SETTINGS as SystemSettingsNamespace,
  JOBS_SYSTEM_SETTINGS,
  NODES_SYSTEM_SETTINGS,
  DATABASE_BACKUP_SYSTEM_SETTINGS,
  MAINTENANCE_SYSTEM_SETTINGS,
  STORAGE_SYSTEM_SETTINGS,
  AI_SYSTEM_SETTINGS,
  TELEMETRY_SYSTEM_SETTINGS,
  RETENTION_SYSTEM_SETTINGS,
];

// One assembly, in a documented order (the package README, "Contributions"):
// the platform's namespaces, then the contributions' (import order), then the
// app's own; extensions fold into the namespaces they name (the
// contributions', then the app's); defaults overrides apply last. A key that
// two of them declare fails at import time naming both owners.
registerSystemSettingsNamespaces(
  assembleSystemSettingsNamespaces({
    platform: PLATFORM_NAMESPACES,
    app: APP_SYSTEM_SETTINGS_NAMESPACES,
    appExtensions: APP_SYSTEM_SETTINGS_EXTENSIONS,
    appDefaults: APP_SYSTEM_SETTINGS_DEFAULT_OVERRIDES,
  }),
);
