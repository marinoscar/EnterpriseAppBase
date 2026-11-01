// The storage slice's entry point for SIBLING SLICES of this package (issue
// #890): the boundary lint lets one slice import another only through the
// other's `index.ts`, and only when packages/platform-slices.json lists the
// dependency (ai -> storage). Not a package subpath: apps import
// `@marinoscar/platform-web/storage/headless` and `/storage/ui`. Narrow on
// purpose: only what a sibling uses (the objects client).

export { StorageObjectNotReadyError, createStorageObjectsClient } from './headless/index.js';
export type { StorageObject, StorageObjectsClient, WaitForReadyOptions } from './headless/index.js';
