// The exports client and hooks (issue #744): the routes, the polling of an
// in-progress export until it settles, the 429 in words, the status labels.
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { PlatformHostProvider } from '../../src/core/index.js';
import {
  createExportsClient,
  exportStatusLabel,
  formatExportSize,
  isExportInProgress,
  useCreateExport,
  useExport,
  useExportSources,
  useExports,
} from '../../src/exports/headless/index.js';
import { createTestApiError } from '../../src/testing/index.js';
import { ID, USER_DATA, hostWith, view } from './fixtures.js';

function wrapperFor(host: ReturnType<typeof hostWith>) {
  return ({ children }: { children: ReactNode }) => <PlatformHostProvider host={host}>{children}</PlatformHostProvider>;
}

describe('exports client', () => {
  it('calls the four routes', async () => {
    const host = hostWith({
      'GET /exports/sources': { items: [USER_DATA] },
      'GET /exports': { items: [view()] },
      [`GET /exports/${ID}`]: view({ status: 'running' }),
      'POST /exports': view(),
    });
    const client = createExportsClient(host.api);
    expect((await client.sources()).items).toHaveLength(1);
    expect((await client.list()).items).toHaveLength(1);
    expect((await client.get(ID)).status).toBe('running');
    await client.create({ source: 'user-data', format: 'json' });
    expect(host.requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      'GET /exports/sources',
      'GET /exports',
      `GET /exports/${ID}`,
      'POST /exports',
    ]);
    expect(host.requests[3]!.body).toEqual({ source: 'user-data', format: 'json' });
  });

  it('labels statuses in words and sizes in units', () => {
    expect(exportStatusLabel('ready')).toBe('Ready to download');
    expect(exportStatusLabel('failed')).toBe('Failed');
    expect(isExportInProgress({ status: 'running' })).toBe(true);
    expect(isExportInProgress({ status: 'expired' })).toBe(false);
    expect(formatExportSize(null)).toBe('');
    expect(formatExportSize(512)).toBe('512 B');
    expect(formatExportSize(1536)).toBe('1.5 KB');
    expect(formatExportSize(20 * 1024 * 1024)).toBe('20 MB');
  });
});

describe('export hooks', () => {
  it('useExportSources loads the sources', async () => {
    const host = hostWith({ 'GET /exports/sources': { items: [USER_DATA] } });
    const { result } = renderHook(() => useExportSources(), { wrapper: wrapperFor(host) });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.sources.map((s) => s.id)).toEqual(['user-data']);
  });

  it('useExport polls an in-progress export until it is ready, then stops', async () => {
    let calls = 0;
    const host = hostWith({
      [`GET /exports/${ID}`]: () => {
        calls += 1;
        return calls < 3 ? view({ status: calls === 1 ? 'pending' : 'running' }) : view({ status: 'ready', fileName: 'a.json' });
      },
    });
    const { result } = renderHook(() => useExport(ID, { intervalMs: 20 }), { wrapper: wrapperFor(host) });
    await waitFor(() => expect(result.current.view?.status).toBe('ready'), { timeout: 2000 });
    const settled = calls;
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(calls).toBe(settled);
  });

  it('useExports polls while any export is in progress', async () => {
    let calls = 0;
    const host = hostWith({
      'GET /exports': () => {
        calls += 1;
        return { items: [view({ status: calls < 2 ? 'running' : 'ready' })] };
      },
    });
    const { result } = renderHook(() => useExports({ intervalMs: 20 }), { wrapper: wrapperFor(host) });
    await waitFor(() => expect(result.current.exports[0]?.status).toBe('ready'), { timeout: 2000 });
    const settled = calls;
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(calls).toBe(settled);
  });

  it('useCreateExport says a 429 in words and returns null', async () => {
    const host = hostWith({
      'POST /exports': () => {
        throw createTestApiError(429, 'There are already 3 exports in progress');
      },
    });
    const { result } = renderHook(() => useCreateExport(), { wrapper: wrapperFor(host) });
    let created: unknown;
    await act(async () => {
      created = await result.current.create({ source: 'user-data', format: 'json' });
    });
    expect(created).toBeNull();
    expect(result.current.error).toMatch(/several exports in progress/);
  });
});
