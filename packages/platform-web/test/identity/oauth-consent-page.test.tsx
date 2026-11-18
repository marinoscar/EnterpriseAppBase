// The OAuth consent page (PP-15.7, #1185; docs/specs/oauth-server.md §2.19).

import { act, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useState } from 'react';
import type { ReactElement } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { PlatformHostProvider } from '../../src/core/index.js';
import { AuthContext, IdentityWebAdaptersProvider, RequireAuth } from '../../src/identity/headless/index.js';
import type { AuthUser } from '../../src/identity/headless/index.js';
import { CONSENT_ALLOW_DELAY_MS, LoginPage, OAuthConsentPage, defaultConsentSelection } from '../../src/identity/ui/index.js';
import { createTestApiError, createTestPlatformHost } from '../../src/testing/index.js';
import { USER, authValue } from './harness.js';
import { LocationProbe, ORG_A, ORG_B, REQUEST_ID, consentRequest, mountOAuth } from './oauth-fixtures.js';

const ROUTE = `/oauth/consent?request=${REQUEST_ID}`;
const READ = `GET /oauth/requests/${REQUEST_ID}`;
const DECIDE = `POST /oauth/requests/${REQUEST_ID}/decision`;

function mountConsent(request = consentRequest(), extra: Parameters<typeof mountOAuth>[1] = {}) {
  const navigateTo = vi.fn();
  const result = mountOAuth(<OAuthConsentPage navigateTo={navigateTo} />, {
    route: ROUTE,
    path: '/oauth/consent',
    ...extra,
    responses: {
      [READ]: request,
      [DECIDE]: { redirectTo: 'https://callback.example.test/cb?code=c1&state=s1' },
      ...extra.responses,
    },
  });
  return { ...result, navigateTo };
}

async function allowEnabled() {
  const allow = screen.getByRole('button', { name: 'Allow' });
  await waitFor(() => expect(allow).toBeEnabled(), { timeout: CONSENT_ALLOW_DELAY_MS + 1000 });
  return allow;
}

describe('OAuthConsentPage: who is asking and where you go', () => {
  it('leads with the host, names itself second, shows the redirect host and the signed-in email', async () => {
    mountConsent();
    const heading = await screen.findByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent('chat.example.test wants to connect to Product X');
    expect(within(heading).getByText('chat.example.test').tagName).toBe('STRONG');
    expect(screen.getByText('It calls itself: Example Assistant')).toBeInTheDocument();
    expect(screen.getByText('callback.example.test').tagName).toBe('STRONG');
    expect(screen.getByText(USER.email)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Not you? Switch account' })).toBeInTheDocument();
    expect(screen.getByText('Stay connected without asking again.')).toBeInTheDocument();
    expect(screen.getByText(/never sees your password or your sign-in to Product X/)).toBeInTheDocument();
  });

  it('starts focus on the heading block, not on Allow', async () => {
    mountConsent();
    await screen.findByRole('heading', { level: 1 });
    await waitFor(() => expect(screen.getByTestId('oauth-consent-heading')).toHaveFocus());
    expect(screen.getByRole('button', { name: 'Allow' })).not.toHaveFocus();
  });

  it('warns on a loopback redirect and says when the client is new', async () => {
    mountConsent(
      consentRequest({
        isLoopbackRedirect: true,
        redirectHost: 'localhost',
        client: { ...consentRequest().client, isNewToDeployment: true },
      }),
    );
    expect(
      await screen.findByText('This app runs on your own computer. Only continue if you started this yourself, just now.'),
    ).toBeInTheDocument();
    expect(screen.getByText('New here: nobody on this Product X has connected this app before.')).toBeInTheDocument();
  });

  it('shows the first-time notice for an old client when no other user has connected it', async () => {
    mountConsent(consentRequest({ client: { ...consentRequest().client, firstSeenAt: '2020-01-01T00:00:00.000Z', isNewToDeployment: true } }));
    expect(await screen.findByText('New here: nobody on this Product X has connected this app before.')).toBeInTheDocument();
  });

  it('shows neither notice for an old client and a web redirect', async () => {
    mountConsent();
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByText(/This app runs on your own computer/)).not.toBeInTheDocument();
    expect(screen.queryByText(/New here/)).not.toBeInTheDocument();
  });

  it('renders the logo only when https: and on the client host, without a referrer', async () => {
    const { container, unmount } = mountConsent();
    await screen.findByRole('heading', { level: 1 });
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('src')).toBe('https://chat.example.test/logo.png');
    expect(img?.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(img?.getAttribute('alt')).toBe('');
    unmount();

    for (const logoUri of ['http://chat.example.test/logo.png', 'https://cdn.example.test/logo.png', 'javascript:alert(1)']) {
      const mounted = mountConsent(consentRequest({ client: { ...consentRequest().client, logoUri } }));
      await screen.findByRole('heading', { level: 1 });
      expect(mounted.container.querySelector('img'), logoUri).toBeNull();
      mounted.unmount();
    }
  });
});

describe('OAuthConsentPage: scopes', () => {
  it('ticks low scopes, leaves elevated and high unticked, and lists required scopes without a checkbox', async () => {
    mountConsent();
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByRole('checkbox', { name: /Read runs/ })).not.toBeInTheDocument();
    expect(screen.getByText('(always included)')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /List runs/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Start runs/ })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Delete runs/ })).not.toBeChecked();
    expect(screen.getByText('Warning: Deletes runs for good.')).toBeInTheDocument();
    // Risk is in words, not only colour.
    expect(screen.getByText('Sensitive access')).toBeInTheDocument();
    expect(screen.getByText('High risk. Off unless you tick it.')).toBeInTheDocument();
  });

  it('pre-ticks an elevated scope an active grant already holds, never a high one', () => {
    const scopes = consentRequest().scopes.map((scope) => ({ ...scope, alreadyGranted: true }));
    const selected = defaultConsentSelection(scopes);
    expect([...selected].sort()).toEqual(['runs:list', 'runs:read', 'runs:write']);
  });

  it('disables a scope the account cannot use, with the explanation', async () => {
    const request = consentRequest();
    request.scopes[2] = { ...request.scopes[2]!, grantable: false };
    mountConsent(request);
    const box = await screen.findByRole('checkbox', { name: /Start runs/ });
    expect(box).toBeDisabled();
    expect(screen.getByText('Your account cannot do this, so the app will not be able to either.')).toBeInTheDocument();
  });

  it('posts exactly the ticked scopes', async () => {
    const user = userEvent.setup();
    const { host, navigateTo } = mountConsent();
    await screen.findByRole('heading', { level: 1 });
    await user.click(screen.getByRole('checkbox', { name: /Delete runs/ }));
    await user.click(screen.getByRole('checkbox', { name: /List runs/ }));
    await user.click(await allowEnabled());
    await waitFor(() => expect(navigateTo).toHaveBeenCalledWith('https://callback.example.test/cb?code=c1&state=s1'));
    const decision = host.requests.find((request) => request.method === 'POST');
    expect(decision?.path).toBe(`/oauth/requests/${REQUEST_ID}/decision`);
    expect(decision?.body).toEqual({ decision: 'approve', scopes: ['runs:read', 'runs:admin'] });
  });

  it('posts the chosen organization in multi-organization mode', async () => {
    const user = userEvent.setup();
    const { host } = mountConsent(
      consentRequest({
        organizations: [
          { id: ORG_A, name: 'Org Alpha', isCurrent: true },
          { id: ORG_B, name: 'Org Beta', isCurrent: false },
        ],
      }),
    );
    const select = await screen.findByRole('combobox', { name: 'Organization' });
    expect(select).toHaveTextContent('Org Alpha');
    await user.click(select);
    await user.click(await screen.findByRole('option', { name: 'Org Beta' }));
    await user.click(await allowEnabled());
    await waitFor(() => expect(host.requests.some((request) => request.method === 'POST')).toBe(true));
    expect(host.requests.find((request) => request.method === 'POST')?.body).toEqual({
      decision: 'approve',
      scopes: ['runs:read', 'runs:list'],
      orgId: ORG_B,
    });
  });
});

describe('OAuthConsentPage: actions', () => {
  it('keeps Allow disabled for the first second', async () => {
    mountConsent();
    await screen.findByRole('heading', { level: 1 });
    expect(screen.getByRole('button', { name: 'Allow' })).toBeDisabled();
    await allowEnabled();
  });

  it('disables Allow while the decision is in flight', async () => {
    const user = userEvent.setup();
    let release: (value: unknown) => void = () => undefined;
    mountConsent(consentRequest(), {
      responses: { [DECIDE]: () => new Promise((resolve) => (release = resolve)) },
    });
    await screen.findByRole('heading', { level: 1 });
    await user.click(await allowEnabled());
    expect(await screen.findByRole('button', { name: 'Sending…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    await act(async () => release({ redirectTo: 'https://callback.example.test/cb' }));
  });

  it('Cancel posts deny and navigates', async () => {
    const user = userEvent.setup();
    const { host, navigateTo } = mountConsent(consentRequest(), {
      responses: { [DECIDE]: { redirectTo: 'https://callback.example.test/cb?error=access_denied' } },
    });
    await screen.findByRole('heading', { level: 1 });
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(navigateTo).toHaveBeenCalledWith('https://callback.example.test/cb?error=access_denied'));
    expect(host.requests.find((request) => request.method === 'POST')?.body).toEqual({ decision: 'deny' });
  });

  it('shows the expired state on a 410 at read', async () => {
    mountConsent(consentRequest(), {
      responses: {
        [READ]: () => {
          throw createTestApiError(410, 'Gone');
        },
      },
    });
    expect(await screen.findByRole('heading', { name: 'This request has expired' })).toHaveFocus();
    expect(screen.getByText('Go back to the app that sent you here and connect again.')).toBeInTheDocument();
  });

  it('shows the expired state on a 410 at submit', async () => {
    const user = userEvent.setup();
    const { navigateTo } = mountConsent(consentRequest(), {
      responses: {
        [DECIDE]: () => {
          throw createTestApiError(410, 'Gone');
        },
      },
    });
    await screen.findByRole('heading', { level: 1 });
    await user.click(await allowEnabled());
    expect(await screen.findByRole('heading', { name: 'This request has expired' })).toBeInTheDocument();
    expect(navigateTo).not.toHaveBeenCalled();
  });

  it('is expired without a request id, and takes nothing else from the URL', async () => {
    const { host } = mountOAuth(<OAuthConsentPage navigateTo={vi.fn()} />, {
      route: '/oauth/consent?client_id=https%3A%2F%2Fevil.example.test&scope=all',
      path: '/oauth/consent',
    });
    expect(await screen.findByRole('heading', { name: 'This request has expired' })).toBeInTheDocument();
    expect(host.requests).toEqual([]);
    expect(screen.queryByText(/evil/)).not.toBeInTheDocument();
  });

  it('Switch account signs out and returns to the login page with this URL as the destination', async () => {
    const user = userEvent.setup();
    const logout = vi.fn(async () => undefined);
    mountOAuth(<OAuthConsentPage navigateTo={vi.fn()} />, {
      route: ROUTE,
      path: '/oauth/consent',
      auth: { logout },
      responses: { [READ]: consentRequest() },
    });
    await user.click(await screen.findByRole('button', { name: 'Not you? Switch account' }));
    expect(logout).toHaveBeenCalled();
    expect(await screen.findByTestId('location')).toHaveTextContent('/login');
  });

  it('gives every control an accessible name', async () => {
    mountConsent();
    await screen.findByRole('heading', { level: 1 });
    for (const control of [...screen.getAllByRole('button'), ...screen.getAllByRole('checkbox')]) {
      expect(control).toHaveAccessibleName();
    }
  });
});

describe('OAuthConsentPage: sign-in round trip', () => {
  it('a signed-out visitor logs in and lands back on the consent page with the same request', async () => {
    const host = createTestPlatformHost({ responses: { [READ]: consentRequest() } });
    let signIn: (user: AuthUser) => void = () => undefined;
    function Harness(): ReactElement {
      const [user, setUser] = useState<AuthUser | null>(null);
      signIn = setUser;
      return (
        <AuthContext.Provider value={authValue({ user })}>
          <PlatformHostProvider host={host}>
            <IdentityWebAdaptersProvider adapters={{ appName: 'Product X' }}>
              <Routes>
                <Route path="/login" element={<><LoginPage /><LocationProbe /></>} />
                <Route element={<RequireAuth />}>
                  <Route path="/oauth/consent" element={<><OAuthConsentPage navigateTo={vi.fn()} /><LocationProbe /></>} />
                </Route>
              </Routes>
            </IdentityWebAdaptersProvider>
          </PlatformHostProvider>
        </AuthContext.Provider>
      );
    }
    render(
      <MemoryRouter initialEntries={[ROUTE]}>
        <Harness />
      </MemoryRouter>,
    );
    expect(await screen.findByTestId('location')).toHaveTextContent('/login');
    expect(host.requests).toEqual([]);
    await act(async () => signIn(USER));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(ROUTE));
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('chat.example.test wants to connect');
  });
});
