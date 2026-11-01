import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { GroupsPage, PendingGroupInvites, groupsSettingsPage } from '../../src/sharing/ui/index.js';
import { createTestApiError } from '../../src/testing/index.js';
import type { TestApiRequest } from '../../src/testing/index.js';
import { GROUP_ID, group, myInvite, page } from './fixtures.js';
import { currentPath, makeHost, renderRoute } from './harness.js';

const OTHER = group({ id: '00000000-0000-4000-8000-0000000000b9', name: 'Everyone else', myRole: null, memberCount: 9 });

function responses(extra: Record<string, unknown> = {}) {
  return {
    'GET /groups': (request: TestApiRequest) => (request.path.includes('scope=all') ? page([group(), OTHER]) : page([group()])),
    'GET /groups/invites/mine': { items: [] },
    ...extra,
  };
}

describe('GroupsPage (#731)', () => {
  it('names the page as its descriptor card does and lists the viewer\'s groups', async () => {
    renderRoute(makeHost(responses()), <GroupsPage />, '/settings/groups', '/settings/groups');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(groupsSettingsPage.card.title);
    expect(screen.getByText(groupsSettingsPage.card.description)).toBeTruthy();
    const list = await screen.findByRole('list', { name: 'Your groups' });
    const link = within(list).getByRole('link', { name: /Design team/ });
    expect(link.getAttribute('href')).toBe(`/settings/groups/${GROUP_ID}`);
    expect(within(list).getByText('Admin')).toBeTruthy();
  });

  it('declares groups:read, the string the /api/groups controller enforces', () => {
    expect(groupsSettingsPage.card).toEqual({
      title: 'Groups',
      description: groupsSettingsPage.card.description,
      path: '/settings/groups',
      permission: 'groups:read',
    });
    expect(groupsSettingsPage.Page).toBe(GroupsPage);
  });

  it('offers "All groups" only to a groups:admin holder, and asks for scope=all', async () => {
    const user = userEvent.setup();
    const plain = makeHost(responses(), ['groups:read', 'groups:write']);
    const first = renderRoute(plain, <GroupsPage />, '/settings/groups', '/settings/groups');
    await screen.findByRole('list', { name: 'Your groups' });
    expect(screen.queryByLabelText('All groups')).toBeNull();
    first.unmount();

    const admin = makeHost(responses(), ['groups:read', 'groups:write', 'groups:admin']);
    renderRoute(admin, <GroupsPage />, '/settings/groups', '/settings/groups');
    await screen.findByRole('list', { name: 'Your groups' });
    await user.click(screen.getByLabelText('All groups'));
    const all = await screen.findByRole('list', { name: 'All groups' });
    expect(within(all).getByText('Everyone else')).toBeTruthy();
    expect(admin.requests.some((r) => r.path.includes('scope=all'))).toBe(true);
  });

  it('creates a group and opens it', async () => {
    const user = userEvent.setup();
    const created = group({ id: '00000000-0000-4000-8000-0000000000b5', name: 'Climbers' });
    const host = makeHost(responses({ 'POST /groups': created }));
    renderRoute(host, <GroupsPage />, '/settings/groups', '/settings/groups');
    await screen.findByRole('list', { name: 'Your groups' });

    await user.click(screen.getByRole('button', { name: 'New group' }));
    const dialog = screen.getByRole('dialog', { name: 'New group' });
    await user.type(within(dialog).getByLabelText(/Name/), '  Climbers ');
    await user.click(within(dialog).getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(currentPath).toBe(`/settings/groups/${created.id}`));
    expect(host.requests.find((r) => r.method === 'POST')?.body).toEqual({ name: 'Climbers', description: null, metadata: null });
  });

  it('shows the server refusal in the create dialog', async () => {
    const user = userEvent.setup();
    const host = makeHost(
      responses({
        'POST /groups': () => {
          throw createTestApiError(409, 'You have created the maximum number of groups', undefined, { reason: 'GROUP_LIMIT_REACHED' });
        },
      }),
    );
    renderRoute(host, <GroupsPage />, '/settings/groups', '/settings/groups');
    await screen.findByRole('list', { name: 'Your groups' });
    await user.click(screen.getByRole('button', { name: 'New group' }));
    await user.type(screen.getByLabelText(/Name/), 'One more');
    await user.click(screen.getByRole('button', { name: 'Create' }));
    expect(await screen.findByText('You have created the maximum number of groups')).toBeTruthy();
  });

  it('hides "New group" without groups:write', async () => {
    renderRoute(makeHost(responses(), ['groups:read']), <GroupsPage />, '/settings/groups', '/settings/groups');
    await screen.findByRole('list', { name: 'Your groups' });
    expect(screen.queryByRole('button', { name: 'New group' })).toBeNull();
  });

  it('shows pending invitations on top; accepting one refreshes the groups', async () => {
    const user = userEvent.setup();
    let accepted = false;
    const host = makeHost(
      responses({
        'GET /groups/invites/mine': () => ({ items: accepted ? [] : [myInvite()] }),
        [`POST /groups/invites/${myInvite().id}/accept`]: () => {
          accepted = true;
          return { groupId: myInvite().groupId, orgId: myInvite().orgId, role: 'editor' };
        },
      }),
    );
    renderRoute(host, <GroupsPage />, '/settings/groups', '/settings/groups');
    const invites = await screen.findByRole('list', { name: 'Pending group invitations' });
    expect(within(invites).getByText('Book club')).toBeTruthy();
    const groupLoads = () => host.requests.filter((r) => r.method === 'GET' && r.path.startsWith('/groups?')).length;
    const before = groupLoads();

    await user.click(within(invites).getByRole('button', { name: 'Accept the invitation to Book club' }));
    await waitFor(() => expect(screen.queryByRole('list', { name: 'Pending group invitations' })).toBeNull());
    await waitFor(() => expect(groupLoads()).toBeGreaterThan(before));
  });
});

describe('PendingGroupInvites (#731)', () => {
  it('declines an invitation', async () => {
    const user = userEvent.setup();
    let declined = false;
    const host = makeHost({
      'GET /groups/invites/mine': () => ({ items: declined ? [] : [myInvite()] }),
      [`POST /groups/invites/${myInvite().id}/decline`]: () => {
        declined = true;
        return undefined;
      },
    });
    renderRoute(host, <PendingGroupInvites />);
    await user.click(await screen.findByRole('button', { name: 'Decline the invitation to Book club' }));
    await waitFor(() => expect(host.requests.some((r) => r.path === `/groups/invites/${myInvite().id}/decline`)).toBe(true));
    await waitFor(() => expect(screen.queryByTestId('pending-group-invites')).toBeNull());
  });

  it('renders nothing while there is no invitation', async () => {
    const host = makeHost({ 'GET /groups/invites/mine': { items: [] } });
    renderRoute(host, <PendingGroupInvites />);
    await waitFor(() => expect(host.requests).toHaveLength(1));
    expect(screen.queryByTestId('pending-group-invites')).toBeNull();
  });

  it('shows an expired invitation\'s refusal', async () => {
    const user = userEvent.setup();
    const host = makeHost({
      'GET /groups/invites/mine': { items: [myInvite()] },
      [`POST /groups/invites/${myInvite().id}/accept`]: () => {
        throw createTestApiError(410, 'This invitation has expired. Ask a group admin to invite you again.', undefined, {
          reason: 'INVITE_EXPIRED',
        });
      },
    });
    renderRoute(host, <PendingGroupInvites />);
    await user.click(await screen.findByRole('button', { name: 'Accept the invitation to Book club' }));
    expect(await screen.findByText('This invitation has expired. Ask a group admin to invite you again.')).toBeTruthy();
  });
});
