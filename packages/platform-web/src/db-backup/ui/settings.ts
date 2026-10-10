// The db-backup admin card as data (issue #740): the reference app spreads it
// into its Operations section, at the position the card always had, so the
// hub, the Console rail and the AppBar title resolve
// `/admin/settings/db-backup` as before.

import BackupOutlinedIcon from '@mui/icons-material/BackupOutlined';

import type { PlatformSettingsPage } from '../../core/index.js';
import { DB_BACKUP_PAGE_DESCRIPTION, DB_BACKUP_PAGE_TITLE } from './copy.js';

/**
 * The db-backup registry card: the `PlatformSettingsPage` card shape plus its
 * icon, structurally a `SettingsCardDef` of the reference app. Never
 * feature-gated, so it is assignable to any app's card type.
 *
 * @stability experimental
 */
export type DbBackupSettingsCard = PlatformSettingsPage<never>['card'] & {
  /** The card and rail icon (an MUI SvgIcon). */
  Icon: PlatformSettingsPage['Icon'];
};

/**
 * The db-backup admin card, by the admin section it belongs to:
 *
 * - `operations`: `Database Backup` (`/admin/settings/db-backup`,
 *   `db_backup:read`, the exact string `DatabaseBackupController` enforces on
 *   its reads). Writes need `db_backup:write` and restoring
 *   `db_backup:restore`; the PAGE gates both by disabling its controls, the
 *   card gate is about reachability.
 *
 * @example
 * ```tsx
 * // apps/web/src/config/adminSections.tsx
 * { label: 'Operations', cards: [...jobsAdminSections.operations, ...dbBackupAdminSections.operations, broadcastsCard] },
 * ```
 *
 * @extensionPoint component
 * @stability experimental
 */
export const dbBackupAdminSections: {
  /** The Operations section's card. */
  readonly operations: readonly DbBackupSettingsCard[];
} = Object.freeze({
  operations: Object.freeze([
    {
      title: DB_BACKUP_PAGE_TITLE,
      description: DB_BACKUP_PAGE_DESCRIPTION,
      Icon: BackupOutlinedIcon,
      path: '/admin/settings/db-backup',
      permission: 'db_backup:read',
    },
  ]),
});
