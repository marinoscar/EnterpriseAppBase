// =============================================================================
// The nodes slice's app adapters (issue #881)
// =============================================================================
//
// What the Worker Nodes page needs from the app beyond the platform host: the
// app's spinner and table (the app owns appearance), and optionally the app's
// own nodes client. `JobsWebAdaptersProvider` (the jobs slice) mounts this one
// for its subtree, so an app that wired the jobs adapters needs nothing more. The identity
// slice's `IdentityWebAdaptersProvider` is the model.
//
// Without a provider every adapter has a default: an MUI spinner, a plain MUI
// table, and `createNodesApi(host.api)`.
// =============================================================================

import { createContext, useContext, useMemo } from 'react';
import type { ComponentType, ReactElement, ReactNode } from 'react';

import { useOptionalPlatformHost } from '../../core/index.js';
import { createNodesApi } from './api.js';
import type { NodesApi } from './api.js';
import type { NodesDataTableComponent } from './table.js';

/**
 * What {@link NodesWebAdapters.Spinner} takes.
 *
 * @stability experimental
 */
export interface NodesSpinnerProps {
  /** A whole-page wait. The nodes page never asks for one. */
  fullScreen?: boolean;
}

/**
 * What the Worker Nodes page takes from the app. Every member is optional; keep the
 * object a module constant.
 *
 * @example
 * ```ts
 * // apps/web/src/platform/nodesAdapters.ts
 * export const appNodesAdapters: NodesWebAdapters = {
 *   Spinner: LoadingSpinner,
 *   DataTable,
 *   api: createNodesApi(appPlatformApi),
 * };
 * ```
 *
 * @extensionPoint option
 * @stability experimental
 */
export interface NodesWebAdapters {
  /** The app's loading spinner. Default an MUI `CircularProgress`. */
  Spinner?: ComponentType<NodesSpinnerProps>;
  /** The app's table for the fleet and credential lists. Default a plain MUI table. */
  DataTable?: NodesDataTableComponent;
  /** The nodes calls. Default `createNodesApi(usePlatformApi())`. */
  api?: NodesApi;
}

const NO_ADAPTERS: NodesWebAdapters = Object.freeze({});

const NodesWebAdaptersContext = createContext<NodesWebAdapters>(NO_ADAPTERS);
NodesWebAdaptersContext.displayName = 'NodesWebAdaptersContext';

/**
 * Hands the app's {@link NodesWebAdapters} to the Worker Nodes page below it. Mount
 * it once, around the signed-in shell.
 *
 * @param props - `adapters`: the app's adapters (a module constant); `children`: the routed tree.
 * @returns the provider element.
 *
 * @example
 * ```tsx
 * <NodesWebAdaptersProvider adapters={appNodesAdapters}>{shell}</NodesWebAdaptersProvider>
 * ```
 *
 * @extensionPoint component
 * @stability experimental
 */
export function NodesWebAdaptersProvider(props: { adapters: NodesWebAdapters; children: ReactNode }): ReactElement {
  return <NodesWebAdaptersContext.Provider value={props.adapters}>{props.children}</NodesWebAdaptersContext.Provider>;
}

/**
 * The adapters in context (an empty object without a provider).
 *
 * @returns the app's nodes adapters.
 *
 * @stability experimental
 */
export function useNodesWebAdapters(): NodesWebAdapters {
  return useContext(NodesWebAdaptersContext);
}

/**
 * The nodes client the hooks use: `explicit` when given, else the adapters'
 * `api`, else `createNodesApi` over the platform host's transport.
 *
 * @param explicit - a client to use instead (keep its identity stable).
 * @returns the client.
 * @throws Error when none of the three is available.
 *
 * @stability experimental
 */
export function useNodesApi(explicit?: NodesApi): NodesApi {
  const adapters = useNodesWebAdapters();
  const hostApi = useOptionalPlatformHost()?.api;
  const fromHost = useMemo(() => (hostApi ? createNodesApi(hostApi) : null), [hostApi]);
  const api = explicit ?? adapters.api ?? fromHost;
  if (!api) {
    throw new Error(
      'useNodesApi: no nodes client. Mount PlatformHostProvider (@marinoscar/platform-web/core) or ' +
        'NodesWebAdaptersProvider with an `api`, or pass a client to the hook.',
    );
  }
  return api;
}
