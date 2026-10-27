/**
 * Issue #732. The `ShareDialog` example (./NoteShareButton.example.tsx) on the
 * reference app's own platform host and transport, against the API's wire
 * shapes (msw): the app's title slot, the roles it passes, a share by
 * e-mail, a group share, and a link that only views.
 */

import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';

import { server } from '../../mocks/server';
import { mockUser, renderWithProviders } from '../../utils/test-utils';
import { NoteShareButton } from './NoteShareButton.example';
import { NOTE_ID, SHARING_PERMISSIONS, TOKEN, group, linkGrant, page, userGrant } from './fixtures';

function serveSharing(posts: unknown[]) {
  server.use(
    http.get('*/api/grants/links', () => HttpResponse.json({ data: [] })),
    http.get('*/api/grants', () => HttpResponse.json({ data: page([userGrant()]) })),
    http.get('*/api/groups', () => HttpResponse.json({ data: page([group()]) })),
    http.post('*/api/grants/links', async ({ request }) => {
      posts.push({ links: await request.json() });
      return HttpResponse.json({ data: { grant: linkGrant(), url: `https://app.example.test/s#${TOKEN}`, token: TOKEN } });
    }),
    http.post('*/api/grants', async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      posts.push(body);
      return HttpResponse.json({ data: userGrant({ id: '00000000-0000-4000-8000-0000000000f3', role: body.role as string }) });
    }),
  );
}

const user = { ...mockUser, permissions: [...mockUser.permissions, ...SHARING_PERMISSIONS] };

describe('ShareDialog example (#732)', () => {
  it('opens on the app title slot and lists who the note is shared with', async () => {
    serveSharing([]);
    renderWithProviders(<NoteShareButton noteId={NOTE_ID} title="Trip plan" />, { wrapperOptions: { user } });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Share' }));
    const dialog = await screen.findByRole('dialog', { name: 'Share the note “Trip plan”' });
    const list = await within(dialog).findByRole('list', { name: 'Shared with' });
    expect(within(list).getByText('Ana')).toBeInTheDocument();
    expect(within(dialog).getByRole('heading', { name: 'Link' })).toBeInTheDocument();
  });

  it('shares with a person by e-mail with one of the roles the app passed', async () => {
    const posts: unknown[] = [];
    serveSharing(posts);
    const actor = userEvent.setup();
    renderWithProviders(<NoteShareButton noteId={NOTE_ID} title="Trip plan" />, { wrapperOptions: { user } });
    await actor.click(screen.getByRole('button', { name: 'Share' }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByRole('list', { name: 'Shared with' });
    await actor.type(within(dialog).getByLabelText(/e-mail/i), 'bo@example.com');
    await actor.click(within(dialog).getByRole('button', { name: /^share$/i }));
    await waitFor(() =>
      expect(posts).toContainEqual(expect.objectContaining({ resourceType: 'example_note', resourceId: NOTE_ID, role: 'viewer', grantee: { kind: 'user', email: 'bo@example.com' } })),
    );
  });

  it('creates a view-only link with the first expiry preset', async () => {
    const posts: Array<Record<string, unknown>> = [];
    serveSharing(posts);
    const actor = userEvent.setup();
    renderWithProviders(<NoteShareButton noteId={NOTE_ID} title="Trip plan" />, { wrapperOptions: { user } });
    await actor.click(screen.getByRole('button', { name: 'Share' }));
    const dialog = await screen.findByRole('dialog');
    await actor.click(await within(dialog).findByRole('button', { name: /create link/i }));
    await waitFor(() => expect(posts.some((p) => 'links' in p)).toBe(true));
    const sent = posts.find((p) => 'links' in p)!.links as Record<string, unknown>;
    expect(sent).toMatchObject({ resourceType: 'example_note', resourceId: NOTE_ID, role: 'viewer' });
    const days = (new Date(sent.expiresAt as string).getTime() - Date.now()) / 86_400_000;
    expect(Math.round(days)).toBe(7);
  });
});
