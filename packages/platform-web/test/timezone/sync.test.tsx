// `UserTimeZoneSync` and the time zone sync of `useUserSettings`.

import { render, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { PlatformHostProvider } from '../../src/core/index.js';
import { AuthContext } from '../../src/identity/headless/index.js';
import { useUserSettings } from '../../src/settings/headless/index.js';
import type { UserSettingsDocument, UserSettingsUpdateBase } from '../../src/settings/headless/index.js';
import { createTestPlatformHost } from '../../src/testing/index.js';
import { getPreferredTimeZone, setPreferredTimeZone, UserTimeZoneSync } from '../../src/timezone/headless/index.js';
import { authValue } from '../identity/harness.js';

const DOCUMENT = (timezone?: string) => ({
  theme: 'system',
  profile: { imageSource: 'none', imageObjectId: null, ...(timezone ? { timezone } : {}) },
  updatedAt: '2026-10-01T00:00:00.000Z',
  version: 1,
});

afterEach(() => setPreferredTimeZone(null));

describe('UserTimeZoneSync', () => {
  it("loads the signed-in user's zone into the store", async () => {
    const host = createTestPlatformHost({ responses: { 'GET /user-settings': DOCUMENT('Asia/Tokyo') } });
    render(
      <AuthContext.Provider value={authValue()}>
        <PlatformHostProvider host={host}>
          <UserTimeZoneSync>
            <span>child</span>
          </UserTimeZoneSync>
        </PlatformHostProvider>
      </AuthContext.Provider>,
    );
    await waitFor(() => expect(getPreferredTimeZone()).toBe('Asia/Tokyo'));
    expect(host.requests.filter((request) => request.path === '/user-settings')).toHaveLength(1);
  });

  it('clears the choice when nobody is signed in', async () => {
    setPreferredTimeZone('Europe/Paris');
    const host = createTestPlatformHost({ responses: { 'GET /user-settings': DOCUMENT('Asia/Tokyo') } });
    render(
      <AuthContext.Provider value={authValue({ user: null, isAuthenticated: false })}>
        <UserTimeZoneSync api={host.api} />
      </AuthContext.Provider>,
    );
    await waitFor(() => expect(getPreferredTimeZone()).toBeNull());
    expect(host.requests).toHaveLength(0);
  });

  it('keeps the cached zone when the load fails', async () => {
    setPreferredTimeZone('Europe/Paris');
    const host = createTestPlatformHost({});
    render(<UserTimeZoneSync api={host.api} />);
    await waitFor(() => expect(host.requests).toHaveLength(1));
    expect(getPreferredTimeZone()).toBe('Europe/Paris');
  });
});

describe('useUserSettings', () => {
  const wrapper = (host: ReturnType<typeof createTestPlatformHost>) =>
    function Wrapper({ children }: { children: ReactNode }) {
      return <PlatformHostProvider host={host}>{children}</PlatformHostProvider>;
    };

  it('pushes the loaded and the saved profile.timezone into the store', async () => {
    const host = createTestPlatformHost({
      responses: { 'GET /user-settings': DOCUMENT('America/Costa_Rica'), 'PATCH /user-settings': DOCUMENT('Asia/Tokyo') },
    });
    const { result } = renderHook(() => useUserSettings<UserSettingsDocument, UserSettingsUpdateBase>(), { wrapper: wrapper(host) });
    await waitFor(() => expect(getPreferredTimeZone()).toBe('America/Costa_Rica'));
    await result.current.updateSettings({ profile: { timezone: 'Asia/Tokyo' } });
    expect(getPreferredTimeZone()).toBe('Asia/Tokyo');
  });

  it('leaves the store alone with syncTimeZone: false', async () => {
    const host = createTestPlatformHost({ responses: { 'GET /user-settings': DOCUMENT('America/Costa_Rica') } });
    const { result } = renderHook(() => useUserSettings({ syncTimeZone: false }), { wrapper: wrapper(host) });
    await waitFor(() => expect(result.current.settings).not.toBeNull());
    expect(getPreferredTimeZone()).toBeNull();
  });
});
