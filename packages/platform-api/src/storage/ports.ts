// =============================================================================
// The storage slice's host ports (issue #736, PP-8.3)
// =============================================================================
//
// Every capability the slice needs from the application, as one injection
// token per capability. The slice injects these and never imports an app
// service; the app binds each token in a `@Global()` module of its own (the
// reference app: `apps/api/src/platform/storage/storage-host.module.ts`).
//
// The tenant database is the core port `PLATFORM_PRISMA`, seen as
// `StoragePrisma` (`data/storage-db.ts`).
//
// The tokens are `Symbol.for(...)` keys, so two copies of this file agree.
// =============================================================================

import type { SystemAccessReason } from '../core/index';
import type { StoragePrisma } from './data/storage-db';

/**
 * Injection token of the app's {@link StorageSystemData}: the bypass client.
 * REQUIRED by the four cross-organization paths (the stale-upload sweep, the
 * stranded-object count of the provider-switch gate, the public avatar route
 * and the avatar replacement across an org switch).
 *
 * The reference app binds its `PrismaSystemService` (a separate pool whose
 * every transaction sets `app.rls_bypass`); the binding file is on the
 * reviewed allowlist of `test/tenancy/system-injection-boundary.spec.ts`.
 *
 * @example
 * ```ts
 * // StorageHostModule: { provide: STORAGE_SYSTEM_DATA, useExisting: PrismaSystemService }
 * ```
 *
 * @extensionPoint token
 * @stability experimental
 */
export const STORAGE_SYSTEM_DATA: unique symbol = Symbol.for('@marinoscar/platform/storage/SYSTEM_DATA');

/**
 * The app's bypass client, as the storage slice uses it: one entry point,
 * `asSystem(reason)`, naming a closed `SystemAccessReason` that the app
 * records on the active span.
 *
 * @stability experimental
 */
export interface StorageSystemData {
  /**
   * A client whose every operation lifts row-level security for its own
   * transaction.
   *
   * @param reason - why (`'purge'`, `'admin-aggregate'`); recorded on the active span.
   * @returns the client, seen as {@link StoragePrisma}.
   */
  asSystem(reason: SystemAccessReason): Pick<StoragePrisma, 'storageObject' | 'storageObjectChunk'>;
}
