/**
 * Issue #731 (PP-7.4). The app's link renderers: how the public `/s` page
 * shows a resource type. A renderer registered with `registerLinkRenderer`
 * renders for a link of its type, with the token in memory and the app's
 * transport; `registerAppLinkRenderers()` (called from `main.tsx`) freezes the
 * registry, so a later registration is refused.
 *
 * The renderer here is a test fixture: the template registers none. The worked
 * example is ../examples/sharing/PublicAlbumView.example.tsx (#732).
 */

import { useEffect, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { LINK_TOKEN_HEADER } from '@marinoscar/platform-contract/sharing';
import { LinkRendererRegistryError, linkRenderers, registerLinkRenderer } from '@marinoscar/platform-web/sharing/headless';
import type { LinkRendererProps } from '@marinoscar/platform-web/sharing/headless';
import { PublicLinkPage } from '@marinoscar/platform-web/sharing/ui';

import { server } from '../mocks/server';
import { appPlatformApi } from '../../platform/platformHost';
import { registerAppLinkRenderers } from '../../platform/linkRenderers';

const TOKEN = 'lnk_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_abcde';
const NOTE_ID = '7d7e9c1a-0000-4000-8000-000000000001';

/** A public view of a `test_note`: reads the app's own public route with the token in the header. */
function PublicNoteView({ resolution, token, apiClient }: LinkRendererProps) {
  const [body, setBody] = useState<string | null>(null);
  useEffect(() => {
    void apiClient
      .get<{ body: string }>(`/public/test-notes/${resolution.resourceId}`, { headers: { [LINK_TOKEN_HEADER]: token } })
      .then((note) => setBody(note.body));
  }, [apiClient, resolution.resourceId, token]);
  return (
    <article>
      <h1>{resolution.title}</h1>
      <p>{body ?? 'Loading'}</p>
    </article>
  );
}

describe('app link renderers (#731)', () => {
  it('renders a registered renderer on /s, which calls the app route with the token in x-link-token', async () => {
    registerLinkRenderer('test_note', PublicNoteView);

    const seen: Array<string | null> = [];
    server.use(
      http.get('*/api/public/links/current', ({ request }) => {
        seen.push(request.headers.get('x-link-token'));
        return HttpResponse.json({
          data: { resourceType: 'test_note', resourceId: NOTE_ID, role: 'viewer', expiresAt: null, title: 'Shopping list' },
        });
      }),
      http.get(`*/api/public/test-notes/${NOTE_ID}`, ({ request }) => {
        seen.push(request.headers.get('x-link-token'));
        return HttpResponse.json({ data: { body: 'Milk, eggs' } });
      }),
    );

    // `setup.ts` makes `window.location` a plain object; the page's
    // `history.replaceState` (spied) clears its fragment.
    const location = window.location as unknown as Record<string, string>;
    Object.assign(location, { pathname: '/s', hash: `#${TOKEN}` });
    const replaceState = vi.spyOn(window.history, 'replaceState').mockImplementation(() => {
      location.hash = '';
    });
    try {
      render(
        <MemoryRouter initialEntries={['/s']}>
          <PublicLinkPage apiClient={appPlatformApi} />
        </MemoryRouter>,
      );
      expect(await screen.findByRole('heading', { name: 'Shopping list' })).toBeInTheDocument();
      expect(await screen.findByText('Milk, eggs')).toBeInTheDocument();
      expect(seen).toEqual([TOKEN, TOKEN]);
      expect(location.hash).toBe('');
    } finally {
      replaceState.mockRestore();
      Object.assign(location, { pathname: '/', hash: '' });
    }
  });

  it('freezes the registry once the app has registered its renderers', () => {
    registerAppLinkRenderers();
    expect(linkRenderers.isFrozen()).toBe(true);
    try {
      registerLinkRenderer('late_type', PublicNoteView);
      expect.unreachable('a registration after the freeze must throw');
    } catch (err) {
      expect(err).toBeInstanceOf(LinkRendererRegistryError);
      expect((err as LinkRendererRegistryError).code).toBe('FROZEN');
    }
  });
});
