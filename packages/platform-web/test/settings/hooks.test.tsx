// The settings hooks (#733): useOrgSettings (new), and the If-Match and 409
// contract every settings hook shares.
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { PlatformHostProvider } from '../../src/core/index.js';
import { useOrgSettings, useSystemSettings, useUserSettings } from '../../src/settings/headless/index.js';
import { createTestApiError, createTestPlatformHost } from '../../src/testing/index.js';
import type { TestPlatformHost } from '../../src/testing/index.js';

const ORG = { orgId: 'o', value: {}, effective: {}, version: 2, namespaces: [], updatedAt: null };

function wrap(host: TestPlatformHost) {
  return ({ children }: { children: ReactNode }) => <PlatformHostProvider host={host}>{children}</PlatformHostProvider>;
}

describe('useOrgSettings', () => {
  it('loads the active organization and patches with If-Match', async () => {
    const host = createTestPlatformHost({
      responses: { 'GET /org-settings': ORG, 'PATCH /org-settings': { ...ORG, version: 3 } },
    });
    const { result } = renderHook(() => useOrgSettings(), { wrapper: wrap(host) });
    await waitFor(() => expect(result.current.settings?.version).toBe(2));
    await act(() => result.current.patch({ exportPolicy: { enabled: false } }));
    expect(host.requests.at(-1)).toEqual({ method: 'PATCH', path: '/org-settings', body: { exportPolicy: { enabled: false } }, ifMatch: '2' });
    expect(result.current.settings?.version).toBe(3);
  });

  it('names a 403 and refetches on a 409', async () => {
    const denied = createTestPlatformHost({ responses: { 'GET /org-settings': () => { throw createTestApiError(403, 'no'); } } });
    const { result } = renderHook(() => useOrgSettings(), { wrapper: wrap(denied) });
    await waitFor(() => expect(result.current.error).toBe('You do not have permission to view the organization settings'));

    let gets = 0;
    const conflicted = createTestPlatformHost({
      responses: {
        'GET /org-settings': () => ({ ...ORG, version: ++gets }),
        'PATCH /org-settings': () => {
          throw createTestApiError(409, 'stale');
        },
      },
    });
    const second = renderHook(() => useOrgSettings(), { wrapper: wrap(conflicted) });
    await waitFor(() => expect(second.result.current.settings).not.toBeNull());
    await expect(second.result.current.patch({ a: null })).rejects.toThrow(/updated elsewhere/);
    expect(gets).toBe(2);
  });
});

describe('useSystemSettings and useUserSettings', () => {
  it('use the explicit transport outside a host and send If-Match on PATCH', async () => {
    const host = createTestPlatformHost({
      responses: {
        'GET /system-settings': { version: 4 },
        'PATCH /system-settings': { version: 5 },
        'GET /user-settings': { theme: 'dark', profile: { imageSource: 'none', imageObjectId: null }, version: 1, updatedAt: '' },
        'PATCH /user-settings': { theme: 'light', profile: { imageSource: 'none', imageObjectId: null }, version: 2, updatedAt: '' },
      },
    });
    const system = renderHook(() => useSystemSettings({ api: host.api }));
    await waitFor(() => expect(system.result.current.settings?.version).toBe(4));
    await act(() => system.result.current.updateSettings({ version: 4 }));
    expect(host.requests.at(-1)).toMatchObject({ method: 'PATCH', ifMatch: '4' });

    const applyTheme = vi.fn();
    const user = renderHook(() => useUserSettings({ api: host.api, applyTheme }));
    await waitFor(() => expect(applyTheme).toHaveBeenCalledWith('dark'));
    await act(() => user.result.current.updateTheme('light'));
    expect(applyTheme).toHaveBeenLastCalledWith('light');
  });

  it('do not touch the theme when syncTheme is false', async () => {
    const host = createTestPlatformHost({
      responses: { 'GET /user-settings': { theme: 'dark', profile: { imageSource: 'none', imageObjectId: null }, version: 1, updatedAt: '' } },
    });
    const applyTheme = vi.fn();
    const { result } = renderHook(() => useUserSettings({ api: host.api, applyTheme, syncTheme: false }));
    await waitFor(() => expect(result.current.settings).not.toBeNull());
    expect(applyTheme).not.toHaveBeenCalled();
  });
});
