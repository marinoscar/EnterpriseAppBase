// =============================================================================
// The nodes slice's object store, bound to storage (issue #736)
// =============================================================================
//
// The nodes slice signs a GET and a PUT for a held job's input and output
// through its own `NODE_OBJECT_STORE` port, because it sits below storage in
// the slice graph and cannot import it. This is the one binding every app
// that runs both slices writes, made once: put it in the `@Global()` host
// module the app passes to `NodesModule.forRoot({ imports })`, next to an
// import of `StorageProvidersModule`.
// =============================================================================

import type { ExistingProvider } from '@nestjs/common';

import { NODE_OBJECT_STORE, type NodeObjectStore } from '../nodes/index';
import { STORAGE_PROVIDER, type StorageProvider } from './providers/storage-provider.interface';

/**
 * `true` while {@link StorageProvider} is assignable to the nodes slice's
 * `NodeObjectStore`, `never` otherwise (and the proof below stops compiling).
 *
 * @stability experimental
 */
export type StorageProviderIsNodeObjectStore = StorageProvider extends NodeObjectStore ? true : never;

/** The compile-time proof. */
const STORAGE_PROVIDER_IS_NODE_OBJECT_STORE: StorageProviderIsNodeObjectStore = true;
void STORAGE_PROVIDER_IS_NODE_OBJECT_STORE;

/**
 * `{ provide: NODE_OBJECT_STORE, useExisting: STORAGE_PROVIDER }`: the nodes
 * slice's signed GET and PUT go through the app's storage provider. The
 * module providing it must also import `StorageProvidersModule` (or provide
 * `STORAGE_PROVIDER` itself).
 *
 * @example
 * ```ts
 * @Global()
 * @Module({ imports: [StorageProvidersModule], providers: [nodeObjectStoreBinding], exports: [NODE_OBJECT_STORE] })
 * export class JobsHostModule {}
 * ```
 *
 * @extensionPoint token
 * @stability experimental
 */
export const nodeObjectStoreBinding: ExistingProvider<StorageProvider> = Object.freeze({
  provide: NODE_OBJECT_STORE,
  useExisting: STORAGE_PROVIDER,
});
