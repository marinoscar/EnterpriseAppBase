/**
 * PP-14.15: an app's own roles are assignable end to end from the packaged
 * identity pages, with no package edit and no web code.
 *
 * `coach` (an org role) and `support` (a system role) are registered by the API
 * (`apps/api/src/platform-extensions/identity/coach-support.roles.ts`) and
 * served by `GET /api/roles`. The dialogs read that list over MSW, so this test
 * proves the wire: the invite dialog and the member role select offer Coach, the
 * Manage roles dialog offers Support, a role registered `assignable: false`
 * (`service-bot`) is offered nowhere, and what the person picks is what the
 * API receives.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { OrganizationPage, UserList } from '@marinoscar/platform-web/identity/ui';
import { installLayoutStubs, resetContainerWidth } from '@marinoscar/platform-web/datatable/testing';
import { server } from '../../mocks/server';
import { mockAdminUser, render, type MockUser } from '../../utils/test-utils';

const ROLES = [
  { id: 'admin', label: 'System administrator', description: 'System administrator', scope: 'system', assignable: true },
  { id: 'support', label: 'Support', description: 'Reads the user list to help people; changes nothing', scope: 'system', assignable: true },
  { id: 'contributor', label: 'Contributor', description: 'Organization member', scope: 'org', assignable: true },
  { id: 'viewer', label: 'Viewer', description: 'Read-only organization member', scope: 'org', assignable: true },
  { id: 'org_admin', label: 'Administrator', description: 'Organization administrator', scope: 'org', assignable: true },
  { id: 'coach', label: 'Coach', description: 'Reviews the workouts of assigned athletes', scope: 'org', assignable: true },
  { id: 'service-bot', label: 'Service bot', description: 'Held by the application', scope: 'org', assignable: false },
];

const MEMBER = {
  userId: 'user-member',
  email: 'member@example.com',
  displayName: 'Member One',
  role: 'viewer',
  status: 'active',
  lastActiveAt: null,
  joinedAt: '2026-01-01T00:00:00Z',
};

const orgAdmin: MockUser = {
  ...mockAdminUser,
  roles: [{ name: 'org_admin' }],
  permissions: ['org_members:read', 'org_members:write', 'org_invites:read', 'org_invites:write'],
  tenancyMode: 'multi',
  activeOrg: { id: 'org-a', name: 'Alpha', slug: 'alpha' },
  memberships: [{ orgId: 'org-a', name: 'Alpha', slug: 'alpha', role: 'org_admin' }],
};

let invitesSent: unknown[];
let membersChanged: unknown[];
let rolesSaved: unknown[];

beforeAll(() => {
  installLayoutStubs();
});

beforeEach(() => {
  resetContainerWidth(1400);
  invitesSent = [];
  membersChanged = [];
  rolesSaved = [];
  server.use(
    http.get('*/api/roles', ({ request }) => {
      const scope = new URL(request.url).searchParams.get('scope');
      return HttpResponse.json({ data: ROLES.filter((role) => !scope || role.scope === scope) });
    }),
    http.get('*/api/org/members', () =>
      HttpResponse.json({ data: { items: [MEMBER], total: 1, page: 1, pageSize: 100, totalPages: 1 } }),
    ),
    http.get('*/api/org/invites', () =>
      HttpResponse.json({ data: { items: [], total: 0, page: 1, pageSize: 100, totalPages: 0 } }),
    ),
    http.post('*/api/org/invites', async ({ request }) => {
      const body = await request.json();
      invitesSent.push(body);
      return HttpResponse.json({ data: { id: 'invite-1', ...(body as object), status: 'pending' } }, { status: 201 });
    }),
    http.patch('*/api/org/members/:userId', async ({ request }) => {
      const body = await request.json();
      membersChanged.push(body);
      return HttpResponse.json({ data: { ...MEMBER, role: (body as { roleName?: string }).roleName ?? MEMBER.role } });
    }),
    http.put('*/api/users/:id/roles', async ({ params, request }) => {
      const body = (await request.json()) as { roleNames: string[] };
      rolesSaved.push(body);
      return HttpResponse.json({
        data: {
          id: params.id,
          email: 'test@example.com',
          displayName: 'Test User',
          providerDisplayName: null,
          profileImageUrl: null,
          providerProfileImageUrl: null,
          isActive: true,
          roles: body.roleNames,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
      });
    }),
  );
});

describe('an app role in the packaged organization page', () => {
  it('is offered in the invite dialog, with its label, and is what the API receives', async () => {
    const user = userEvent.setup();
    render(<OrganizationPage />, { wrapperOptions: { user: orgAdmin, route: '/admin/settings/organization' } });
    await user.click(await screen.findByRole('tab', { name: 'Invites' }));
    await user.click(await screen.findByRole('button', { name: 'Invite member' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/Email/), 'new@example.com');

    await user.click(within(dialog).getByRole('combobox', { name: 'Role' }));
    const options = (await screen.findAllByRole('option')).map((option) => option.textContent);
    // The role the app registered is there; the one it marked assignable: false is not.
    expect(options).toEqual(['Contributor', 'Viewer', 'Administrator', 'Coach']);

    await user.click(screen.getByRole('option', { name: 'Coach' }));
    await user.click(within(dialog).getByRole('button', { name: 'Send invitation' }));

    await waitFor(() => expect(invitesSent).toEqual([{ email: 'new@example.com', roleName: 'coach' }]));
  });

  it('is offered in the member role select', async () => {
    const user = userEvent.setup();
    render(<OrganizationPage />, { wrapperOptions: { user: orgAdmin, route: '/admin/settings/organization' } });
    const row = await screen.findByTestId('member-user-member');

    await user.click(within(row).getByRole('combobox'));
    await user.click(await screen.findByRole('option', { name: 'Coach' }));

    await waitFor(() => expect(membersChanged).toEqual([{ roleName: 'coach' }]));
  });
});

describe('app roles in the packaged Manage roles dialog', () => {
  async function openDialog(tenancyMode: 'single' | 'multi') {
    const user = userEvent.setup();
    render(<UserList />, { wrapperOptions: { user: { ...mockAdminUser, tenancyMode } } });
    await user.click(await screen.findByRole('button', { name: /Row actions for/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'Manage roles' }));
    return { user, dialog: within(await screen.findByRole('dialog')) };
  }

  const labelsOf = (dialog: ReturnType<typeof within>) =>
    dialog.getAllByRole('checkbox').map((box) => box.closest('label')?.textContent);

  it('multi-organization mode: the system role is offered next to admin, and is sent by role name', async () => {
    const { user, dialog } = await openDialog('multi');

    // System roles only: organization roles are managed per organization.
    await waitFor(() => expect(labelsOf(dialog)).toEqual(['System administrator', 'Support']));

    await user.click(dialog.getByRole('checkbox', { name: 'Support' }));
    await user.click(dialog.getByRole('button', { name: 'Save roles' }));

    await waitFor(() => expect(rolesSaved).toEqual([{ roleNames: ['support'] }]));
  });

  it('single-organization mode: the org roles join them, without org_admin and without an unassignable role', async () => {
    const { dialog } = await openDialog('single');

    await waitFor(() => expect(labelsOf(dialog)).toEqual(['System administrator', 'Support', 'Contributor', 'Viewer', 'Coach']));
  });
});
