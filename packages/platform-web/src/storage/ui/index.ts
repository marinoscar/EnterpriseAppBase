// `@marinoscar/platform-web/storage/ui`: the `/admin/settings/storage` page
// and its switch-confirmation dialog (issue #736, PP-8.3). The page is the
// default and a named export, so the app keeps
// `lazy(() => import('@marinoscar/platform-web/storage/ui'))` and the page
// stays in a chunk of its own. Documented in ../README.md.

export { default, default as StorageConfigPage } from './StorageConfigPage.js';
export { StorageSwitchConfirmDialog } from './StorageSwitchConfirmDialog.js';
export type { StorageSwitchConfirmDialogProps } from './StorageSwitchConfirmDialog.js';
