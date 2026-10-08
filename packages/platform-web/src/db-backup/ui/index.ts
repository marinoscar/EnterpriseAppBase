// `@marinoscar/platform-web/db-backup/ui`: the `/admin/settings/db-backup`
// page, its policy panel and its restore/rollback dialog, and the admin
// registry entry as data (issue #740, PP-8.7). The page is the default and a
// named export, so the app keeps
// `lazy(() => import('@marinoscar/platform-web/db-backup/ui'))` and the page
// stays in a chunk of its own. Built on `/db-backup/headless`. Documented in
// ../README.md. Explicit named exports only.

export { default, default as DbBackupPage } from './DbBackupPage.js';
export { DbBackupConfigPanel } from './DbBackupConfigPanel.js';
export type { DbBackupConfigPanelProps } from './DbBackupConfigPanel.js';
export { DbBackupRestoreDialog } from './DbBackupRestoreDialog.js';
export type { DbBackupRestoreDialogProps, RestoreDialogIntent } from './DbBackupRestoreDialog.js';
export { dbBackupAdminSections } from './settings.js';
export type { DbBackupSettingsCard } from './settings.js';
export { DB_BACKUP_PAGE_DESCRIPTION, DB_BACKUP_PAGE_TITLE } from './copy.js';
