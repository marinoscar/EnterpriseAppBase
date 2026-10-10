// =============================================================================
// The jobs slice's app adapters (issue #854)
// =============================================================================
//
// What the Jobs, Job Insights and Worker Nodes pages need from the app beyond
// the platform host: the app's spinner and table (the app owns appearance),
// and optionally the app's own jobs client. The identity slice's
// `IdentityWebAdaptersProvider` is the model.
//
// Without a provider every adapter has a default: an MUI spinner, a plain MUI
// table, and `createJobsApi(host.api)`.
// =============================================================================

import { createContext, useContext, useMemo } from 'react';
import type { ComponentType, ReactElement, ReactNode } from 'react';

import { useOptionalPlatformHost } from '../../core/index.js';
import { NodesWebAdaptersProvider, useNodesWebAdapters } from '../../nodes/index.js';
import type { NodesWebAdapters } from '../../nodes/index.js';
import { createJobsApi } from './api.js';
import type { JobsApi } from './api.js';
import type { JobsDataTableComponent } from './table.js';

/**
 * What {@link JobsWebAdapters.Spinner} takes.
 *
 * @stability experimental
 */
export interface JobsSpinnerProps {
  /** A whole-page wait. The jobs pages never ask for one. */
  fullScreen?: boolean;
}

/**
 * What the jobs pages take from the app. Every member is optional; keep the
 * object a module constant.
 *
 * @example
 * ```ts
 * // apps/web/src/platform/jobsAdapters.ts
 * export const appJobsAdapters: JobsWebAdapters = {
 *   Spinner: LoadingSpinner,
 *   DataTable,
 *   api: createJobsApi(appPlatformApi),
 * };
 * ```
 *
 * @extensionPoint option
 * @stability experimental
 */
export interface JobsWebAdapters {
  /** The app's loading spinner. Default an MUI `CircularProgress`. */
  Spinner?: ComponentType<JobsSpinnerProps>;
  /** The app's table for the job, insights, fleet and credential lists. Default a plain MUI table. */
  DataTable?: JobsDataTableComponent;
  /** The jobs calls. Default `createJobsApi(usePlatformApi())`. */
  api?: JobsApi;
}

const NO_ADAPTERS: JobsWebAdapters = Object.freeze({});

const JobsWebAdaptersContext = createContext<JobsWebAdapters>(NO_ADAPTERS);
JobsWebAdaptersContext.displayName = 'JobsWebAdaptersContext';

/**
 * Hands the app's {@link JobsWebAdapters} to every jobs page below it. Mount
 * it once, around the signed-in shell.
 *
 * @param props - `adapters`: the app's adapters (a module constant); `children`: the routed tree.
 * @returns the provider element.
 *
 * @example
 * ```tsx
 * <JobsWebAdaptersProvider adapters={appJobsAdapters}>{shell}</JobsWebAdaptersProvider>
 * ```
 *
 * @extensionPoint component
 * @stability experimental
 */
export function JobsWebAdaptersProvider(props: { adapters: JobsWebAdapters; children: ReactNode }): ReactElement {
  const { adapters } = props;
  // The Worker Nodes page lives in `@marinoscar/platform-web/nodes` (#881) and
  // reads `NodesWebAdapters`. Handing it the same spinner, table and client
  // keeps an app that only wired the jobs adapters unchanged; a
  // `NodesWebAdaptersProvider` the app mounted above this one still wins.
  const outer = useNodesWebAdapters();
  const nodesAdapters = useMemo<NodesWebAdapters>(
    () => ({
      ...(adapters.Spinner ? { Spinner: adapters.Spinner } : {}),
      ...(adapters.DataTable ? { DataTable: adapters.DataTable } : {}),
      ...(adapters.api ? { api: adapters.api } : {}),
      ...outer,
    }),
    [adapters, outer],
  );
  return (
    <JobsWebAdaptersContext.Provider value={adapters}>
      <NodesWebAdaptersProvider adapters={nodesAdapters}>{props.children}</NodesWebAdaptersProvider>
    </JobsWebAdaptersContext.Provider>
  );
}

/**
 * The adapters in context (an empty object without a provider).
 *
 * @returns the app's jobs adapters.
 *
 * @stability experimental
 */
export function useJobsWebAdapters(): JobsWebAdapters {
  return useContext(JobsWebAdaptersContext);
}

/**
 * The jobs client the hooks use: `explicit` when given, else the adapters'
 * `api`, else `createJobsApi` over the platform host's transport.
 *
 * @param explicit - a client to use instead (keep its identity stable).
 * @returns the client.
 * @throws Error when none of the three is available.
 *
 * @stability experimental
 */
export function useJobsApi(explicit?: JobsApi): JobsApi {
  const adapters = useJobsWebAdapters();
  const hostApi = useOptionalPlatformHost()?.api;
  const fromHost = useMemo(() => (hostApi ? createJobsApi(hostApi) : null), [hostApi]);
  const api = explicit ?? adapters.api ?? fromHost;
  if (!api) {
    throw new Error(
      'useJobsApi: no jobs client. Mount PlatformHostProvider (@marinoscar/platform-web/core) or ' +
        'JobsWebAdaptersProvider with an `api`, or pass a client to the hook.',
    );
  }
  return api;
}
