/**
 * The job queue's list, its summary, and the five writes (issue #266, epic #254;
 * moved into `@marinoscar/platform-web/jobs` by #854 from the reference app's
 * `hooks/useJobs.ts`, behaviour unchanged).
 *
 * Three exports, one file, because they are three views of one surface and the
 * page mounts all three together — the same reasoning `useMaintenance.ts` gives
 * for holding two hooks that share no state. What they genuinely share is the
 * contract: every function resolves rather than throws, and a failure is a
 * STRING the page renders, because every caller is a click handler that needs
 * to branch, not a place to handle an exception that has already been captured
 * for display.
 *
 * =============================================================================
 * `useVisiblePolling` — RE-EXPORTED, NOT DEFINED HERE
 * =============================================================================
 *
 * The jobs page polls, because a queue is one of the two admin surfaces whose
 * contents change with nobody touching it. The hook lives in
 * `use-visible-polling.ts`, whose header keeps the full rationale — why the
 * interval is torn down while the tab is hidden, and why returning to it
 * fetches immediately rather than waiting out a period. The pages take it from
 * the headless entry, which is what keeps a page test that mocks
 * `@marinoscar/platform-web/jobs/headless` in control of the poll.
 *
 * Every hook takes an optional {@link JobsApi}; without one it uses the jobs
 * adapters' client or `createJobsApi` over the platform host's transport.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { isPlatformApiError } from '../../core/index.js';
import { useIsMounted } from '../internal/use-is-mounted.js';
import { useJobsApi } from './adapters.js';
import type { JobsApi } from './api.js';
import type { Job, JobListParams, JobStats, ResetStuckResult, RetryFailedResult } from './types.js';

/**
 * How often the jobs page re-asks, while its tab is in front.
 *
 * Ten seconds is chosen against what the data actually does: `GET /stats` is
 * cached in-process for about two seconds, so a shorter poll would return the
 * same cached numbers and buy only load, while a job that takes tens of seconds
 * is not observed any better by asking three times as often.
 *
 * @stability experimental
 */
export const JOBS_POLL_INTERVAL_MS = 10_000;

/** Turn any thrown value into the sentence the page will render. */
function messageFor(err: unknown, fallback: string): string {
  if (isPlatformApiError(err)) {
    // 403 is named explicitly because its remedy is a permission rather than a
    // retry — the same treatment `useMaintenance` and `useEmailSettings` give it.
    if (err.status === 403) return 'You do not have permission to manage jobs';
    return err.message;
  }
  return fallback;
}

// =============================================================================
// The list
// =============================================================================

/**
 * What {@link useJobs} returns.
 *
 * @stability experimental
 */
export interface UseJobsResult {
  /** This page's rows, newest first; emptied on an error. */
  jobs: Job[];
  /** Rows across all pages. */
  total: number;
  /** A query (not a poll) is in flight. */
  isLoading: boolean;
  /** The last failure as a sentence, or `null`. */
  error: string | null;
  /** Run a query, and remember it so `refresh` can repeat it. */
  fetchJobs: (params?: JobListParams) => Promise<void>;
  /** Re-run the last query `fetchJobs` was given. What the poll calls. */
  refresh: () => Promise<void>;
}

/**
 * The job list, `GET /api/admin/jobs`. Fetches nothing on mount: the caller
 * runs `fetchJobs(params)` (filters, the activity window, the page, `orgId`)
 * and `refresh` repeats the last query without raising the loading flag.
 *
 * @param api - a client to use instead of the adapters' or the host's.
 * @returns the rows, the total, the state and the two fetchers.
 *
 * @example
 * ```tsx
 * const { jobs, total, fetchJobs } = useJobs();
 * useEffect(() => { void fetchJobs({ orgId, status: 'failed', pageSize: 1 }); }, [fetchJobs, orgId]);
 * ```
 *
 * @extensionPoint hook
 * @stability experimental
 */
export function useJobs(api?: JobsApi): UseJobsResult {
  const client = useJobsApi(api);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Every `setState` past an `await` is guarded: a request that settles after
  // the component is gone must not schedule an update on it.
  const isMounted = useIsMounted();

  /**
   * The last query, so a poll repeats the CURRENT view rather than an unfiltered
   * one. A ref and not state: a re-render on every query would be a re-render
   * that changes nothing on screen, and the value is only ever read from inside
   * a callback.
   */
  const lastParams = useRef<JobListParams>({});

  const runQuery = useCallback(
    async (params: JobListParams, showLoading: boolean) => {
      // A POLL DOES NOT RAISE THE LOADING FLAG. The rows stay on screen and the
      // table keeps its scroll offset, its expansion and its focus; a spinner
      // every ten seconds over data that is already correct is the fastest way
      // to make a live table unusable.
      if (showLoading) setIsLoading(true);
      setError(null);
      try {
        const response = await client.getJobs(params);
        if (isMounted()) {
          setJobs(response.items);
          setTotal(response.total);
        }
      } catch (err) {
        if (isMounted()) {
          setError(messageFor(err, 'Failed to load jobs'));
          // Cleared, not left standing: rows from the previous successful query
          // under an error banner read as the current state of the queue.
          setJobs([]);
          setTotal(0);
        }
      } finally {
        if (isMounted() && showLoading) setIsLoading(false);
      }
    },
    [client, isMounted],
  );

  const fetchJobs = useCallback(
    async (params: JobListParams = {}) => {
      lastParams.current = params;
      await runQuery(params, true);
    },
    [runQuery],
  );

  const refresh = useCallback(async () => {
    await runQuery(lastParams.current, false);
  }, [runQuery]);

  return { jobs, total, isLoading, error, fetchJobs, refresh };
}

// =============================================================================
// The summary
// =============================================================================

/**
 * What {@link useJobStats} returns.
 *
 * @stability experimental
 */
export interface UseJobStatsResult {
  /** The summary, or `null` before the first answer; kept on screen under a later error. */
  stats: JobStats | null;
  /** The first read is in flight. */
  isLoading: boolean;
  /** The last failure as a sentence, or `null`. */
  error: string | null;
  /** Re-read without raising the loading flag. */
  refresh: () => Promise<void>;
}

/**
 * `GET /api/admin/jobs/stats`, on its own hook because it is on its own
 * request: the strip above the table summarises the WHOLE queue, not the page
 * of rows below it, so it neither takes the list's filters nor reloads when
 * they change.
 *
 * @param api - a client to use instead of the adapters' or the host's.
 * @returns the summary and its state.
 *
 * @extensionPoint hook
 * @stability experimental
 */
export function useJobStats(api?: JobsApi): UseJobStatsResult {
  const client = useJobsApi(api);
  const [stats, setStats] = useState<JobStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isMounted = useIsMounted();

  const load = useCallback(
    async (showLoading: boolean) => {
      if (showLoading) setIsLoading(true);
      try {
        const data = await client.getJobStats();
        if (isMounted()) {
          setStats(data);
          setError(null);
        }
      } catch (err) {
        // The PREVIOUS stats are kept on screen under the error, unlike the
        // list above. A summary strip that empties on one failed poll makes a
        // transient error look like a queue that just drained to zero.
        if (isMounted()) setError(messageFor(err, 'Failed to load queue statistics'));
      } finally {
        if (isMounted() && showLoading) setIsLoading(false);
      }
    },
    [client, isMounted],
  );

  useEffect(() => {
    void load(true);
  }, [load]);

  const refresh = useCallback(async () => {
    await load(false);
  }, [load]);

  return { stats, isLoading, error, refresh };
}

// =============================================================================
// The writes
// =============================================================================

/**
 * What {@link useJobActions} returns.
 *
 * @stability experimental
 */
export interface UseJobActionsResult {
  /** True while any one of the four writes is in flight. */
  isWorking: boolean;
  /** The last failure, or `null`. Cleared when a write starts. */
  error: string | null;
  /** Clears `error`. */
  clearError: () => void;
  /** Retries one job; `true` when the write landed. Never throws. */
  retry: (id: string) => Promise<boolean>;
  /** Deletes one job; `true` when the write landed. Never throws. */
  remove: (id: string) => Promise<boolean>;
  /** The queue-wide retry sweep's own counts, or `null` when it failed. */
  retryAllFailed: (type?: string) => Promise<RetryFailedResult | null>;
  /** The lease reaper on demand: its own counts, or `null` when it failed. */
  resetStuck: (olderThanMinutes?: number) => Promise<ResetStuckResult | null>;
}

/**
 * The four writes, sharing one in-flight flag and one error.
 *
 * ONE FLAG FOR ALL FOUR is deliberate. They all mutate the same queue and the
 * page re-reads it after any of them, so a second write started while the first
 * is landing would be issued against counts that are already wrong — and its
 * result would be reported over the top of the first one's. Disabling the whole
 * action set for the duration is the honest reading of "these are not
 * independent".
 *
 * @param onChanged - called after a write lands (the page re-reads the list and the summary).
 * @param api - a client to use instead of the adapters' or the host's.
 * @returns the four writes and their shared state.
 *
 * @extensionPoint hook
 * @stability experimental
 */
export function useJobActions(onChanged?: () => void, api?: JobsApi): UseJobActionsResult {
  const client = useJobsApi(api);
  const [isWorking, setIsWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isMounted = useIsMounted();

  // Held in a ref for the same reason `useVisiblePolling` holds its callback:
  // the page passes a fresh closure over the current filters on every render,
  // and depending on it would rebuild all four callbacks each time.
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;

  const run = useCallback(
    async <T,>(operation: () => Promise<T>, fallback: string): Promise<T | null> => {
      setIsWorking(true);
      setError(null);
      try {
        const result = await operation();
        // The queue changed, so whatever is on screen is now stale. Fired
        // AFTER the write resolves and never in parallel with it: a refresh
        // racing its own mutation is how a retried job flickers back to
        // `failed` for one frame.
        onChangedRef.current?.();
        return result;
      } catch (err) {
        if (isMounted()) setError(messageFor(err, fallback));
        return null;
      } finally {
        if (isMounted()) setIsWorking(false);
      }
    },
    [isMounted],
  );

  const retry = useCallback(
    async (id: string) => (await run(() => client.retryJob(id), 'Failed to retry job')) !== null,
    [run, client],
  );

  const remove = useCallback(
    async (id: string) =>
      (await run(async () => {
        await client.deleteJob(id);
        // `deleteJob` resolves `undefined` (the endpoint answers 204), and
        // `run` reports failure as `null` — so a literal is returned to keep
        // "succeeded" distinguishable from "failed".
        return true;
      }, 'Failed to delete job')) !== null,
    [run, client],
  );

  const retryAllFailed = useCallback(
    (type?: string) => run(() => client.retryFailedJobs(type), 'Failed to retry failed jobs'),
    [run, client],
  );

  const resetStuck = useCallback(
    (olderThanMinutes?: number) =>
      run(() => client.resetStuckJobs(olderThanMinutes), 'Failed to reset stuck jobs'),
    [run, client],
  );

  const clearError = useCallback(() => setError(null), []);

  return { isWorking, error, clearError, retry, remove, retryAllFailed, resetStuck };
}
