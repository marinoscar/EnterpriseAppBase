// Sign-in providers beyond Google (PP-14.9): a `custom` provider starts through
// its registered look, the login page's two provider slots, and the callback
// page's retry restarting the provider that started the sign-in.

import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AuthContext,
  AuthProvider,
  IdentityWebAdaptersProvider,
  lastAuthProvider,
  registerAuthProvider,
  rememberAuthProvider,
  useAuth,
  validAuthProviderId,
} from '../../src/identity/headless/index.js';
import { AuthCallbackPage, LoginPage } from '../../src/identity/ui/index.js';
import { authValue, fakeSessionClient } from './harness.js';

function authWrapper(client: ReturnType<typeof fakeSessionClient>) {
  return ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={['/login']}>
      <Routes>
        <Route path="*" element={<AuthProvider client={client}>{children}</AuthProvider>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('login(provider) by the provider mode', () => {
  const undo: (() => void)[] = [];
  afterEach(() => {
    undo.splice(0).forEach((fn) => fn());
    sessionStorage.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('starts a custom provider through its registered look and never navigates', async () => {
    const start = vi.fn();
    undo.push(registerAuthProvider({ id: 'sso-popup', label: 'Continue with SSO', start }));
    const location = { href: '' };
    vi.stubGlobal('location', location);
    const client = fakeSessionClient({
      providers: [{ name: 'google', authUrl: '' }, { name: 'sso-popup', authUrl: '', mode: 'custom' }],
    });
    const { result } = renderHook(() => useAuth(), { wrapper: authWrapper(client) });
    await waitFor(() => expect(result.current.providers).toHaveLength(2));

    act(() => result.current.login('sso-popup'));

    expect(start).toHaveBeenCalledTimes(1);
    expect(location.href).toBe('');
    // The return URL is stored first, like a redirect sign-in.
    expect(sessionStorage.getItem('auth_return_url')).toBe('/');
  });

  it('does not navigate a custom provider that registered no start(), and says so', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const location = { href: '' };
    vi.stubGlobal('location', location);
    const client = fakeSessionClient({ providers: [{ name: 'orphan', authUrl: '', mode: 'custom' }] });
    const { result } = renderHook(() => useAuth(), { wrapper: authWrapper(client) });
    await waitFor(() => expect(result.current.providers).toHaveLength(1));

    act(() => result.current.login('orphan'));

    expect(location.href).toBe('');
    expect(error).toHaveBeenCalledWith(expect.stringContaining('no start() is registered'));
  });

  it('keeps redirecting every other provider to /api/auth/<id>, mode or not, and remembers it', async () => {
    const location = { href: '' };
    vi.stubGlobal('location', location);
    const client = fakeSessionClient({ providers: [{ name: 'github', authUrl: '' }] });
    const { result } = renderHook(() => useAuth(), { wrapper: authWrapper(client) });
    await waitFor(() => expect(result.current.providers).toHaveLength(1));

    act(() => result.current.login('github'));

    expect(location.href).toBe('/api/auth/github');
    expect(lastAuthProvider()).toBe('github');
  });
});

describe('LoginPage provider slots', () => {
  const renderLogin = (slots = {}, value = authValue({ user: null })) =>
    render(
      <MemoryRouter initialEntries={['/login']}>
        <IdentityWebAdaptersProvider adapters={{}}>
          <AuthContext.Provider value={value}>
            <Routes>
              <Route path="/login" element={<LoginPage slots={slots} />} />
            </Routes>
          </AuthContext.Provider>
        </IdentityWebAdaptersProvider>
      </MemoryRouter>,
    );

  it('renders BeforeProviders above and AfterProviders below the buttons, and hands them what they need', () => {
    const login = vi.fn();
    const { container } = renderLogin(
      {
        BeforeProviders: ({ providers }: { providers: { name: string }[] }) => <p>before {providers.map((p) => p.name).join(',')}</p>,
        AfterProviders: ({ login: start }: { login: (id: string) => void }) => <button onClick={() => start('sso-popup')}>use company SSO</button>,
      },
      authValue({ user: null, login }),
    );

    const text = container.textContent ?? '';
    expect(text.indexOf('before google')).toBeLessThan(text.indexOf('Continue with Google'));
    expect(text.indexOf('Continue with Google')).toBeLessThan(text.indexOf('use company SSO'));
    expect(text.indexOf('use company SSO')).toBeLessThan(text.indexOf('By signing in'));

    fireEvent.click(screen.getByRole('button', { name: 'use company SSO' }));
    expect(login).toHaveBeenCalledWith('sso-popup');
  });

  it('renders the same DOM as before when neither slot is passed', () => {
    const withSlots = renderLogin({ BeforeProviders: undefined, AfterProviders: undefined }).container.innerHTML;
    const without = renderLogin().container.innerHTML;
    expect(withSlots).toBe(without);
  });
});

describe('AuthCallbackPage names the provider to retry', () => {
  afterEach(() => sessionStorage.clear());

  const renderCallback = (path: string, route: string, login = vi.fn(), props: { provider?: string } = {}) => {
    render(
      <MemoryRouter initialEntries={[route]}>
        <AuthContext.Provider value={authValue({ user: null, login })}>
          <Routes>
            <Route path={path} element={<AuthCallbackPage {...props} />} />
          </Routes>
        </AuthContext.Provider>
      </MemoryRouter>,
    );
    return login;
  };

  it('restarts the provider that started the sign-in', async () => {
    rememberAuthProvider('github');
    const login = renderCallback('/auth/callback', '/auth/callback?error=access_denied');
    fireEvent.click(await screen.findByRole('button', { name: /try again/i }));
    expect(login).toHaveBeenCalledWith('github');
  });

  it('prefers the route, then the prop over both, and falls back to google', async () => {
    rememberAuthProvider('github');
    const fromRoute = renderCallback('/auth/callback/:provider', '/auth/callback/entra?error=access_denied');
    fireEvent.click(await screen.findByRole('button', { name: /try again/i }));
    expect(fromRoute).toHaveBeenCalledWith('entra');
  });

  it('ignores a route segment that is not a provider id', async () => {
    const login = renderCallback('/auth/callback/:provider', '/auth/callback/..%2F..%2Fevil?error=access_denied');
    fireEvent.click(await screen.findByRole('button', { name: /try again/i }));
    expect(login).toHaveBeenCalledWith('google');
  });

  it('lets the prop win', async () => {
    rememberAuthProvider('github');
    const login = renderCallback('/auth/callback', '/auth/callback?error=access_denied', vi.fn(), { provider: 'oidc' });
    fireEvent.click(await screen.findByRole('button', { name: /try again/i }));
    expect(login).toHaveBeenCalledWith('oidc');
  });
});

describe('provider ids', () => {
  it('accepts only registered-style ids', () => {
    expect(validAuthProviderId('github')).toBe('github');
    expect(validAuthProviderId('example-oidc')).toBe('example-oidc');
    for (const bad of ['', 'Google', '../x', 'a/b', '1abc', 'x'.repeat(40), undefined, null]) {
      expect(validAuthProviderId(bad as never)).toBeUndefined();
    }
  });

  it('survives blocked storage', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => rememberAuthProvider('github')).not.toThrow();
    vi.restoreAllMocks();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(lastAuthProvider()).toBeUndefined();
    vi.restoreAllMocks();
  });
});
