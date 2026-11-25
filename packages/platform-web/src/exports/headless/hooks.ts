import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { CreateExportInput, ExportSourceDescriptor, ExportView } from '@marinoscar/platform-contract/exports';

import { isPlatformApiError, usePlatformApi } from '../../core/index.js';
import { createExportsClient, isExportInProgress, type ExportsClient } from './client.js';

/**
 * How often an in-progress export is polled, by default: 3 seconds.
 *
 * @stability experimental
 */
export const DEFAULT_EXPORT_POLL_MS = 3000;

function messageOf(error: unknown, fallback: string): string {
  if (isPlatformApiError(error) && typeof error.message === 'string' && error.message !== '') return error.message;
  return fallback;
}

function useMounted(): () => boolean {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return useCallback(() => mounted.current, []);
}

/**
 * The exports client over the host's transport, memoised.
 *
 * @returns the client.
 *
 * @stability experimental
 */
export function useExportsClient(): ExportsClient {
  const api = usePlatformApi();
  return useMemo(() => createExportsClient(api), [api]);
}

/**
 * What {@link useExportSources} returns.
 *
 * @stability experimental
 */
export interface ExportSourcesState {
  /** The sources the caller may use, in registry order. */
  sources: ExportSourceDescriptor[];
  /** Whether the first load is in flight. */
  isLoading: boolean;
  /** A load failure, in words. */
  error: string | null;
}

/**
 * The export sources the caller may use (`GET /exports/sources`).
 *
 * @returns the sources and the load state.
 *
 * @extensionPoint hook
 * @stability experimental
 */
export function useExportSources(): ExportSourcesState {
  const client = useExportsClient();
  const mounted = useMounted();
  const [state, setState] = useState<ExportSourcesState>({ sources: [], isLoading: true, error: null });
  useEffect(() => {
    client
      .sources()
      .then((response) => mounted() && setState({ sources: response.items, isLoading: false, error: null }))
      .catch((error: unknown) => mounted() && setState({ sources: [], isLoading: false, error: messageOf(error, 'Could not load the export options.') }));
  }, [client, mounted]);
  return state;
}

/**
 * What {@link useExports} returns.
 *
 * @stability experimental
 */
export interface ExportsState {
  /** The caller's recent exports, newest first. */
  exports: ExportView[];
  /** Whether the first load is in flight. */
  isLoading: boolean;
  /** A load failure, in words. */
  error: string | null;
  /** Reloads the list now. */
  refresh: () => Promise<void>;
}

/**
 * The caller's recent exports (`GET /exports`), polled while any is in
 * progress and paused while the tab is hidden.
 *
 * @param options - `intervalMs`, the poll interval (default {@link DEFAULT_EXPORT_POLL_MS}).
 * @returns the exports and the load state.
 *
 * @extensionPoint hook
 * @stability experimental
 */
export function useExports(options: { intervalMs?: number } = {}): ExportsState {
  const intervalMs = options.intervalMs ?? DEFAULT_EXPORT_POLL_MS;
  const client = useExportsClient();
  const mounted = useMounted();
  const [exports, setExports] = useState<ExportView[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await client.list();
      if (!mounted()) return;
      setExports(response.items);
      setError(null);
    } catch (err) {
      if (mounted()) setError(messageOf(err, 'Could not load your exports.'));
    } finally {
      if (mounted()) setIsLoading(false);
    }
  }, [client, mounted]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const inProgress = exports.some(isExportInProgress);
  usePolling(inProgress ? intervalMs : 0, refresh);

  return { exports, isLoading, error, refresh };
}

/**
 * What {@link useCreateExport} returns.
 *
 * @stability experimental
 */
export interface CreateExportState {
  /** Queues an export; resolves with it, or `null` when the API refused (see `error`). */
  create: (input: CreateExportInput) => Promise<ExportView | null>;
  /** Whether a request is in flight. */
  creating: boolean;
  /** The API's refusal, in words (`429`: too many in progress). */
  error: string | null;
  /** Clears `error`. */
  reset: () => void;
}

/**
 * Queues an export (`POST /exports`).
 *
 * @returns the action and its state.
 *
 * @extensionPoint hook
 * @stability experimental
 */
export function useCreateExport(): CreateExportState {
  const client = useExportsClient();
  const mounted = useMounted();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const create = useCallback(
    async (input: CreateExportInput) => {
      setCreating(true);
      setError(null);
      try {
        return await client.create(input);
      } catch (err) {
        if (mounted()) {
          setError(
            isPlatformApiError(err) && err.status === 429
              ? 'You already have several exports in progress. Wait for one to finish, then try again.'
              : messageOf(err, 'The export could not be requested.'),
          );
        }
        return null;
      } finally {
        if (mounted()) setCreating(false);
      }
    },
    [client, mounted],
  );
  return { create, creating, error, reset: useCallback(() => setError(null), []) };
}

/**
 * What {@link useExport} returns.
 *
 * @stability experimental
 */
export interface ExportState {
  /** The export, once loaded. */
  view: ExportView | null;
  /** A load failure, in words. */
  error: string | null;
  /** Reloads it now (a ready export gets a fresh download URL). */
  refresh: () => Promise<void>;
}

/**
 * One export (`GET /exports/:id`), polled until it settles. A ready export's
 * `download` URL is short-lived: call `refresh` right before using it.
 *
 * @param id - the export id, or `null` for none.
 * @param options - `intervalMs`, the poll interval (default {@link DEFAULT_EXPORT_POLL_MS}).
 * @returns the export and its state.
 *
 * @extensionPoint hook
 * @stability experimental
 */
export function useExport(id: string | null, options: { intervalMs?: number } = {}): ExportState {
  const intervalMs = options.intervalMs ?? DEFAULT_EXPORT_POLL_MS;
  const client = useExportsClient();
  const mounted = useMounted();
  const [view, setView] = useState<ExportView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!id) return;
    try {
      const next = await client.get(id);
      if (mounted()) {
        setView(next);
        setError(null);
      }
    } catch (err) {
      if (mounted()) setError(messageOf(err, 'Could not load the export.'));
    }
  }, [client, id, mounted]);

  useEffect(() => {
    setView(null);
    void refresh();
  }, [refresh]);

  usePolling(view && isExportInProgress(view) ? intervalMs : 0, refresh);
  return { view, error, refresh };
}

/** Calls `callback` every `intervalMs` while the tab is visible; `0` stops. */
function usePolling(intervalMs: number, callback: () => void | Promise<void>): void {
  const ref = useRef(callback);
  ref.current = callback;
  useEffect(() => {
    if (intervalMs <= 0) return;
    const timer = setInterval(() => {
      if (typeof document === 'undefined' || !document.hidden) void ref.current();
    }, intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
}
