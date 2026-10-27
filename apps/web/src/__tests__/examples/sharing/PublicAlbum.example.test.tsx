/**
 * Issue #732. The link-renderer example (./PublicAlbumView.example.tsx) on the
 * public `/s` page, outside the authenticated shell, with the reference app's
 * transport (`appPlatformApi`) and the app's branding (`slots.Frame`): the
 * renderer calls the app's public route with the token in `x-link-token`,
 * shows the cover through the presigned URL, and the token leaves the
 * address bar.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { linkRenderers } from '@marinoscar/platform-web/sharing/headless';
import { PublicLinkPage } from '@marinoscar/platform-web/sharing/ui';

import { server } from '../../mocks/server';
import { appPlatformApi } from '../../../platform/platformHost';
import { PublicAlbumView, PublicFrame, registerExampleLinkRenderers } from './PublicAlbumView.example';
import { ALBUM_ID, TOKEN } from './fixtures';

const COVER = 'https://storage.example.test/covers/summer.jpg?X-Amz-Expires=300&X-Amz-Signature=fake';

function openLink(hash: string) {
  const location = window.location as unknown as Record<string, string>;
  Object.assign(location, { pathname: '/s', hash });
  vi.spyOn(window.history, 'replaceState').mockImplementation(() => {
    location.hash = '';
  });
  render(
    <MemoryRouter initialEntries={['/s']}>
      <PublicLinkPage apiClient={appPlatformApi} slots={{ Frame: PublicFrame }} />
    </MemoryRouter>,
  );
  return location;
}

describe('a registered link renderer on the public page (#732)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('registers the album renderer', () => {
    registerExampleLinkRenderers();
    expect(linkRenderers.get('example_album')).toBe(PublicAlbumView);
  });

  it("renders the album inside the app's frame, calling the public route with the token in the header", async () => {
    if (!linkRenderers.get('example_album')) registerExampleLinkRenderers();
    const headers: Array<string | null> = [];
    server.use(
      http.get('*/api/public/links/current', ({ request }) => {
        headers.push(request.headers.get('x-link-token'));
        return HttpResponse.json({ data: { resourceType: 'example_album', resourceId: ALBUM_ID, role: 'viewer', expiresAt: '2026-10-08T12:00:00.000Z', title: 'summer' } });
      }),
      http.get('*/api/public/albums/current', ({ request }) => {
        headers.push(request.headers.get('x-link-token'));
        expect(new URL(request.url).search).toBe('');
        return HttpResponse.json({ data: { id: ALBUM_ID, title: 'summer', coverUrl: COVER } });
      }),
    );
    const location = openLink(`#${TOKEN}`);
    expect(await screen.findByTestId('public-frame')).toHaveTextContent('Shared with you from Example Photos');
    const cover = await screen.findByRole('img', { name: 'Cover of summer' });
    expect(cover).toHaveAttribute('src', COVER);
    expect(cover.getAttribute('src')).not.toContain(TOKEN);
    expect(headers).toEqual([TOKEN, TOKEN]);
    expect(location.hash).toBe('');
  });

  it('shows the neutral message, still framed, for a link the API refuses', async () => {
    server.use(http.get('*/api/public/links/current', () => HttpResponse.json({ message: 'Link not found' }, { status: 404 })));
    openLink(`#${TOKEN}`);
    expect(await screen.findByText('This link is not available.')).toBeInTheDocument();
    expect(screen.getByTestId('public-frame')).toBeInTheDocument();
  });
});
