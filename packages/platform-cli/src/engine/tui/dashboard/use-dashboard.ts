import { useEffect, useSyncExternalStore } from 'react';

import type { DashboardConnection, DashboardSource } from './source.js';

/**
 * Subscribes a screen to a {@link DashboardSource}: starts it on mount, stops
 * it on unmount, and re-renders on every new state.
 *
 * The source is started and stopped by the hook, so build it once (in a
 * `useMemo` or a ref) and pass the same instance on every render. Stopping
 * on unmount is what keeps a reconnect timer or a poll from outliving the
 * screen and holding the ink process open.
 *
 * @typeParam S - The dashboard's data.
 * @typeParam E - One event.
 * @param source - The source to follow; `undefined` renders nothing and starts nothing.
 * @returns The current state (data plus connection fields), or `undefined` with no source.
 * @stability experimental
 * @example
 * ```tsx
 * const source = useMemo(() => new DashboardSource(jobsInsightsReducer, pollFeed(fetchJobs, { intervalMs: 5000 })), []);
 * const state = useDashboard(source);
 * ```
 */
export function useDashboard<S, E>(source: DashboardSource<S, E> | undefined): (S & DashboardConnection) | undefined {
  const state = useSyncExternalStore(
    (listener) => source?.subscribe(listener) ?? (() => {}),
    () => source?.getState(),
  );

  useEffect(() => {
    if (source === undefined) return;
    void source.start();
    return () => source.stop();
  }, [source]);

  return state;
}
