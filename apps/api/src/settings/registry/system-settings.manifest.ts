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

import {
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
  extendSystemSettingsNamespace,
  foldSettingsExtensions,
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

// The app's extensions fold into the namespaces they name (platform or app)
// before anything is registered.
const { platform, app } = foldSettingsExtensions(
  { platform: PLATFORM_NAMESPACES, app: APP_SYSTEM_SETTINGS_NAMESPACES },
  APP_SYSTEM_SETTINGS_EXTENSIONS,
  extendSystemSettingsNamespace,
  'system settings',
);

registerSystemSettingsNamespaces(platform);

// App-owned namespaces last, so a collision with a platform key names the app.
registerSystemSettingsNamespaces(app);
