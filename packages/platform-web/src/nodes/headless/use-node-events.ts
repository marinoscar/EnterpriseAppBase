/**
 * One node's recent events (issue #1045): `GET /api/admin/nodes/:id/events`, newest
 * first, with "load more".
 *
 * The same contract as the fleet hooks (`use-worker-nodes.ts`): every function
 * resolves rather than throws, and a failure is a STRING the caller renders.
 *
 * The first page is asked for when the node or the filters change; `loadMore`
 * appends the next page; `refresh` re-reads from the first page WITHOUT raising
 * the loading flag (the list stays on screen). An event that arrives between a
 * first page and a "load more" shifts the pages by one, so an appended page is
 * de-duplicated by id rather than trusted to start where the last one ended.
 *
 * The query is read member by member (`page`, `pageSize`, `type`, `severity`),
 * so an inline object literal does not re-fetch on every render.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { isPlatformApiError } from '../../core/index.js';
import { useIsMounted } from '../internal/use-is-mounted.js';
import { useNodesApi } from './adapters.js';
import type { NodesApi } from './api.js';
import type { NodeEventsQuery, WorkerNodeEvent, WorkerNodeEventList } from './types.js';

/**
 * What {@link useNodeEvents} returns.
 *
 * @stability experimental
 */
export interface UseNodeEventsResult {
  /** The events read so far, newest first; emptied on an error or with no node. */
  events: WorkerNodeEvent[];
  /** How many events the node has in total (for the filters), `0` before an answer. */
  total: number;
  /** Whether a further page exists. */
  hasMore: boolean;
  /** The first page is in flight. */
  isLoading: boolean;
  /** A `loadMore` page is in flight. */
  isLoadingMore: boolean;
  /** The last failure as a sentence, or `null`. */
  error: string | null;
  /** Re-read from the first page without raising the loading flag. */
  refresh: () => Promise<void>;
  /** Append the next page. A no-op while one is in flight or when there is none. */
  loadMore: () => Promise<void>;
}

/**
 * The page as the hook keeps it. A malformed answer (no `items` array: a
 * transport that resolved nothing, an older server's unrelated body) reads as
 * an empty page rather than crashing the dialog that shows it.
 */
function normalized(data: WorkerNodeEventList | null | undefined): WorkerNodeEventList {
  const items = data && Array.isArray(data.items) ? data.items : [];
  const num = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
  return {
    items,
    total: num(data?.total, items.length),
    page: num(data?.page, 1),
    pageSize: num(data?.pageSize, items.length),
    totalPages: num(data?.totalPages, items.length > 0 ? 1 : 0),
  };
}

function messageFor(err: unknown): string {
  if (isPlatformApiError(err)) {
    if (err.status === 403) return 'You do not have permission to view worker node events';
    return err.message;
  }
  return 'Failed to load node events';
}

/**
 * `GET /api/admin/nodes/:id/events`: a node's events, newest first, page by page.
 *
 * @param nodeId - the node id, or `null` to ask for nothing.
 * @param query - the first page, its size and the filters (every member optional).
 * @param api - a client to use instead of the adapters' or the host's.
 * @returns the events and their state.
 *
 * @example
 * ```tsx
 * const { events, hasMore, loadMore } = useNodeEvents(node.id, { pageSize: 20, severity: 'critical' });
 * ```
 *
 * @extensionPoint hook
 * @stability experimental
 */
export function useNodeEvents(nodeId: string | null, query: NodeEventsQuery = {}, api?: NodesApi): UseNodeEventsResult {
  const client = useNodesApi(api);
  const { page: firstPage = 1, pageSize, type, severity } = query;
  const [events, setEvents] = useState<WorkerNodeEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [lastPage, setLastPage] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [isLoading, setIsLoading] = useState(nodeId !== null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isMounted = useIsMounted();
  // Bumped by every first-page read, so a "load more" that settles after the
  // node or the filters changed is dropped instead of appended to the new list.
  const generation = useRef(0);
  const loadingMore = useRef(false);

  const pageQuery = useCallback(
    (page: number): NodeEventsQuery => ({
      page,
      ...(pageSize !== undefined ? { pageSize } : {}),
      ...(type ? { type } : {}),
      ...(severity ? { severity } : {}),
    }),
    [pageSize, type, severity],
  );

  const load = useCallback(
    async (showLoading: boolean) => {
      const run = ++generation.current;
      if (nodeId === null) {
        setEvents([]);
        setTotal(0);
        setLastPage(0);
        setTotalPages(0);
        setError(null);
        setIsLoading(false);
        return;
      }
      if (showLoading) setIsLoading(true);
      try {
        const data = normalized(await client.listNodeEvents(nodeId, pageQuery(firstPage)));
        if (isMounted() && run === generation.current) {
          setEvents(data.items);
          setTotal(data.total);
          setLastPage(data.page);
          setTotalPages(data.totalPages);
          setError(null);
        }
      } catch (err) {
        if (isMounted() && run === generation.current) {
          setError(messageFor(err));
          setEvents([]);
          setTotal(0);
          setLastPage(0);
          setTotalPages(0);
        }
      } finally {
        if (isMounted() && showLoading && run === generation.current) setIsLoading(false);
      }
    },
    [client, nodeId, firstPage, pageQuery, isMounted],
  );

  useEffect(() => {
    void load(true);
  }, [load]);

  const refresh = useCallback(async () => {
    await load(false);
  }, [load]);

  const hasMore = nodeId !== null && lastPage > 0 && lastPage < totalPages;

  const loadMore = useCallback(async () => {
    if (nodeId === null || loadingMore.current || !(lastPage > 0 && lastPage < totalPages)) return;
    const run = generation.current;
    loadingMore.current = true;
    setIsLoadingMore(true);
    try {
      const data = normalized(await client.listNodeEvents(nodeId, pageQuery(lastPage + 1)));
      if (isMounted() && run === generation.current) {
        setEvents((current) => {
          const seen = new Set(current.map((event) => event.id));
          return [...current, ...data.items.filter((event) => !seen.has(event.id))];
        });
        setTotal(data.total);
        setLastPage(data.page);
        setTotalPages(data.totalPages);
        setError(null);
      }
    } catch (err) {
      // The events already shown stay: they are a history, not a verdict that
      // a failed read would make wrong.
      if (isMounted() && run === generation.current) setError(messageFor(err));
    } finally {
      loadingMore.current = false;
      if (isMounted()) setIsLoadingMore(false);
    }
  }, [client, nodeId, lastPage, totalPages, pageQuery, isMounted]);

  return { events, total, hasMore, isLoading, isLoadingMore, error, refresh, loadMore };
}
