/**
 * Start, follow and cancel copy-only storage provider migrations (issue #1093).
 *
 * The house hook contract (`useStorageConfig`): every action resolves
 * `true`/`false` rather than throwing, the error is captured for rendering, and
 * every `setState` past an `await` is guarded by a mounted check.
 *
 * LIVE PROGRESS: while the newest run is pending or running the hook re-reads
 * the run history every `pollMs` (2 s by default) and stops as soon as no run
 * is active, so an idle page makes no requests.
 *
 * ⚠ A 409 ON START IS NOT A FAILURE TO DECODE: another run holds the one active
 * slot. The hook names it (`details.activeRunId`) and reloads the history so the
 * page shows that run's progress instead of an error.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { isPlatformApiError, useOptionalPlatformHost } from '../../core/index.js';
import type { PlatformApiClient } from '../../core/index.js';
import { createStorageMigrationsClient, isActiveStorageMigration } from './storage-migrations.js';
import type { StartStorageMigrationInput, StorageMigrationRun } from './storage-migrations.js';

/**
 * Options of {@link useStorageMigrations}.
 *
 * @stability experimental
 */
export interface UseStorageMigrationsOptions {
  /** The transport. Default: the `PlatformHostProvider`'s. */
  api?: PlatformApiClient;
  /** How often to re-read while a run is active, in ms. Default 2000. */
  pollMs?: number;
}

/**
 * What {@link useStorageMigrations} returns.
 *
 * @stability experimental
 */
export interface UseStorageMigrationsReturn {
  /** The newest runs (history), newest first. */
  runs: StorageMigrationRun[];
  /** The pending or running run, when there is one. */
  activeRun: StorageMigrationRun | null;
  /** Whether the first load is in flight. */
  isLoading: boolean;
  /** Failure to load the history. */
  loadError: string | null;
  /** Whether a start or cancel is in flight. */
  isWorking: boolean;
  /** Why the last start or cancel did not land. */
  actionError: string | null;
  /** Clears `actionError`. */
  clearActionError: () => void;
  /** Starts a run. Resolves `true` when it started. */
  start: (input: StartStorageMigrationInput) => Promise<boolean>;
  /** Cancels a run. Resolves `true` when it was cancelled. */
  cancel: (runId: string) => Promise<boolean>;
  /** Reloads the history. */
  refresh: () => Promise<void>;
}

function messageFor(err: unknown, fallback: string): string {
  if (isPlatformApiError(err)) {
    if (err.status === 403) return 'You do not have permission to manage storage migrations';
    return err.message || fallback;
  }
  return fallback;
}

/**
 * Loads the migration history, polls while a run is active, and starts or cancels runs (`storage_config:read` to load, `storage_config:write` to act).
 *
 * @param options - the transport and the poll interval.
 * @returns the runs, the flags and the actions.
 * @throws Error when there is neither a host nor an `api` option.
 *
 * @example
 * ```tsx
 * const { activeRun, start, cancel } = useStorageMigrations();
 * ```
 *
 * @extensionPoint hook
 * @stability experimental
 */
export function useStorageMigrations(options: UseStorageMigrationsOptions = {}): UseStorageMigrationsReturn {
  const host = useOptionalPlatformHost();
  const api = options.api ?? host?.api;
  if (!api) {
    throw new Error('useStorageMigrations needs a transport: mount PlatformHostProvider (@marinoscar/platform-web/core) or pass { api }.');
  }
  const pollMs = options.pollMs ?? 2000;
  const client = useMemo(() => createStorageMigrationsClient(api), [api]);

  const [runs, setRuns] = useState<StorageMigrationRun[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isWorking, setIsWorking] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const page = await client.list({ page: 1, pageSize: 10 });
      if (mounted.current) {
        setRuns(page.items);
        setLoadError(null);
      }
    } catch (err) {
      if (mounted.current) setLoadError(messageFor(err, 'Failed to load the storage migrations'));
    } finally {
      if (mounted.current) setIsLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const activeRun = runs.find((run) => isActiveStorageMigration(run)) ?? null;

  // Poll only while a run is active; the effect re-arms when that changes.
  useEffect(() => {
    if (!activeRun) return undefined;
    const timer = setInterval(() => void refresh(), pollMs);
    return () => clearInterval(timer);
  }, [activeRun?.id, pollMs, refresh]);

  const start = useCallback(
    async (input: StartStorageMigrationInput): Promise<boolean> => {
      try {
        setIsWorking(true);
        setActionError(null);
        await client.start(input);
        await refresh();
        return true;
      } catch (err) {
        if (isPlatformApiError(err) && err.status === 409) {
          const activeRunId = (err.details as { activeRunId?: string | null } | undefined)?.activeRunId ?? null;
          await refresh();
          if (mounted.current) {
            setActionError(
              `A storage migration is already in progress${activeRunId ? ` (run ${activeRunId})` : ''}; wait for it or cancel it first.`,
            );
          }
          return false;
        }
        if (mounted.current) setActionError(messageFor(err, 'The storage migration could not be started'));
        return false;
      } finally {
        if (mounted.current) setIsWorking(false);
      }
    },
    [client, refresh],
  );

  const cancel = useCallback(
    async (runId: string): Promise<boolean> => {
      try {
        setIsWorking(true);
        setActionError(null);
        await client.cancel(runId);
        await refresh();
        return true;
      } catch (err) {
        if (mounted.current) setActionError(messageFor(err, 'The storage migration could not be cancelled'));
        await refresh();
        return false;
      } finally {
        if (mounted.current) setIsWorking(false);
      }
    },
    [client, refresh],
  );

  const clearActionError = useCallback(() => setActionError(null), []);

  return { runs, activeRun, isLoading, loadError, isWorking, actionError, clearActionError, start, cancel, refresh };
}
