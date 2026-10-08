/**
 * `GET /api/admin/jobs/insights` and its one write (issue #266, epic #254;
 * moved into `@marinoscar/platform-web/jobs` by #854 from the reference app's
 * `hooks/useJobInsights.ts`, behaviour unchanged).
 *
 * A SEPARATE HOOK FROM `useJobs`, even though both read the same queue through
 * the same controller, because they answer different questions with different
 * costs. The list is a paginated read of rows the operator is looking at; this
 * is an analytical read — percentiles over a window, a merge with the lifetime
 * rollup — computed on demand from pure `SELECT`s. Folding it into `useJobs`
 * would mean every jobs-page poll also recomputed the percentiles, which is a
 * poll of the expensive endpoint disguised as a poll of the cheap one.
 *
 * IT DOES NOT POLL AT ALL, and that is the deliberate counterpart to the jobs
 * page's ten-second interval. Nothing here changes at that timescale — a p95
 * over seven days does not move meaningfully in ten seconds — so an interval
 * would buy an expensive query per tick and no new information. Refreshing is
 * an explicit act, and the response's `generatedAt` is on screen so the
 * operator can see how old the numbers are rather than assume they are live.
 *
 * The window is a PARAMETER rather than internal state: the page owns the
 * selector, the effect below keys on the scalar, and the API's own clamped
 * answer (`insights.windowDays`) is what the page labels the history with —
 * never the number it asked for.
 */

import { useCallback, useEffect, useState } from 'react';

import { isPlatformApiError } from '../../core/index.js';
import { useIsMounted } from '../internal/use-is-mounted.js';
import { useJobsApi } from './adapters.js';
import type { JobsApi } from './api.js';
import type { JobInsights } from './types.js';

export { DEFAULT_INSIGHTS_WINDOW_DAYS } from '@marinoscar/platform-contract/jobs';

/**
 * The windows the page offers.
 *
 * A fixed set rather than a free number field: the API accepts 1-90, but a
 * spinner over 90 integers is a control nobody uses to ask a real question.
 * Every value here is inside the API's range, so the clamp can never fire from
 * this UI — and if it ever did, the response's echoed `windowDays` is what gets
 * rendered.
 */
export const INSIGHTS_WINDOW_OPTIONS = [1, 7, 30, 90] as const;

export interface UseJobInsightsResult {
  insights: JobInsights | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  /** True while the lifetime rollup is being cleared. */
  isResetting: boolean;
  /** Rows deleted, or `null` when the reset failed. Never throws. */
  resetHistory: () => Promise<number | null>;
}

export function useJobInsights(windowDays: number, api?: JobsApi): UseJobInsightsResult {
  const client = useJobsApi(api);
  const [insights, setInsights] = useState<JobInsights | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isResetting, setIsResetting] = useState(false);
  const isMounted = useIsMounted();

  const load = useCallback(
    async (showLoading: boolean) => {
      if (showLoading) setIsLoading(true);
      setError(null);
      try {
        const data = await client.getJobInsights(windowDays);
        if (isMounted()) setInsights(data);
      } catch (err) {
        if (isMounted()) {
          if (isPlatformApiError(err) && err.status === 403) {
            setError('You do not have permission to view queue insights');
          } else {
            setError(isPlatformApiError(err) ? err.message : 'Failed to load queue insights');
          }
        }
      } finally {
        if (isMounted() && showLoading) setIsLoading(false);
      }
    },
    [client, windowDays, isMounted],
  );

  // Keyed on `load`, which is keyed on the scalar `windowDays` — so changing
  // the window re-asks, and nothing else does.
  useEffect(() => {
    void load(true);
  }, [load]);

  const refresh = useCallback(async () => {
    await load(false);
  }, [load]);

  /**
   * Clear the lifetime rollup, then re-read.
   *
   * The re-read is not optional: `lifetime` is the only block this write
   * changes, and leaving the pre-reset numbers on screen would show an
   * operator the history they just deleted.
   */
  const resetHistory = useCallback(async (): Promise<number | null> => {
    setIsResetting(true);
    setError(null);
    try {
      const result = await client.resetJobInsightsHistory();
      await load(false);
      return result.reset;
    } catch (err) {
      if (isMounted()) {
        setError(
          isPlatformApiError(err) ? err.message : 'Failed to clear the lifetime statistics',
        );
      }
      return null;
    } finally {
      if (isMounted()) setIsResetting(false);
    }
  }, [load, isMounted]);

  return { insights, isLoading, error, refresh, isResetting, resetHistory };
}
