/**
 * `pages/Admin/OrganizationPage` (#726): the current organization's members
 * and invitations, as two parallel tabs. Write controls are disabled without
 * `org_members:write` / `org_invites:write`, the Invites tab gates itself on
 * `org_invites:read`, and the viewer's own row offers nothing (the API
 * refuses self-demotion). The org id is never sent: the service is called
 * without one.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render, mockUser, type MockUser } from '../../utils/test-utils';
import OrganizationPage from '../../../pages/Admin/OrganizationPage';
import * as service from '../../../services/organizations';

vi.mock('../../../services/organizations', async () => {
  const actual = await vi.importActual<typeof import('../../../services/organizations')>(
    '../../../services/organizations',
  );
  return {
    ...actual,
    getOrgMembers: vi.fn(),
    updateOrgMember: vi.fn(),
    removeOrgMember: vi.fn(),
    getOrgInvites: vi.fn(),
    createOrgInvite: vi.fn(),
    revokeOrgInvite: vi.fn(),
  };
});

const page = <T,>(items: T[]) => ({ items, total: items.length, page: 1, pageSize: 100, totalPages: 1 });

const SELF = 'test-user-id';
const OTHER = 'user-other';

const members: service.OrgMember[] = [
  { userId: SELF, email: 'test@example.com', displayName: 'Test User', role: 'org_admin', status: 'active', lastActiveAt: null, joinedAt: '2026-01-01T00:00:00Z' },
  { userId: OTHER, email: 'other@example.com', displayName: 'Other Person', role: 'contributor', status: 'active', lastActiveAt: null, joinedAt: '2026-01-01T00:00:00Z' },
];

const invite: service.OrgInvite = {
  id: 'invite-1',
  email: 'pending@example.com',
  role: 'viewer',
  status: 'pending',
  notes: null,
  expiresAt: '2099-01-01T00:00:00Z',
  createdAt: '2026-01-01T00:00:00Z',
  acceptedAt: null,
  invitedBy: { id: SELF, email: 'test@example.com' },
  acceptedBy: null,
};

function orgAdmin(permissions: string[]): MockUser {
  return {
    ...mockUser,
    roles: [{ name: 'org_admin' }],
    permissions,
    tenancyMode: 'multi',
    activeOrg: { id: 'org-a', name: 'Alpha', slug: 'alpha' },
    memberships: [{ orgId: 'org-a', name: 'Alpha', slug: 'alpha', role: 'org_admin' }],
  };
}

const ALL = ['org_members:read', 'org_members:write', 'org_invites:read', 'org_invites:write'];

function renderPage(permissions: string[]) {
  return render(<OrganizationPage />, {
    wrapperOptions: { route: '/admin/settings/organization', user: orgAdmin(permissions) },
  });
}

describe('OrganizationPage (#726)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(service.getOrgMembers).mockResolvedValue(page(members));
    vi.mocked(service.getOrgInvites).mockResolvedValue(page([invite]));
    vi.mocked(service.updateOrgMember).mockResolvedValue(members[1]);
    vi.mocked(service.removeOrgMember).mockResolvedValue(undefined);
    vi.mocked(service.createOrgInvite).mockResolvedValue(invite);
    vi.mocked(service.revokeOrgInvite).mockResolvedValue(undefined);
  });

  it('names the active organization and shows two tabs, Members first', async () => {
    renderPage(ALL);

    expect(screen.getByRole('heading', { name: 'Organization' })).toBeInTheDocument();
    expect(screen.getByText(/members of Alpha/)).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Members' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Invites' })).toBeInTheDocument();
    expect(await screen.findByText('Other Person')).toBeInTheDocument();
    // No org id is sent: the API acts on the session's org.
    expect(vi.mocked(service.getOrgMembers).mock.calls[0][0]).not.toHaveProperty('orgId');
  });

  it("enables role, suspend and remove on another member's row, never on the viewer's own", async () => {
    renderPage(ALL);
    const other = await screen.findByTestId(`member-${OTHER}`);
    const self = screen.getByTestId(`member-${SELF}`);

    expect(within(other).getByRole('button', { name: 'Suspend' })).toBeEnabled();
    expect(within(other).getByRole('button', { name: 'Remove' })).toBeEnabled();
    expect(within(other).getByRole('combobox')).not.toHaveAttribute('aria-disabled', 'true');
    expect(within(self).getByRole('button', { name: 'Suspend' })).toBeDisabled();
    expect(within(self).getByRole('button', { name: 'Remove' })).toBeDisabled();
    expect(within(self).getByRole('combobox')).toHaveAttribute('aria-disabled', 'true');
  });

  it('disables every member write control without org_members:write', async () => {
    renderPage(['org_members:read', 'org_invites:read']);
    const other = await screen.findByTestId(`member-${OTHER}`);

    expect(within(other).getByRole('button', { name: 'Suspend' })).toBeDisabled();
    expect(within(other).getByRole('button', { name: 'Remove' })).toBeDisabled();
    expect(within(other).getByRole('combobox')).toHaveAttribute('aria-disabled', 'true');
  });

  it('changes a role, suspends and removes (after confirming) through the service', async () => {
    const user = userEvent.setup();
    renderPage(ALL);
    const other = await screen.findByTestId(`member-${OTHER}`);

    await user.click(within(other).getByRole('combobox'));
    await user.click(await screen.findByRole('option', { name: 'Viewer' }));
    await waitFor(() => expect(service.updateOrgMember).toHaveBeenCalledWith(OTHER, { roleName: 'viewer' }));

    await user.click(within(other).getByRole('button', { name: 'Suspend' }));
    await waitFor(() => expect(service.updateOrgMember).toHaveBeenCalledWith(OTHER, { status: 'suspended' }));

    await user.click(within(screen.getByTestId(`member-${OTHER}`)).getByRole('button', { name: 'Remove' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(service.removeOrgMember).toHaveBeenCalledWith(OTHER));
  });

  it("shows the API's refusal (the last administrator)", async () => {
    const user = userEvent.setup();
    vi.mocked(service.updateOrgMember).mockRejectedValue(
      new Error('This would leave the organization without an active administrator.'),
    );
    renderPage(ALL);
    const other = await screen.findByTestId(`member-${OTHER}`);

    await user.click(within(other).getByRole('button', { name: 'Suspend' }));

    expect(await screen.findByText(/without an active administrator/)).toBeInTheDocument();
  });

  describe('the Invites tab', () => {
    it('lists the invitations and invites a member', async () => {
      const user = userEvent.setup();
      renderPage(ALL);
      await user.click(screen.getByRole('tab', { name: 'Invites' }));

      expect(await screen.findByText('pending@example.com')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Invite member' }));
      const dialog = await screen.findByRole('dialog');
      await user.type(within(dialog).getByLabelText(/Email/), 'new@example.com');
      await user.click(within(dialog).getByRole('button', { name: 'Send invitation' }));

      await waitFor(() =>
        expect(service.createOrgInvite).toHaveBeenCalledWith({ email: 'new@example.com', roleName: 'viewer' }),
      );
    });

    it('revokes a pending invitation', async () => {
      const user = userEvent.setup();
      renderPage(ALL);
      await user.click(screen.getByRole('tab', { name: 'Invites' }));
      const row = await screen.findByTestId('invite-invite-1');

      await user.click(within(row).getByRole('button', { name: 'Revoke' }));

      await waitFor(() => expect(service.revokeOrgInvite).toHaveBeenCalledWith('invite-1'));
    });

    it('disables Invite and Revoke without org_invites:write', async () => {
      const user = userEvent.setup();
      renderPage(['org_members:read', 'org_invites:read']);
      await user.click(screen.getByRole('tab', { name: 'Invites' }));
      const row = await screen.findByTestId('invite-invite-1');

      expect(screen.getByRole('button', { name: 'Invite member' })).toBeDisabled();
      expect(within(row).getByRole('button', { name: 'Revoke' })).toBeDisabled();
    });

    it('gates its content on org_invites:read, inside the page', async () => {
      const user = userEvent.setup();
      renderPage(['org_members:read', 'org_members:write']);
      await user.click(screen.getByRole('tab', { name: 'Invites' }));

      expect(screen.getByText(/do not have permission to view this organization's invitations/)).toBeInTheDocument();
      expect(service.getOrgInvites).not.toHaveBeenCalled();
    });
  });
});
