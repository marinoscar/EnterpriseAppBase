/**
 * PP-14.25: an app adds a tab and a per-member action to the packaged group
 * page, and a section and a footer control to the packaged share dialog, with
 * no package edit.
 *
 * `GroupActivityTab.example.tsx` and `ShareExpirySection.example.tsx` are the
 * examples. These render the REAL packaged components
 * (`@marinoscar/platform-web/sharing/ui`) on the reference app's platform host
 * over MSW and pass the example slots. They also pin that the group page without
 * the slot keeps its two stacked cards.
 */
import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';

import { GroupDetailPage, ShareDialog } from '@marinoscar/platform-web/sharing/ui';
import { server } from '../../mocks/server';
import { mockUser, renderWithProviders } from '../../utils/test-utils';
import { GROUP_ID, NOTE_ID, SHARING_PERMISSIONS, group, page, userGrant } from './fixtures';
import { GROUP_ACTIVITY_SLOTS } from '../../../platform-extensions/sharing/GroupActivityTab.example';
import { SHARE_EXPIRY_SLOTS } from '../../../platform-extensions/sharing/ShareExpirySection.example';

const user = { ...mockUser, permissions: [...mockUser.permissions, ...SHARING_PERMISSIONS] };
const BASE = `*/api/groups/${GROUP_ID}`;

const member = (userId: string, email: string, displayName: string) => ({
  groupId: GROUP_ID,
  userId,
  role: 'viewer',
  email,
  displayName,
  addedById: null,
  createdAt: '2026-10-01T12:00:00.000Z',
});

function serveGroup() {
  server.use(
    http.get(BASE, () => HttpResponse.json({ data: group() })),
    http.get(`${BASE}/members`, () =>
      HttpResponse.json({ data: page([member(user.id, 'me@example.com', 'Me'), member('ana-id', 'ana@example.com', 'Ana')]) }),
    ),
    http.get(`${BASE}/invites`, () => HttpResponse.json({ data: page([]) })),
  );
}

function renderGroup(slots?: Parameters<typeof GroupDetailPage>[0]['slots']) {
  return renderWithProviders(
    <Routes>
      <Route path="/settings/groups/:id" element={<GroupDetailPage {...(slots ? { slots } : {})} />} />
    </Routes>,
    { wrapperOptions: { user, route: `/settings/groups/${GROUP_ID}` } },
  );
}

describe('the group page with an Activity tab and a member action', () => {
  it('appends the tab after Members and Invitations and renders the app panel with the group', async () => {
    serveGroup();
    renderGroup(GROUP_ACTIVITY_SLOTS);
    const tabs = await screen.findAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Members', 'Invitations', 'Activity']);
    await userEvent.click(screen.getByRole('tab', { name: 'Activity' }));
    const panel = await screen.findByRole('region', { name: 'Group activity' });
    expect(within(panel).getByText('Activity in Family')).toBeInTheDocument();
  });

  it('adds an Email action for the other members, not for the viewer\'s own row', async () => {
    serveGroup();
    renderGroup(GROUP_ACTIVITY_SLOTS);
    const table = await screen.findByRole('table', { name: 'Members' });
    expect(within(table).getByRole('link', { name: 'Email Ana' })).toHaveAttribute('href', 'mailto:ana@example.com');
    expect(within(table).queryByRole('link', { name: 'Email Me' })).toBeNull();
  });

  it('keeps the stacked Members and Invitations cards without the slot', async () => {
    serveGroup();
    renderGroup();
    expect(await screen.findByRole('table', { name: 'Members' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Invitations' })).toBeInTheDocument();
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
  });
});

describe('the share dialog with a section and a footer control', () => {
  const RESOURCE = { type: 'example_note', id: NOTE_ID };

  function renderDialog(slots?: Parameters<typeof ShareDialog>[0]['slots']) {
    server.use(
      http.get('*/api/grants', () => HttpResponse.json({ data: page([userGrant()]) })),
      http.get('*/api/groups', () => HttpResponse.json({ data: page([group()]) })),
    );
    return renderWithProviders(
      <ShareDialog
        open
        onClose={() => undefined}
        resource={RESOURCE}
        resourceTitle="Trip notes"
        roles={[{ value: 'viewer', label: 'Can view' }, { value: 'editor', label: 'Can edit' }]}
        {...(slots ? { slots } : {})}
      />,
      { wrapperOptions: { user } },
    );
  }

  it('draws the policy section above the people section and the footer control before Done', async () => {
    renderDialog(SHARE_EXPIRY_SLOTS);
    const dialog = await screen.findByRole('dialog', { name: 'Share "Trip notes"' });
    await within(dialog).findByRole('list', { name: 'Shared with' });
    const policy = within(dialog).getByRole('heading', { name: 'Sharing policy' });
    const people = within(dialog).getByRole('heading', { name: 'People and groups' });
    expect(policy.compareDocumentPosition(people) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(dialog).getByText(/Anyone you share this example note with/)).toBeInTheDocument();
    const audit = within(dialog).getByRole('link', { name: 'Open audit log' });
    expect(audit).toHaveAttribute('href', expect.stringContaining('/audit?resource=example_note%3A'));
    expect(audit.compareDocumentPosition(within(dialog).getByRole('button', { name: 'Done' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('is the dialog it always was without the slots', async () => {
    renderDialog();
    const dialog = await screen.findByRole('dialog', { name: 'Share "Trip notes"' });
    await within(dialog).findByRole('list', { name: 'Shared with' });
    expect(within(dialog).queryByRole('heading', { name: 'Sharing policy' })).toBeNull();
    expect(within(dialog).queryByRole('link', { name: 'Open audit log' })).toBeNull();
  });
});
