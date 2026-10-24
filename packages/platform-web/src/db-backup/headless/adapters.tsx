// =============================================================================
// The db-backup slice's app adapters (issue #740)
// =============================================================================
//
// What the db-backup page needs from the app beyond the platform host: the
// app's table (the app owns appearance), and optionally the app's own
// db-backup client. The jobs slice's `JobsWebAdaptersProvider` is the model.
//
// Without a provider every adapter has a default: a plain MUI table, and
// `createDbBackupApi(host.api)`.
// =============================================================================

import { createContext, useContext } from 'react';
import type { ReactElement, ReactNode } from 'react';

import type { DbBackupApi } from './db-backup-client.js';
import type { DbBackupDataTableComponent } from './table.js';

/**
 * What the db-backup page takes from the app. Every member is optional; keep
 * the object a module constant.
 *
 * @example
 * ```ts
 * // apps/web/src/platform/dbBackupAdapters.ts
 * export const appDbBackupAdapters: DbBackupWebAdapters = { DataTable };
 * ```
 *
 * @extensionPoint option
 * @stability experimental
 */
export interface DbBackupWebAdapters {
  /** The app's table for the run list. Default a plain MUI table. */
  DataTable?: DbBackupDataTableComponent;
  /** The db-backup calls. Default `createDbBackupApi(usePlatformApi())`. */
  api?: DbBackupApi;
}

const NO_ADAPTERS: DbBackupWebAdapters = Object.freeze({});

const DbBackupWebAdaptersContext = createContext<DbBackupWebAdapters>(NO_ADAPTERS);
DbBackupWebAdaptersContext.displayName = 'DbBackupWebAdaptersContext';

/**
 * Hands the app's {@link DbBackupWebAdapters} to the db-backup page below it.
 * Mount it once, around the signed-in shell.
 *
 * @param props - `adapters`: the app's adapters (a module constant); `children`: the routed tree.
 * @returns the provider element.
 *
 * @example
 * ```tsx
 * <DbBackupWebAdaptersProvider adapters={appDbBackupAdapters}>{shell}</DbBackupWebAdaptersProvider>
 * ```
 *
 * @extensionPoint component
 * @stability experimental
 */
export function DbBackupWebAdaptersProvider(props: { adapters: DbBackupWebAdapters; children: ReactNode }): ReactElement {
  return <DbBackupWebAdaptersContext.Provider value={props.adapters}>{props.children}</DbBackupWebAdaptersContext.Provider>;
}

/**
 * The adapters in context (an empty object without a provider).
 *
 * @returns the app's db-backup adapters.
 *
 * @stability experimental
 */
export function useDbBackupWebAdapters(): DbBackupWebAdapters {
  return useContext(DbBackupWebAdaptersContext);
}
