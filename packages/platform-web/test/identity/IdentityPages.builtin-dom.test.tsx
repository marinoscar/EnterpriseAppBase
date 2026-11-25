/**
 * The identity pages' markup did not move (PP-14.25).
 *
 * The users, organization, organizations, access-token, device-activation,
 * login and sign-in callback pages gained the page-slot contract
 * (`PageSlotsBase`, `TableSlots`, `Tabs`, the login layout slots). The snapshot
 * beside this file (`__snapshots__/`) was RECORDED FROM THE PAGES AS THEY WERE
 * BEFORE THAT CHANGE (the same fixtures, rendered by the old pages), so passing
 * means the page a person sees with no slot passed is, element for element and
 * class for class, the one they had.
 *
 * The only normalisation is React's generated ids (`_r_1f_`), which depend on
 * render order. Re-record only for a deliberate change of a page.
 */
import { act, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ActivateDevicePage,
  AuthCallbackPage,
  LoginPage,
  OrganizationPage,
  OrganizationsPage,
  UserTokensPage,
  UsersPage,
} from '../../src/identity/ui/index.js';
import type { AuthUser, OrgInvite, OrgMember, UserListItem } from '../../src/identity/headless/index.js';
import { answerWithBuiltinRoles, fakeIdentityApi } from './harness.js';
import { mockAdminUser, mockUser, render } from './render.js';

const service = fakeIdentityApi();

const html = (root: Element): string => root.innerHTML.replace(/_r_[0-9a-z]+_/g, '_rX_');

const page = <T,>(items: T[]) => ({ items, total: items.length, page: 1, pageSize: 100, totalPages: 1 });

const USERS: UserListItem[] = [
  {
    id: 'u-1',
    email: 'ada@example.com',
    displayName: 'Ada',
    providerDisplayName: 'Ada L',
    profileImageUrl: null,
    isActive: true,
    roles: ['admin'],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  },
  {
    id: 'u-2',
    email: 'bob@example.com',
    displayName: null,
    providerDisplayName: null,
    profileImageUrl: null,
    isActive: false,
    roles: ['viewer'],
    createdAt: '2026-01-03T00:00:00.000Z',
    updatedAt: '2026-01-04T00:00:00.000Z',
  },
];

const MEMBERS: OrgMember[] = [
  { userId: mockUser.id, email: 'ada@example.com', displayName: 'Ada', role: 'org_admin', status: 'active', lastActiveAt: null, joinedAt: '2026-01-01T00:00:00Z' },
  { userId: 'user-other', email: 'other@example.com', displayName: 'Other Person', role: 'contributor', status: 'suspended', lastActiveAt: null, joinedAt: '2026-01-01T00:00:00Z' },
];

const INVITE: OrgInvite = {
  id: 'invite-1',
  email: 'pending@example.com',
  role: 'viewer',
  status: 'pending',
  notes: null,
  expiresAt: '2099-01-01T00:00:00Z',
  createdAt: '2026-01-01T00:00:00Z',
  acceptedAt: null,
  invitedBy: { id: mockUser.id, email: 'ada@example.com' },
  acceptedBy: null,
};

const ORG_ADMIN: AuthUser = {
  ...mockUser,
  roles: [{ name: 'org_admin' }],
  permissions: ['org_members:read', 'org_members:write', 'org_invites:read', 'org_invites:write'],
  tenancyMode: 'multi',
  activeOrg: { id: 'org-a', name: 'Alpha', slug: 'alpha' },
  memberships: [{ orgId: 'org-a', name: 'Alpha', slug: 'alpha', role: 'org_admin' }],
};

beforeEach(() => {
  vi.clearAllMocks();
  answerWithBuiltinRoles(service);
  vi.mocked(service.getUsers).mockResolvedValue(page(USERS));
  vi.mocked(service.getAllowlist).mockResolvedValue(page([]));
  vi.mocked(service.getOrgMembers).mockResolvedValue(page(MEMBERS));
  vi.mocked(service.getOrgInvites).mockResolvedValue(page([INVITE]));
  vi.mocked(service.getPersonalAccessTokens).mockResolvedValue([]);
  vi.mocked(service.getOrganizations).mockResolvedValue(
    page([{ id: 'org-a', name: 'Alpha', slug: 'alpha', isDefault: false, status: 'active', memberCount: 3, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }]),
  );
});

describe("the identity pages' markup is unchanged", () => {
  it('the Users page, the Users tab', async () => {
    const { container } = render(<UsersPage />, {
      wrapperOptions: { route: '/admin/settings/users', user: mockAdminUser, adapters: { api: service } },
    });
    await screen.findByText('ada@example.com', {}, { timeout: 8000 });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(html(container)).toMatchSnapshot();
  });

  it('the Users page, the Allowlist tab', async () => {
    const { container } = render(<UsersPage />, {
      wrapperOptions: { route: '/admin/settings/users', user: mockAdminUser, adapters: { api: service } },
    });
    await screen.findByText('ada@example.com', {}, { timeout: 8000 });
    await userEvent.click(screen.getByRole('tab', { name: 'Allowlist' }));
    await waitFor(() => expect(service.getAllowlist).toHaveBeenCalled());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(html(container)).toMatchSnapshot();
  });

  it('the Organization page, the Members tab', async () => {
    const { container } = render(<OrganizationPage />, {
      wrapperOptions: { route: '/admin/settings/organization', user: ORG_ADMIN, adapters: { api: service } },
    });
    await screen.findByText('Other Person', {}, { timeout: 8000 });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(html(container)).toMatchSnapshot();
  });

  it('the Organization page, the Invites tab', async () => {
    const { container } = render(<OrganizationPage />, {
      wrapperOptions: { route: '/admin/settings/organization', user: ORG_ADMIN, adapters: { api: service } },
    });
    await screen.findByText('Other Person', {}, { timeout: 8000 });
    await userEvent.click(screen.getByRole('tab', { name: 'Invites' }));
    await screen.findByText('pending@example.com', {}, { timeout: 8000 });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(html(container)).toMatchSnapshot();
  });

  it('the Organizations page', async () => {
    const { container } = render(<OrganizationsPage />, {
      wrapperOptions: {
        route: '/admin/settings/organizations',
        user: { ...mockAdminUser, permissions: [...mockAdminUser.permissions, 'organizations:read', 'organizations:write'] },
        adapters: { api: service },
      },
    });
    await screen.findByText('Alpha', {}, { timeout: 8000 });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(html(container)).toMatchSnapshot();
  });

  it('the Access Tokens page', async () => {
    const { container } = render(<UserTokensPage />, {
      wrapperOptions: { route: '/settings/tokens', user: mockUser, adapters: { api: service } },
    });
    await waitFor(() => expect(service.getPersonalAccessTokens).toHaveBeenCalled());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(html(container)).toMatchSnapshot();
  });

  it('the device activation page, entering a code', () => {
    const { container } = render(<ActivateDevicePage />, {
      wrapperOptions: { route: '/activate', user: mockUser, adapters: { api: service } },
    });
    expect(html(container)).toMatchSnapshot();
  });

  it('the login page', () => {
    const { container } = render(<LoginPage />, { wrapperOptions: { route: '/login', authenticated: false } });
    expect(html(container)).toMatchSnapshot();
  });

  it('the sign-in callback page, completing', () => {
    const { container } = render(<AuthCallbackPage />, { wrapperOptions: { route: '/auth/callback?token=abc' } });
    expect(html(container)).toMatchSnapshot();
  });

  it('the sign-in callback page, a refused sign-in', async () => {
    const { container } = render(<AuthCallbackPage />, { wrapperOptions: { route: '/auth/callback?error=access_denied' } });
    await screen.findByRole('heading', {}, { timeout: 8000 });
    expect(html(container)).toMatchSnapshot();
  });
});
