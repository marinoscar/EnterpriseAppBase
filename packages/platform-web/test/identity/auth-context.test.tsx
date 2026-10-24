// The packaged AuthProvider (issue #727), moved from the reference app's
// contexts/AuthContext.tsx. The app's own suites still exercise it end to end
// through its transport and a mock server; these pin the package contract
// over a fake session client.

import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthProvider, useAuth } from '../../src/identity/headless/index.js';
import type { AuthProviderProps } from '../../src/identity/headless/index.js';
import { USER, fakeSessionClient } from './harness.js';

function wrapper(props: Omit<AuthProviderProps, 'children'>, route = '/') {
  return ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route path="*" element={<AuthProvider {...props}>{children}</AuthProvider>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('AuthProvider', () => {
  afterEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('starts loading, then settles signed out when the refresh fails', async () => {
    const client = fakeSessionClient({ refreshed: false });
    const { result } = renderHook(() => useAuth(), { wrapper: wrapper({ client }) });
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.user).toBeNull();
    expect(result.current.isAuthenticated).toBe(false);
  });

  it('lists the providers with skipAuth', async () => {
    const client = fakeSessionClient();
    const { result } = renderHook(() => useAuth(), { wrapper: wrapper({ client }) });
    await waitFor(() => expect(result.current.providers).toHaveLength(1));
    expect(client.get).toHaveBeenCalledWith('/auth/providers', { skipAuth: true });
  });

  it('reads /auth/me after a successful refresh, with the org fields', async () => {
    const me = {
      ...USER,
      tenancyMode: 'multi' as const,
      activeOrg: { id: 'o1', name: 'Acme', slug: 'acme' },
      memberships: [{ orgId: 'o1', name: 'Acme', slug: 'acme', role: 'org_admin' }],
    };
    const client = fakeSessionClient({ refreshed: true, me });
    const { result } = renderHook(() => useAuth(), { wrapper: wrapper({ client }) });
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));
    expect(result.current.user?.email).toBe('ada@example.com');
    expect(result.current.activeOrg).toEqual({ id: 'o1', name: 'Acme', slug: 'acme' });
    expect(result.current.memberships).toHaveLength(1);
  });

  it('skips the boot probe on the callback route', async () => {
    const client = fakeSessionClient({ refreshed: true });
    const { result } = renderHook(() => useAuth(), { wrapper: wrapper({ client }, '/auth/callback') });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(client.refreshToken).not.toHaveBeenCalled();
  });

  it('drops the token on a 401 from /auth/me', async () => {
    const client = fakeSessionClient({ refreshed: true, me: Object.assign(new Error('Unauthorized'), { status: 401 }) });
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { result } = renderHook(() => useAuth(), { wrapper: wrapper({ client }) });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.user).toBeNull();
    expect(client.setAccessToken).toHaveBeenCalledWith(null);
    expect(error).toHaveBeenCalled();
  });

  it('runs onBeforeLogout before POST /auth/logout, then lands on the login path', async () => {
    const order: string[] = [];
    const client = fakeSessionClient({ refreshed: true, post: (path) => void order.push(path) });
    const onBeforeLogout = vi.fn(async () => void order.push('before'));
    function Probe() {
      const auth = useAuth();
      return <button onClick={() => void auth.logout()}>{auth.user ? 'in' : 'out'}</button>;
    }
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route
            path="/"
            element={
              <AuthProvider client={client} onBeforeLogout={onBeforeLogout} loginPath="/sign-in">
                <Probe />
              </AuthProvider>
            }
          />
          <Route path="/sign-in" element={<p>sign-in page</p>} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByText('in');
    act(() => screen.getByRole('button').click());
    await screen.findByText('sign-in page');
    expect(order).toEqual(['before', '/auth/logout']);
    expect(client.setAccessToken).toHaveBeenLastCalledWith(null);
  });

  it('still signs out when onBeforeLogout rejects', async () => {
    const client = fakeSessionClient({ refreshed: true });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { result } = renderHook(() => useAuth(), {
      wrapper: wrapper({ client, onBeforeLogout: () => Promise.reject(new Error('boom')) }),
    });
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));
    await act(() => result.current.logout());
    expect(result.current.user).toBeNull();
  });

  it('redirects to /api/auth/<provider>, with select_account on request, and stores the return URL', async () => {
    const client = fakeSessionClient();
    const location = { href: '' };
    vi.stubGlobal('location', location);
    const { result } = renderHook(() => useAuth(), { wrapper: wrapper({ client }) });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => result.current.login('google'));
    expect(location.href).toBe('/api/auth/google');
    expect(sessionStorage.getItem('auth_return_url')).toBe('/');

    act(() => result.current.login('google', { selectAccount: true }));
    expect(location.href).toBe('/api/auth/google?select_account=1');
    vi.unstubAllGlobals();
  });

  it('clears the session and flags it expired when the client reports a refused refresh', async () => {
    const client = fakeSessionClient({ refreshed: true });
    const { result } = renderHook(() => useAuth(), { wrapper: wrapper({ client }) });
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));
    act(() => client.expire());
    expect(result.current.user).toBeNull();
    expect(result.current.sessionExpired).toBe(true);
  });

  it('switchOrg posts the org id, keeps the new token and re-reads the user', async () => {
    const client = fakeSessionClient({
      refreshed: true,
      post: (path) => (path === '/auth/switch-org' ? { accessToken: 'org-token', expiresIn: 900 } : undefined),
    });
    const { result } = renderHook(() => useAuth(), { wrapper: wrapper({ client }) });
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));
    await act(() => result.current.switchOrg('o2'));
    expect(client.post).toHaveBeenCalledWith('/auth/switch-org', { orgId: 'o2' });
    expect(client.setAccessToken).toHaveBeenCalledWith('org-token');
    expect(client.get.mock.calls.filter(([path]) => path === '/auth/me')).toHaveLength(2);
  });

  it('setAccessToken hands the token to the client', async () => {
    const client = fakeSessionClient();
    const { result } = renderHook(() => useAuth(), { wrapper: wrapper({ client }) });
    act(() => result.current.setAccessToken('from-callback'));
    expect(client.setAccessToken).toHaveBeenCalledWith('from-callback');
  });

  it('useAuth throws outside the provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => renderHook(() => useAuth())).toThrow('useAuth must be used within an AuthProvider');
  });
});
