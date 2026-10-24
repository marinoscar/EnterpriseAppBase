import { render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter, MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LINK_TOKEN_HEADER } from '@marinoscar/platform-contract/sharing';
import { LinkRendererRegistry } from '../../src/sharing/headless/index.js';
import type { LinkRendererProps } from '../../src/sharing/headless/index.js';
import { PublicLinkPage } from '../../src/sharing/ui/index.js';
import { createTestApiError, createTestPlatformHost } from '../../src/testing/index.js';
import type { TestApiResponse } from '../../src/testing/index.js';
import { RESOLUTION, TOKEN } from './fixtures.js';

function TranscriptView({ resolution, token, apiClient }: LinkRendererProps) {
  return (
    <div>
      <h1>{resolution.title}</h1>
      <span data-testid="has-token">{String(token === TOKEN)}</span>
      <span data-testid="has-client">{String(typeof apiClient.get === 'function')}</span>
    </div>
  );
}

let routerHash = '';
function HashProbe() {
  routerHash = useLocation().hash;
  return null;
}

function renderAt(response: TestApiResponse, registry: LinkRendererRegistry, opts: { frame?: boolean } = {}) {
  const host = createTestPlatformHost({ responses: { 'GET /public/links/current': response } });
  window.history.replaceState(null, '', `/s#${TOKEN}`);
  const Frame = ({ children }: { children: React.ReactNode }) => (
    <div data-testid="brand-frame">
      <span>Acme</span>
      {children}
    </div>
  );
  render(
    <MemoryRouter initialEntries={[`/s#${TOKEN}`]}>
      <HashProbe />
      <Routes>
        <Route
          path="/s"
          element={<PublicLinkPage apiClient={host.api} registry={registry} {...(opts.frame ? { slots: { Frame } } : {})} />}
        />
      </Routes>
    </MemoryRouter>,
  );
  return host;
}

describe('PublicLinkPage (#731)', () => {
  let registry: LinkRendererRegistry;
  beforeEach(() => {
    registry = new LinkRendererRegistry();
    registry.register('transcript', TranscriptView);
  });
  afterEach(() => window.history.replaceState(null, '', '/'));

  it('removes the fragment, sends the token in the header and renders the registered renderer', async () => {
    const host = renderAt(RESOLUTION, registry);

    expect(await screen.findByRole('heading', { name: 'Quarterly review' })).toBeTruthy();
    expect(screen.getByTestId('has-token').textContent).toBe('true');
    expect(screen.getByTestId('has-client').textContent).toBe('true');

    // The address bar and the router's own location both lost the token.
    expect(window.location.hash).toBe('');
    await waitFor(() => expect(routerHash).toBe(''));

    expect(host.requests).toHaveLength(1);
    expect(host.requests[0]?.path).toBe('/public/links/current');
    expect(host.requests[0]?.headers?.[LINK_TOKEN_HEADER]).toBe(TOKEN);
  });

  it.each([
    ['unknown, expired or revoked', () => Promise.reject(createTestApiError(404, 'Link not found'))],
    ['throttled', () => Promise.reject(createTestApiError(429, 'Slow down', undefined, { retryAfterMs: 5000 }))],
    ['of a type with no renderer', () => ({ ...RESOLUTION, resourceType: 'album' })],
  ])('shows the same neutral message when the link is %s', async (_name, response) => {
    renderAt(response, registry);
    const message = await screen.findByTestId('public-link-unavailable');
    expect(message.textContent).toContain('This link is not available.');
    // Nothing tells which failure it was: the API's own words never show.
    expect(message.textContent).not.toMatch(/Link not found|Slow down|album|404|429/);
    expect(message.textContent).toBe(
      'This link is not available.It may have expired or been revoked, or the address is incomplete. Ask the person who shared it for a new link.',
    );
    expect(window.location.hash).toBe('');
  });

  it('reads the token before the router drops the fragment, under a BrowserRouter too', async () => {
    // A child's effect runs before its parent's: the router sync must not
    // clear the fragment before usePublicLink read it.
    const host = createTestPlatformHost({ responses: { 'GET /public/links/current': RESOLUTION } });
    window.history.replaceState(null, '', `/s#${TOKEN}`);
    render(
      <BrowserRouter>
        <HashProbe />
        <Routes>
          <Route path="/s" element={<PublicLinkPage apiClient={host.api} registry={registry} />} />
        </Routes>
      </BrowserRouter>,
    );
    expect(await screen.findByRole('heading', { name: 'Quarterly review' })).toBeTruthy();
    expect(host.requests).toHaveLength(1);
    expect(host.requests[0]?.headers?.[LINK_TOKEN_HEADER]).toBe(TOKEN);
    expect(window.location.hash).toBe('');
    await waitFor(() => expect(routerHash).toBe(''));
    expect(window.location.pathname).toBe('/s');
  });

  it('lets the app frame every state with its branding', async () => {
    renderAt(() => Promise.reject(createTestApiError(404, 'Link not found')), registry, { frame: true });
    const frame = await screen.findByTestId('brand-frame');
    expect(frame.textContent).toContain('Acme');
    expect(await screen.findByTestId('public-link-unavailable')).toBeTruthy();
  });
});
