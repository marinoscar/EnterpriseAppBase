// Start one destructive job and poll it until it settles (issue #743).

import { useCallback, useEffect, useRef, useState } from 'react';
import type { UserDataJobStarted, UserDataJobStatus } from '@marinoscar/platform-contract/user-data';

import { isPlatformApiError } from '../../core/index.js';

/**
 * Where a destructive job is: `idle` (not started), `running` (requested,
 * pending or running), `succeeded` or `failed`.
 *
 * @stability experimental
 */
export type DestructiveJobPhase = 'idle' | 'running' | 'succeeded' | 'failed';

/**
 * What a status route answers, as the hook needs it.
 *
 * @stability experimental
 */
export interface DestructiveJobStatus<TResult> {
  /** The job status. */
  status: UserDataJobStatus;
  /** The result, once succeeded. */
  result: TResult | null;
  /** The failure, once failed. */
  error: string | null;
}

/**
 * Options of {@link useDestructiveJob}.
 *
 * @stability experimental
 */
export interface UseDestructiveJobOptions<TResult> {
  /** Requests the job. */
  start(): Promise<UserDataJobStarted>;
  /** Reads its status. */
  poll(jobId: string): Promise<DestructiveJobStatus<TResult>>;
  /** Poll interval in milliseconds. Default 1500. */
  intervalMs?: number;
  /** Called once when the job succeeds (clear caches, refetch the profile). */
  onSucceeded?(result: TResult | null): void;
}

/**
 * The state {@link useDestructiveJob} returns.
 *
 * @stability experimental
 */
export interface UseDestructiveJobReturn<TResult> {
  /** See {@link DestructiveJobPhase}. */
  phase: DestructiveJobPhase;
  /** The job id, once requested. */
  jobId: string | null;
  /** The result, once succeeded. */
  result: TResult | null;
  /** The request or job failure, for display. */
  error: string | null;
  /** Requests the job and starts polling. */
  run(): Promise<void>;
  /** Back to `idle` (after a failure, to retry; after success, to close). */
  reset(): void;
}

/**
 * Starts a destructive job (`POST`) and polls its status route until it
 * succeeds or fails. A request error (a wrong phrase is a 400) lands in
 * `error` with phase `failed`.
 *
 * @param options - see {@link UseDestructiveJobOptions}.
 * @returns see {@link UseDestructiveJobReturn}.
 *
 * @stability experimental
 * @extensionPoint hook
 * @example
 * ```tsx
 * const job = useDestructiveJob({ start: () => client.request('FACTORY RESET'), poll: client.status });
 * ```
 */
export function useDestructiveJob<TResult>(options: UseDestructiveJobOptions<TResult>): UseDestructiveJobReturn<TResult> {
  const [phase, setPhase] = useState<DestructiveJobPhase>('idle');
  const [jobId, setJobId] = useState<string | null>(null);
  const [result, setResult] = useState<TResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(options);
  latest.current = options;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const pollOnce = useCallback(async (id: string) => {
    try {
      const status = await latest.current.poll(id);
      if (!alive.current) return;
      if (status.status === 'succeeded') {
        setResult(status.result);
        setPhase('succeeded');
        latest.current.onSucceeded?.(status.result);
        return;
      }
      if (status.status === 'failed') {
        setError(status.error ?? 'The job failed');
        setPhase('failed');
        return;
      }
    } catch (err) {
      // A transient read failure: keep polling, the job keeps running.
      if (isPlatformApiError(err) && err.status === 404) {
        setError(err.message);
        setPhase('failed');
        return;
      }
    }
    timer.current = setTimeout(() => void pollOnce(id), latest.current.intervalMs ?? 1500);
  }, []);

  const run = useCallback(async () => {
    setError(null);
    setResult(null);
    setPhase('running');
    try {
      const started = await latest.current.start();
      if (!alive.current) return;
      setJobId(started.jobId);
      await pollOnce(started.jobId);
    } catch (err) {
      if (!alive.current) return;
      setError(err instanceof Error || isPlatformApiError(err) ? (err as { message: string }).message : 'The request failed');
      setPhase('failed');
    }
  }, [pollOnce]);

  const reset = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setPhase('idle');
    setJobId(null);
    setResult(null);
    setError(null);
  }, []);

  return { phase, jobId, result, error, run, reset };
}
