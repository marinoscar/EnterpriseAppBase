// `@marinoscar/platform-web/storage/ui/driver-panels`: the storage driver panel
// registry (PP-14.7, issue #925), alone, so an app registers a panel from its
// main chunk without pulling the storage page in. Also exported by
// `/storage/ui`. Documented in ../README.md.

export { registerStorageDriverPanel, getStorageDriverPanel } from './storageDriverPanelRegistry.js';
export type {
  StorageDriverPanelComponent,
  StorageDriverPanelOptions,
  StorageDriverPanelProps,
} from './storageDriverPanelRegistry.js';
export { StorageGenericDriverPanel } from './StorageGenericDriverPanel.js';
