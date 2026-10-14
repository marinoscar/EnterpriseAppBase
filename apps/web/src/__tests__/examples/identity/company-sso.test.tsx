/**
 * Issue #927 (PP-14.9): a sign-in provider that owns its flow gets a button and
 * a start function from the app, and an extra control on the login page, with
 * no package edit.
 *
 * `platform-extensions/identity/company-sso.tsx` registers the look of a
 * `custom` provider with a `start`, and fills `LoginPage`'s `AfterProviders`
 * slot. The API lists such a provider with `mode: 'custom'`; the real
 * `AuthProvider` fetches that list over MSW, so the test proves the wire:
 * clicking the provider's button runs `start` and never navigates to
 * `/api/auth/<id>`, a redirect provider still does, and the slot appears only
 * when the API offers the provider.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '@marinoscar/platform-web/identity/headless';
import { LoginPage } from '@marinoscar/platform-web/identity/ui';
import { server } from '../../mocks/server';
import {
  COMPANY_SSO_ID,
  COMPANY_SSO_LOGIN_SLOTS,
  registerCompanySso,
} from '../../../platform-extensions/identity/company-sso';

const client = {
  get: async <T,>(path: string): Promise<T> => {
    const response = await fetch(`http://localhost/api${path}`);
    const body = (await response.json()) as { data?: T } & T;
    return (body.data ?? body) as T;
  },
  post: async <T,>(): Promise<T> => ({}) as T,
  setAccessToken: () => undefined,
  refreshToken: async () => false,
  onSessionExpired: () => () => undefined,
};

function offer(providers: unknown[]) {
  server.use(http.get('*/api/auth/providers', () => HttpResponse.json({ data: { providers } })));
}

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <AuthProvider client={client}>
        <LoginPage slots={COMPANY_SSO_LOGIN_SLOTS} />
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('company-sso on the login page (#927)', () => {
  let unregister: () => void;
  let start: ReturnType<typeof vi.fn>;
  let location: { href: string };

  beforeEach(() => {
    sessionStorage.clear();
    start = vi.fn();
    unregister = registerCompanySso(start);
    location = { href: '' };
    vi.stubGlobal('location', location);
  });

  afterEach(() => {
    unregister();
    vi.unstubAllGlobals();
  });

  it('starts a custom provider through its registered start() and does not navigate', async () => {
    offer([
      { name: 'google', enabled: true },
      { name: COMPANY_SSO_ID, enabled: true, mode: 'custom' },
    ]);
    renderLogin();

    await userEvent.click(await screen.findByRole('button', { name: 'Continue with company SSO' }));

    expect(start).toHaveBeenCalledTimes(1);
    expect(location.href).toBe('');
  });

  it('keeps sending a redirect provider to /api/auth/<id>', async () => {
    offer([{ name: 'google', enabled: true }]);
    renderLogin();

    await userEvent.click(await screen.findByRole('button', { name: 'Continue with Google' }));

    expect(location.href).toBe('/api/auth/google');
    expect(start).not.toHaveBeenCalled();
  });

  it('fills the AfterProviders slot only when the API offers the provider, and starts it through login', async () => {
    offer([{ name: COMPANY_SSO_ID, enabled: true, mode: 'custom' }]);
    renderLogin();

    await userEvent.click(await screen.findByRole('button', { name: 'Use company single sign-on' }));

    expect(start).toHaveBeenCalledTimes(1);
  });

  it('shows no slot content when the provider is not offered', async () => {
    offer([{ name: 'google', enabled: true }]);
    renderLogin();

    await screen.findByRole('button', { name: 'Continue with Google' });
    await waitFor(() => expect(screen.queryByText('Working for the company?')).not.toBeInTheDocument());
  });
});
