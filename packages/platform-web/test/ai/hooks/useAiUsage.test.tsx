/**
 * The usage hooks cut days in the viewer's zone: they send `tz` (default the
 * display zone) to `GET /admin/ai/usage` and `GET /ai/usage/me`, and re-fetch
 * when the display zone changes.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

import { setPreferredTimeZone, type PlatformApiClient } from '../../../src/core/index.js';
import { useAiUsage, useMyAiUsage } from '../../../src/ai/headless/use-ai-usage.js';
import { mockAiUsageReport } from '../fixtures.js';

function fakeApi() {
  const get = vi.fn(async () => mockAiUsageReport('day'));
  return { api: { get } as unknown as PlatformApiClient, get };
}

function lastQuery(get: ReturnType<typeof fakeApi>['get']): URLSearchParams {
  const calls = get.mock.calls as unknown as [string][];
  const path = calls[calls.length - 1]![0];
  return new URLSearchParams(path.slice(path.indexOf('?') + 1));
}

afterEach(() => setPreferredTimeZone(null));

describe('usage hooks and the time zone', () => {
  it('useAiUsage sends the display zone as tz and re-fetches when it changes', async () => {
    setPreferredTimeZone('America/Costa_Rica');
    const { api, get } = fakeApi();
    renderHook(() => useAiUsage({ groupBy: 'day', from: '2026-10-01', to: '2026-10-27' }, { api }));

    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
    expect((get.mock.calls as unknown as [string][])[0]![0]).toMatch(/^\/admin\/ai\/usage\?/);
    expect(lastQuery(get).get('tz')).toBe('America/Costa_Rica');

    act(() => setPreferredTimeZone('Asia/Tokyo'));
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    expect(lastQuery(get).get('tz')).toBe('Asia/Tokyo');
  });

  it("useMyAiUsage sends the display zone, and an explicit tz wins", async () => {
    setPreferredTimeZone('Europe/Paris');
    const { api, get } = fakeApi();
    const { rerender } = renderHook(({ tz }: { tz?: string }) => useMyAiUsage({ groupBy: 'model', tz }, { api }), {
      initialProps: {},
    });

    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
    expect((get.mock.calls as unknown as [string][])[0]![0]).toMatch(/^\/ai\/usage\/me\?/);
    expect(lastQuery(get).get('tz')).toBe('Europe/Paris');

    rerender({ tz: 'UTC' });
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    expect(lastQuery(get).get('tz')).toBe('UTC');
  });
});
