// `@marinoscar/platform-web/storage/ui`: the `/admin/settings/storage` page
// and its switch-confirmation dialog (issue #736, PP-8.3). The page is the
// default and a named export, so the app keeps
// `lazy(() => import('@marinoscar/platform-web/storage/ui'))` and the page
// stays in a chunk of its own. Also the storage driver panel registry (PP-14.7,
// #925): `registerStorageDriverPanel`, and the generic panel it falls back to.
// Documented in ../README.md.

export { default, default as StorageConfigPage } from './StorageConfigPage.js';
export { StorageSwitchConfirmDialog } from './StorageSwitchConfirmDialog.js';
export type { StorageSwitchConfirmDialogProps } from './StorageSwitchConfirmDialog.js';
export {
  StorageGenericDriverPanel,
  getStorageDriverPanel,
  registerStorageDriverPanel,
} from './driver-panels.js';
export type {
  StorageDriverPanelComponent,
  StorageDriverPanelOptions,
  StorageDriverPanelProps,
} from './driver-panels.js';
