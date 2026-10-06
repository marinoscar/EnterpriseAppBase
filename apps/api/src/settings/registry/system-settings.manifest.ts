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

import { APP_SYSTEM_SETTINGS_NAMESPACES } from '../../app-registrations/settings';
import { AI_SYSTEM_SETTINGS } from '../../ai/ai.system-settings';
import { MAINTENANCE_SYSTEM_SETTINGS } from '../../common/maintenance/maintenance.system-settings';
import { RETENTION_SYSTEM_SETTINGS } from '../../common/retention/retention.system-settings';
import { DATABASE_BACKUP_SYSTEM_SETTINGS } from '../../db-backup/db-backup.system-settings';
import { JOBS_SYSTEM_SETTINGS } from '../../jobs/jobs.system-settings';
import { NODES_SYSTEM_SETTINGS } from '../../nodes/nodes.system-settings';
import { NOTIFICATIONS_SYSTEM_SETTINGS } from '../../notifications/notifications.system-settings';
import { STORAGE_SYSTEM_SETTINGS } from '../../storage/config/storage.system-settings';
import { TELEMETRY_SYSTEM_SETTINGS } from '../../telemetry/telemetry.system-settings';
import { registerSystemSettingsNamespaces } from './system-settings-namespace';

registerSystemSettingsNamespaces([
  NOTIFICATIONS_SYSTEM_SETTINGS,
  JOBS_SYSTEM_SETTINGS,
  NODES_SYSTEM_SETTINGS,
  DATABASE_BACKUP_SYSTEM_SETTINGS,
  MAINTENANCE_SYSTEM_SETTINGS,
  STORAGE_SYSTEM_SETTINGS,
  AI_SYSTEM_SETTINGS,
  TELEMETRY_SYSTEM_SETTINGS,
  RETENTION_SYSTEM_SETTINGS,
]);

// App-owned namespaces last, so a collision with a platform key names the app.
registerSystemSettingsNamespaces(APP_SYSTEM_SETTINGS_NAMESPACES);
