import { createContext, useContext, useMemo } from 'react';
import type { ReactElement, ReactNode } from 'react';

import { useOptionalPlatformHost } from '../../../core/index.js';
import type { PlatformApiClient } from '../../../core/index.js';
import type { DataTableStoredLayout } from './layoutModel.js';

/**
 * Where a table's layout preferences (visible columns, density, sort, page
 * size) are kept between visits.
 *
 * The default is the user-settings API, reached through the host's transport
 * ({@link createUserSettingsPreferencesPort}); an app that keeps them somewhere
 * else (browser storage, a different endpoint) supplies its own through
 * {@link DataTablePreferencesProvider}. Both methods may reject: the table
 * treats persistence as a best-effort backup of what is on screen.
 *
 * @stability experimental
 */
export interface DataTablePreferencesPort {
  /**
   * Reads the whole stored namespace, keyed by table id. Resolves to `null` or
   * `undefined` when nothing is stored. The value is untrusted JSON: the table
   * narrows it defensively before use.
   */
  load(): Promise<Readonly<Record<string, unknown>> | null | undefined>;
  /**
   * Stores one table's COMPLETE entry (it replaces the stored one wholesale),
   * or deletes it when `entry` is `null`.
   */
  save(tableId: string, entry: DataTableStoredLayout | null): Promise<unknown>;
}

/**
 * The port over the platform's user-settings routes: `GET /user-settings`
 * (the `dataTables` namespace) and `PATCH /user-settings` with
 * `{ dataTables: { [tableId]: entry | null } }`.
 *
 * The PATCH carries no `If-Match`: the write is a fire-and-forget backup that
 * touches one key of one namespace, and the server merges per table, so a
 * version check would only fail on an unrelated concurrent write.
 *
 * @param api - the host's transport (`usePlatformApi()`).
 * @returns a port over the user-settings API.
 *
 * @example
 * ```tsx
 * <DataTablePreferencesProvider port={createUserSettingsPreferencesPort(api)}>
 *   <Page />
 * </DataTablePreferencesProvider>
 * ```
 *
 * @extensionPoint option
 * @stability experimental
 */
export function createUserSettingsPreferencesPort(api: PlatformApiClient): DataTablePreferencesPort {
  return {
    async load() {
      const settings = await api.get<{ dataTables?: Record<string, unknown> | null } | null | undefined>('/user-settings');
      return settings?.dataTables;
    },
    save: (tableId, entry) => api.patch('/user-settings', { dataTables: { [tableId]: entry } }),
  };
}

const PreferencesContext = createContext<DataTablePreferencesPort | null>(null);
PreferencesContext.displayName = 'DataTablePreferencesContext';

/**
 * Supplies the {@link DataTablePreferencesPort} to every `DataTable` below it,
 * instead of the default user-settings port. Keep `port`'s identity stable.
 *
 * @param props - `port`: where layouts are kept; `children`: the tree.
 * @returns the provider element.
 *
 * @extensionPoint option
 * @stability experimental
 */
export function DataTablePreferencesProvider(props: {
  port: DataTablePreferencesPort;
  children: ReactNode;
}): ReactElement {
  return <PreferencesContext.Provider value={props.port}>{props.children}</PreferencesContext.Provider>;
}

/**
 * The port in force: the one a {@link DataTablePreferencesProvider} supplies,
 * else the user-settings port over the host's transport, else `null`
 * (preferences stay in-session only).
 *
 * @returns the port, or `null` when there is nowhere to keep preferences.
 *
 * @stability experimental
 */
export function useDataTablePreferencesPort(): DataTablePreferencesPort | null {
  const supplied = useContext(PreferencesContext);
  const host = useOptionalPlatformHost();
  const api = host?.api;
  return useMemo(() => supplied ?? (api ? createUserSettingsPreferencesPort(api) : null), [supplied, api]);
}
