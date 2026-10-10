import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { GroupDetailPage } from '../../src/sharing/ui/index.js';
import { createTestApiError } from '../../src/testing/index.js';
import type { TestApiResponse } from '../../src/testing/index.js';
import { ANA, GROUP_ID, ME, group, invite, member, page } from './fixtures.js';
import { currentPath, makeHost, renderRoute } from './harness.js';

const BASE = `/groups/${GROUP_ID}`;
const ANA_MEMBER = member({ userId: ANA, role: 'viewer', email: 'ana@example.com', displayName: 'Ana' });

function responses(extra: Record<string, TestApiResponse> = {}): Record<string, TestApiResponse> {
  return {
    [`GET ${BASE}`]: group(),
    [`GET ${BASE}/members`]: page([member(), ANA_MEMBER]),
    [`GET ${BASE}/invites`]: page([invite()]),
    ...extra,
  };
}

function renderPage(host = makeHost(responses())) {
  renderRoute(host, <GroupDetailPage />, `/settings/groups/${GROUP_ID}`, '/settings/groups/:id');
  return host;
}

const lastError = (testId: string) => screen.findByTestId(testId).then((el) => el.textContent);

describe('GroupDetailPage (#731)', () => {
  it('shows the group, its members and, for its admin, its invitations', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { level: 1, name: 'Design team' })).toBeTruthy();
    const members = await screen.findByRole('table', { name: 'Members' });
    expect(within(members).getByText('Me Myself (you)')).toBeTruthy();
    expect(within(members).getByText('Ana')).toBeTruthy();
    const invites = await screen.findByRole('table', { name: 'Pending invitations' });
    expect(within(invites).getByText('zoe@example.com')).toBeTruthy();
  });

  it('changes a member\'s role and removes a member', async () => {
    const user = userEvent.setup();
    const host = renderPage(
      makeHost(
        responses({
          [`PATCH ${BASE}/members/${ANA}`]: { ...ANA_MEMBER, role: 'editor' },
          [`DELETE ${BASE}/members/${ANA}`]: undefined,
        }),
      ),
    );
    const row = await screen.findByTestId(`member-${ANA}`);
    await user.click(within(row).getByRole('combobox'));
    await user.click(screen.getByRole('option', { name: 'Editor' }));
    await waitFor(() => expect(host.requests.find((r) => r.method === 'PATCH')?.body).toEqual({ role: 'editor' }));

    await user.click(within(row).getByRole('button', { name: 'Remove Ana' }));
    await waitFor(() => expect(host.requests.some((r) => r.method === 'DELETE' && r.path === `${BASE}/members/${ANA}`)).toBe(true));
  });

  it('explains LAST_GROUP_ADMIN when the last admin is demoted', async () => {
    const user = userEvent.setup();
    renderPage(
      makeHost(
        responses({
          [`PATCH ${BASE}/members/${ME}`]: () => {
            throw createTestApiError(409, 'This would leave the group without an admin.', undefined, { reason: 'LAST_GROUP_ADMIN' });
          },
        }),
      ),
    );
    const row = await screen.findByTestId(`member-${ME}`);
    await user.click(within(row).getByRole('combobox'));
    await user.click(screen.getByRole('option', { name: 'Viewer' }));
    expect(await lastError('group-error')).toBe('A group needs at least one admin. Make another member an admin first.');
  });

  it('lets a member leave, and explains when the last admin cannot', async () => {
    const user = userEvent.setup();
    let refuse = true;
    const host = makeHost(
      responses({
        [`DELETE ${BASE}/members/${ME}`]: () => {
          if (refuse) throw createTestApiError(409, 'No admin left', undefined, { reason: 'LAST_GROUP_ADMIN' });
          return undefined;
        },
      }),
    );
    renderPage(host);
    await user.click(await screen.findByRole('button', { name: 'Leave group' }));
    const dialog = screen.getByRole('dialog', { name: 'Leave Design team?' });
    await user.click(within(dialog).getByRole('button', { name: 'Leave' }));
    expect(await lastError('leave-error')).toBe('A group needs at least one admin. Make another member an admin first.');

    refuse = false;
    await user.click(within(dialog).getByRole('button', { name: 'Leave' }));
    await waitFor(() => expect(currentPath).toBe('/settings/groups'));
  });

  it('renames with the version in If-Match', async () => {
    const user = userEvent.setup();
    const host = makeHost(responses({ [`PATCH ${BASE}`]: group({ name: 'Design guild', version: 4 }) }));
    renderPage(host);
    await user.click(await screen.findByRole('button', { name: 'Rename' }));
    const dialog = screen.getByRole('dialog', { name: 'Rename group' });
    const name = within(dialog).getByLabelText(/Name/);
    await user.clear(name);
    await user.type(name, 'Design guild');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(host.requests.some((r) => r.method === 'PATCH' && r.path === BASE)).toBe(true));
    const patch = host.requests.find((r) => r.method === 'PATCH' && r.path === BASE)!;
    expect(patch.ifMatch).toBe('3');
    expect(patch.body).toEqual({ name: 'Design guild', description: 'People who review mockups' });
  });

  it('surfaces an If-Match conflict as "reload", and reloading fetches the current group', async () => {
    const user = userEvent.setup();
    const host = makeHost(
      responses({
        [`PATCH ${BASE}`]: () => {
          throw createTestApiError(409, 'Version conflict', undefined, { reason: 'VERSION_CONFLICT' });
        },
      }),
    );
    renderPage(host);
    await user.click(await screen.findByRole('button', { name: 'Rename' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    const alert = await screen.findByTestId('rename-error');
    expect(alert.textContent).toContain('Someone else changed this since you opened it. Reload to see the latest version');
    const loads = host.requests.filter((r) => r.method === 'GET' && r.path === BASE).length;
    await user.click(within(alert).getByRole('button', { name: 'Reload' }));
    await waitFor(() => expect(host.requests.filter((r) => r.method === 'GET' && r.path === BASE).length).toBe(loads + 1));
  });

  it('explains GROUP_OWNS_RESOURCES with the counts when deleting', async () => {
    const user = userEvent.setup();
    let owns = true;
    const host = makeHost(
      responses({
        [`DELETE ${BASE}`]: () => {
          if (owns) {
            throw createTestApiError(409, 'The group still owns resources.', undefined, {
              reason: 'GROUP_OWNS_RESOURCES',
              counts: { transcript: 2, media_item: 1 },
            });
          }
          return undefined;
        },
      }),
    );
    renderPage(host);
    await user.click(await screen.findByRole('button', { name: 'Delete group' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete Design team?' });
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(await lastError('delete-error')).toBe(
      'This group still owns 3 records (transcript: 2, media item: 1). Move them to another owner or delete them, then try again.',
    );

    owns = false;
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(currentPath).toBe('/settings/groups'));
  });

  it('creates and revokes invitations', async () => {
    const user = userEvent.setup();
    const host = makeHost(
      responses({
        [`POST ${BASE}/invites`]: invite({ id: '00000000-0000-4000-8000-0000000000d2', email: 'max@example.com' }),
        [`DELETE ${BASE}/invites/${invite().id}`]: undefined,
      }),
    );
    renderPage(host);
    await screen.findByRole('table', { name: 'Pending invitations' });
    await user.type(screen.getByLabelText('E-mail address'), 'Max@Example.com');
    await user.click(screen.getByRole('button', { name: 'Invite' }));
    await waitFor(() =>
      expect(host.requests.find((r) => r.method === 'POST')?.body).toEqual({ email: 'max@example.com', role: 'viewer' }),
    );

    await user.click(screen.getByRole('button', { name: 'Revoke the invitation to zoe@example.com' }));
    await waitFor(() => expect(host.requests.some((r) => r.method === 'DELETE' && r.path === `${BASE}/invites/${invite().id}`)).toBe(true));
  });

  it('shows the server refusal of an invitation', async () => {
    const user = userEvent.setup();
    renderPage(
      makeHost(
        responses({
          [`POST ${BASE}/invites`]: () => {
            throw createTestApiError(409, 'That address already has a pending invitation', undefined, { reason: 'INVITE_PENDING' });
          },
        }),
      ),
    );
    await screen.findByRole('table', { name: 'Pending invitations' });
    await user.type(screen.getByLabelText('E-mail address'), 'zoe@example.com');
    await user.click(screen.getByRole('button', { name: 'Invite' }));
    expect(await lastError('invite-error')).toBe('That address already has a pending invitation');
  });

  it('gives a plain member no management controls and no invitations request', async () => {
    const host = makeHost(responses({ [`GET ${BASE}`]: group({ myRole: 'viewer' }) }));
    renderPage(host);
    await screen.findByRole('table', { name: 'Members' });
    expect(screen.queryByRole('button', { name: 'Rename' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete group' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Remove / })).toBeNull();
    expect(screen.getByRole('button', { name: 'Leave group' })).toBeTruthy();
    expect(host.requests.some((r) => r.path.includes('/invites'))).toBe(false);
  });

  it('says a group it cannot see does not exist (404, never 403)', async () => {
    renderPage(
      makeHost({
        [`GET ${BASE}`]: () => {
          throw createTestApiError(404, 'Group not found');
        },
        [`GET ${BASE}/members`]: () => {
          throw createTestApiError(404, 'Group not found');
        },
      }),
    );
    expect(await screen.findByText('This group does not exist, or you are not a member of it.')).toBeTruthy();
  });
});
