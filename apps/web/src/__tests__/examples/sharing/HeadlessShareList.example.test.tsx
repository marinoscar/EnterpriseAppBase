/**
 * Issue #732. The headless hooks example (./HeadlessShareList.example.tsx):
 * the app's own markup over `useGrants`, `useShareActions` and
 * `useSharedWithMe`, on the reference app's platform host (msw).
 */

import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';

import { server } from '../../mocks/server';
import { mockUser, renderWithProviders } from '../../utils/test-utils';
import { CompactShareList, SharedNotes } from './HeadlessShareList.example';
import { NOTE_ID, SHARING_PERMISSIONS, page, sharedItem, userGrant } from './fixtures';

const user = { ...mockUser, permissions: [...mockUser.permissions, ...SHARING_PERMISSIONS] };
const RESOURCE = { type: 'example_note', id: NOTE_ID };

describe('headless sharing hooks example (#732)', () => {
  it('lists grants in custom markup and revokes one, then refreshes', async () => {
    let grants = [userGrant(), userGrant({ id: '00000000-0000-4000-8000-0000000000f4', grantee: { kind: 'group', userId: null, email: null, displayName: null, groupId: '00000000-0000-4000-8000-0000000000b1', groupName: 'Family' }, role: 'editor' })];
    const revoked: string[] = [];
    server.use(
      http.get('*/api/grants', ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get('resourceType')).toBe('example_note');
        return HttpResponse.json({ data: page(grants) });
      }),
      http.delete('*/api/grants/:id', ({ params }) => {
        revoked.push(params.id as string);
        grants = grants.filter((grant) => grant.id !== params.id);
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderWithProviders(<CompactShareList resource={RESOURCE} />, { wrapperOptions: { user } });
    const access = await screen.findByRole('region', { name: 'Access' });
    expect(await within(access).findByText('Ana')).toBeInTheDocument();
    expect(within(access).getByText('Family')).toBeInTheDocument();

    await userEvent.setup().click(within(access).getByRole('button', { name: 'Remove Ana' }));
    await waitFor(() => expect(within(access).queryByText('Ana')).toBeNull());
    expect(revoked).toEqual([userGrant().id]);
  });

  it('shows a refusal with the message the API gave', async () => {
    server.use(http.get('*/api/grants', () => HttpResponse.json({ message: 'Not found' }, { status: 404 })));
    renderWithProviders(<CompactShareList resource={RESOURCE} />, { wrapperOptions: { user } });
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('lists the notes shared with the viewer', async () => {
    server.use(http.get('*/api/grants/shared-with-me', () => HttpResponse.json({ data: page([sharedItem()]) })));
    renderWithProviders(<SharedNotes />, { wrapperOptions: { user } });
    const link = await screen.findByRole('link', { name: 'Trip plan (editor)' });
    expect(link).toHaveAttribute('href', `/notes/${NOTE_ID}`);
  });
});
