// The packaged identity pages (issue #727): the LoginPage slots, the
// registry-driven OAuthButton, the callback page, the sign-in copy and the
// registry entries.

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AuthContext,
  IdentityWebAdaptersProvider,
  registerAuthProvider,
} from '../../src/identity/headless/index.js';
import type { AuthContextValue, IdentityWebAdapters } from '../../src/identity/headless/index.js';
import {
  AuthCallbackPage,
  LoginPage,
  OAuthButton,
  SIGN_IN_ERROR_CODES,
  createSignInErrorContent,
  identityAdminSections,
  identityUserSettingsSections,
  resolveSignInErrorCode,
} from '../../src/identity/ui/index.js';
import { authValue } from './harness.js';

function renderAt(ui: ReactNode, value: AuthContextValue, route = '/', adapters: IdentityWebAdapters = {}) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <IdentityWebAdaptersProvider adapters={adapters}>
        <AuthContext.Provider value={value}>
          <Routes>
            <Route path="/" element={<p>home</p>} />
            <Route path="/login" element={ui} />
            <Route path="/auth/callback" element={ui} />
            <Route path="/after" element={<p>after</p>} />
          </Routes>
        </AuthContext.Provider>
      </IdentityWebAdaptersProvider>
    </MemoryRouter>,
  );
}

describe('LoginPage', () => {
  it('renders the default title, one button per provider and the default footer', () => {
    const login = vi.fn();
    renderAt(<LoginPage />, authValue({ user: null, login }), '/login');
    expect(screen.getByRole('heading', { name: 'Welcome' })).toBeInTheDocument();
    expect(screen.getByText(/By signing in, you agree/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));
    expect(login).toHaveBeenCalledWith('google');
  });

  it('replaces the Logo, Title, Footer and ProviderButton slots', () => {
    renderAt(
      <LoginPage
        slots={{
          Logo: () => <p>app logo</p>,
          Title: () => <h1>Sign in to Acme</h1>,
          Footer: () => <p>legal links</p>,
          ProviderButton: ({ provider, onClick }) => <button onClick={onClick}>use {provider}</button>,
        }}
      />,
      authValue({ user: null }),
      '/login',
    );
    expect(screen.getByText('app logo')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Sign in to Acme' })).toBeInTheDocument();
    expect(screen.getByText('legal links')).toBeInTheDocument();
    expect(screen.queryByText(/By signing in, you agree/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'use google' })).toBeInTheDocument();
  });

  it('shows the session-expired notice and the no-provider text', () => {
    renderAt(<LoginPage />, authValue({ user: null, sessionExpired: true, providers: [] }), '/login');
    expect(screen.getByTestId('session-expired-notice')).toBeInTheDocument();
    expect(screen.getByText('No authentication providers configured')).toBeInTheDocument();
  });

  it("renders the app's spinner while loading", () => {
    renderAt(<LoginPage />, authValue({ user: null, isLoading: true }), '/login', {
      Spinner: ({ fullScreen }) => <p>app spinner {String(fullScreen)}</p>,
    });
    expect(screen.getByText('app spinner true')).toBeInTheDocument();
  });

  it('sends a signed-in user home', async () => {
    renderAt(<LoginPage />, authValue(), '/login');
    expect(await screen.findByText('home')).toBeInTheDocument();
  });
});

describe('OAuthButton', () => {
  const undo: (() => void)[] = [];
  afterEach(() => undo.splice(0).forEach((fn) => fn()));

  it('uses the built-in look, a registered look, then a generic one', () => {
    undo.push(registerAuthProvider({ id: 'oidc', label: 'Continue with SSO', Icon: () => <span>key</span> }));
    render(
      <>
        <OAuthButton provider="github" onClick={() => undefined} />
        <OAuthButton provider="oidc" onClick={() => undefined} />
        <OAuthButton provider="acme" onClick={() => undefined} />
      </>,
    );
    expect(screen.getByRole('button', { name: 'Continue with GitHub' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Continue with SSO/ })).toHaveTextContent('key');
    expect(screen.getByRole('button', { name: 'Continue with acme' })).toBeInTheDocument();
  });

  it('lets an app override a built-in look', () => {
    undo.push(registerAuthProvider({ id: 'google', label: 'Sign in with Workspace' }));
    render(<OAuthButton provider="google" onClick={() => undefined} />);
    expect(screen.getByRole('button', { name: 'Sign in with Workspace' })).toBeInTheDocument();
  });
});

describe('AuthCallbackPage', () => {
  afterEach(() => sessionStorage.clear());

  it('holds the token, reads the user and returns to the stored URL', async () => {
    sessionStorage.setItem('auth_return_url', '/after');
    const value = authValue({ user: null });
    renderAt(<AuthCallbackPage />, value, '/auth/callback?token=abc');
    expect(await screen.findByText('after')).toBeInTheDocument();
    expect(value.setAccessToken).toHaveBeenCalledWith('abc');
    expect(value.refreshUser).toHaveBeenCalled();
    expect(sessionStorage.getItem('auth_return_url')).toBeNull();
  });

  it('shows the copy for a known code and the generic copy for anything else, naming the app', async () => {
    renderAt(<AuthCallbackPage />, authValue({ user: null }), '/auth/callback?error=not_allowlisted', { appName: 'Acme' });
    expect(await screen.findByRole('heading', { name: "You don't have access yet" })).toBeInTheDocument();
    expect(screen.getByText(/isn't approved to use Acme yet/)).toBeInTheDocument();
  });

  it('never renders a free-text error and drops the token when /auth/me fails', async () => {
    const value = authValue({ user: null, refreshUser: vi.fn(async () => Promise.reject(new Error('no'))) });
    renderAt(<AuthCallbackPage />, value, '/auth/callback?token=abc');
    expect(await screen.findByRole('heading', { name: "We couldn't sign you in" })).toBeInTheDocument();
    await waitFor(() => expect(value.setAccessToken).toHaveBeenLastCalledWith(null));
  });

  it('restarts the configured provider from the error screen', async () => {
    const login = vi.fn();
    renderAt(<AuthCallbackPage provider="github" />, authValue({ user: null, login }), '/auth/callback?error=access_denied');
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(login).toHaveBeenCalledWith('github');
  });
});

describe('sign-in copy', () => {
  it('has copy for every code and narrows unknown values', () => {
    const content = createSignInErrorContent('Acme');
    expect(Object.keys(content).sort()).toEqual([...SIGN_IN_ERROR_CODES].sort());
    expect(resolveSignInErrorCode('<script>')).toBe('authentication_failed');
    expect(resolveSignInErrorCode('account_disabled')).toBe('account_disabled');
  });
});

describe('identity registry entries', () => {
  it('carry the exact permissions the identity controllers enforce, in order', () => {
    expect(identityAdminSections.access.map((c) => [c.path, c.permission])).toEqual([['/admin/settings/users', 'users:read']]);
    expect(identityAdminSections.organizations.map((c) => [c.path, c.permission, c.feature])).toEqual([
      ['/admin/settings/organization', 'org_members:read', 'orgs'],
      ['/admin/settings/organizations', 'organizations:read', 'orgs'],
    ]);
    expect(identityUserSettingsSections.security.map((c) => [c.path, c.permission])).toEqual([['/settings/tokens', undefined]]);
  });
});
