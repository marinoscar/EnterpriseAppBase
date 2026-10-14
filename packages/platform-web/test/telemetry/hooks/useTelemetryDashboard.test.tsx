/**
 * `useDashboardMetrics` (issue #602): one independent request per group on
 * the page's shared tick — keeps the last good result while refreshing, and
 * reports a failure (with the API's reason) without dropping that result.
 */
import { describe, expect, it } from 'vitest';
import { waitFor, act } from '@testing-library/react';
import { useDashboardMetrics } from '../../../src/telemetry/headless/hooks/useTelemetryDashboard.js';
import { createTestApiError, createTestPlatformHost } from '../../../src/testing/index.js';
import type { TestApiRequest, TestPlatformHost } from '../../../src/testing/index.js';
import { renderHook } from '../harness.js';
import { mockDashboardMetrics } from '../fixtures/telemetryDashboard.js';
import type { DashboardMetricGroup, DashboardMetricsQuery } from '../../../src/telemetry/headless/services/telemetryDashboard.js';

const METRICS = 'GET /admin/telemetry/dashboard/metrics';

/** A host answering `/metrics` (or `respond`'s answer), and the URLs it was asked. */
function recordMetrics(respond?: (url: URL) => unknown): { host: TestPlatformHost; urls: URL[] } {
  const urls: URL[] = [];
  const host = createTestPlatformHost({
    responses: {
      [METRICS]: (request: TestApiRequest) => {
        const url = new URL(request.path, 'http://test.local');
        urls.push(url);
        const custom = respond?.(url);
        if (custom !== undefined) return custom;
        return mockDashboardMetrics[url.searchParams.get('group') as DashboardMetricGroup];
      },
    },
  });
  return { host, urls };
}

describe('useDashboardMetrics', () => {
  it('fetches its group with the query and reports the result', async () => {
    const { host, urls } = recordMetrics();
    const query: DashboardMetricsQuery = { range: '1h', host: 'vps-1' };
    const { result } = renderHook(() => useDashboardMetrics('database', query, 0), { wrapperOptions: { host } });

    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.data).not.toBeNull());
    expect(result.current.data?.group).toBe('database');
    expect(result.current.isLoading).toBe(false);
    expect(urls[0].searchParams.get('group')).toBe('database');
    expect(urls[0].searchParams.get('host')).toBe('vps-1');
  });

  it('refetches on a tick and keeps the last good data while refreshing', async () => {
    const { host, urls } = recordMetrics();
    const query: DashboardMetricsQuery = { range: '1h' };
    const { result, rerender } = renderHook(({ tick }: { tick: number }) => useDashboardMetrics('host', query, tick), {
      initialProps: { tick: 0 },
      wrapperOptions: { host },
    });
    await waitFor(() => expect(result.current.data).not.toBeNull());

    rerender({ tick: 1 });
    expect(result.current.isRefreshing).toBe(true);
    expect(result.current.data?.group).toBe('host');
    await waitFor(() => expect(result.current.isRefreshing).toBe(false));
    expect(urls).toHaveLength(2);
  });

  it('reports a failure with its reason and retries on reload', async () => {
    let fail = true;
    const { host } = recordMetrics(() => {
      if (!fail) return undefined;
      throw Object.assign(createTestApiError(504, 'The statement timed out', 'GATEWAY_TIMEOUT'), {
        details: { reason: 'TELEMETRY_QUERY_TIMEOUT' },
      });
    });
    const query: DashboardMetricsQuery = { range: '1h' };
    const { result } = renderHook(() => useDashboardMetrics('queue', query, 0), { wrapperOptions: { host } });
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error?.reason).toBe('TELEMETRY_QUERY_TIMEOUT');
    expect(result.current.data).toBeNull();

    fail = false;
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.data?.group).toBe('queue'));
    expect(result.current.error).toBeNull();
  });
});
