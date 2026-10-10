/**
 * AI usage aggregates (issue #444, epic #420) — `GET /api/admin/ai/usage`
 * (`useAiUsage`, `ai_config:read`) and `GET /api/ai/usage/me` (`useMyAiUsage`,
 * `ai:use`).
 *
 * Both are thin readers over one shared loader: the query is a PARAMETER, the
 * effect keys on its scalars, and a response that arrives after the query has
 * changed is dropped rather than painted over the newer one (switching 7 → 90
 * days quickly must not end on the 7-day numbers).
 *
 * Like `useJobInsights`, neither polls: usage over a 30-day window does not
 * move at a timescale worth an interval, and refreshing is an explicit act.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { isPlatformApiError } from '../../core/index.js';
import type { PlatformApiClient } from '../../core/index.js';
import {
  type AiMyUsageGroupBy,
  type AiMyUsageQuery,
  type AiUsageQuery,
  type AiUsageReport,
} from './types.js';
import { getAiUsage, getMyAiUsage } from './client.js';
import { useIsMounted } from '../internal/use-is-mounted.js';
import { useAiApi } from './use-ai-api.js';
import type { AiHookOptions } from './use-ai-api.js';

/**
 * The use AI usage return wire shape.
 *
 * @stability experimental
 */
export interface UseAiUsageReturn<G extends string> {
  /** The report. */
  report: AiUsageReport<G> | null;
  /** Whether loading. */
  isLoading: boolean;
  /** The error. */
  error: string | null;
  /** The refresh. */
  refresh: () => Promise<void>;
}

function useUsageReport<G extends string>(
  api: PlatformApiClient,
  fetcher: () => Promise<AiUsageReport<G>>,
  queryKey: string,
  fallbackError: string
): UseAiUsageReturn<G> {
  const [report, setReport] = useState<AiUsageReport<G> | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isMounted = useIsMounted();
  const latest = useRef(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const load = useCallback(async () => {
    const ticket = ++latest.current;
    const current = () => isMounted() && ticket === latest.current;
    setIsLoading(true);
    setError(null);
    try {
      const data = await fetcherRef.current();
      if (current()) setReport(data);
    } catch (err) {
      if (current()) {
        setReport(null);
        setError(isPlatformApiError(err) ? err.message : fallbackError);
      }
    } finally {
      if (current()) setIsLoading(false);
    }
    // `queryKey` stands in for the query object, so a new object with the same
    // values does not re-fetch.
  }, [api, queryKey, fallbackError, isMounted]);

  useEffect(() => {
    void load();
  }, [load]);

  return { report, isLoading, error, refresh: load };
}

/**
 * Organisation-wide usage, one grouping per call.
 *
 * @stability experimental
 */
export function useAiUsage(
  query: AiUsageQuery,
  options: AiHookOptions = {}
): UseAiUsageReturn<AiUsageQuery['groupBy']> {
  const api = useAiApi(options.api);
  return useUsageReport(
    api,
    () => getAiUsage(api, query),
    JSON.stringify([
      query.groupBy,
      query.from,
      query.to,
      query.userId,
      query.provider,
      query.model,
    ]),
    'Failed to load AI usage'
  );
}

/**
 * The caller's own usage.
 *
 * @stability experimental
 */
export function useMyAiUsage(
  query: AiMyUsageQuery,
  options: AiHookOptions = {}
): UseAiUsageReturn<AiMyUsageGroupBy> {
  const api = useAiApi(options.api);
  return useUsageReport(
    api,
    () => getMyAiUsage(api, query),
    JSON.stringify([query.groupBy, query.from, query.to]),
    'Failed to load your AI usage'
  );
}
