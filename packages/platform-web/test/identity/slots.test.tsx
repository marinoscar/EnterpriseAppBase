// The identity pages' slots (PP-14.25): the packaged-page contract
// (`PageSlotsBase`), the table slots, `Tabs`, the login layout and the user
// extension readers. The markup with NO slot is pinned by
// IdentityPages.builtin-dom.test.tsx.

import { render as rtlRender, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useCurrentUserExtension, userExtension } from '../../src/identity/headless/index.js';
import type { AuthUser, OrgMember, UserListItem } from '../../src/identity/headless/index.js';
import {
  ActivateDevicePage,
  AuthCallbackPage,
  LoginPage,
  OrganizationPage,
  OrganizationsPage,
  UserTokensPage,
  UsersPage,
} from '../../src/identity/ui/index.js';
import type { UsersPageSlots } from '../../src/identity/ui/index.js';
import { answerWithBuiltinRoles, fakeIdentityApi } from './harness.js';
import { mockAdminUser, mockUser, render } from './render.js';

const service = fakeIdentityApi();
const page = <T,>(items: T[]) => ({ items, total: items.length, page: 1, pageSize: 100, totalPages: 1 });

const ADA: UserListItem = {
  id: 'u-1',
  email: 'ada@example.com',
  displayName: 'Ada',
  providerDisplayName: null,
  profileImageUrl: null,
  isActive: true,
  roles: ['admin'],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
  extensions: { billing: { plan: 'pro' } },
};
const BOB: UserListItem = { ...ADA, id: 'u-2', email: 'bob@example.com', displayName: 'Bob', roles: ['viewer'] };
delete (BOB as { extensions?: unknown }).extensions;

const MEMBER: OrgMember = {
  userId: 'user-other',
  email: 'other@example.com',
  displayName: 'Other Person',
  role: 'contributor',
  status: 'active',
  lastActiveAt: null,
  joinedAt: '2026-01-01T00:00:00Z',
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
  vi.mocked(service.getUsers).mockResolvedValue(page([ADA, BOB]));
  vi.mocked(service.getAllowlist).mockResolvedValue(page([]));
  vi.mocked(service.getOrgMembers).mockResolvedValue(page([MEMBER]));
  vi.mocked(service.getOrgInvites).mockResolvedValue(page([]));
  vi.mocked(service.getPersonalAccessTokens).mockResolvedValue([]);
  vi.mocked(service.getOrganizations).mockResolvedValue(
    page([{ id: 'org-a', name: 'Alpha', slug: 'alpha', isDefault: false, status: 'active', memberCount: 3, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }]),
  );
});

function renderUsers(slots?: UsersPageSlots) {
  return render(<UsersPage {...(slots ? { slots } : {})} />, {
    wrapperOptions: { route: '/admin/settings/users', user: mockAdminUser, adapters: { api: service } },
  });
}

describe('UsersPage slots', () => {
  it('draws the page slots in the contract order around the tabs', async () => {
    renderUsers({
      Header: ({ title, description, readOnly }) => (
        <h1 data-testid="header">
          {String(title)} / {String(description)} / {String(readOnly)}
        </h1>
      ),
      BeforeContent: () => <p data-testid="before">before</p>,
      Sections: ({ position }) => <p data-testid={`sections-${position}`}>{position}</p>,
      AfterContent: () => <p data-testid="after">after</p>,
    });
    await screen.findByText('ada@example.com', {}, { timeout: 8000 });
    expect(screen.getByTestId('header')).toHaveTextContent('Users & Allowlist / Manage user accounts and roles, and control who may sign in at all. / false');
    expect(screen.queryByRole('heading', { name: 'Users & Allowlist' })).toBeNull();
    const order = ['header', 'before', 'sections-top', 'sections-bottom', 'after'].map((id) => screen.getByTestId(id));
    for (let index = 1; index < order.length; index += 1) {
      expect(order[index - 1]!.compareDocumentPosition(order[index]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    // The tab strip sits between the top and bottom sections.
    const tablist = screen.getByRole('tablist');
    expect(screen.getByTestId('sections-top').compareDocumentPosition(tablist) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(tablist.compareDocumentPosition(screen.getByTestId('sections-bottom')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('adds a column read from the user-list extension, a row action, a detail view and a toolbar', async () => {
    renderUsers({
      Columns: (base) => [
        ...base,
        {
          id: 'plan',
          label: 'Plan',
          priority: 'secondary',
          value: (user) => userExtension<{ plan: string }>(user, 'billing')?.plan ?? 'none',
        },
      ],
      RowActions: ({ row }) => <button type="button">Impersonate {row.displayName}</button>,
      DetailPanel: ({ row }) => <span>detail of {row.email}</span>,
      Toolbar: () => <button type="button">Export plans</button>,
    });
    await screen.findByText('ada@example.com', {}, { timeout: 8000 });
    expect(screen.getByRole('columnheader', { name: 'Plan' })).toBeInTheDocument();
    expect(screen.getByText('pro')).toBeInTheDocument();
    // A user nothing contributed for has no `extensions` and reads as absent.
    expect(screen.getByText('none')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Impersonate Ada' })).toBeInTheDocument();
    expect(screen.getByText('detail of ada@example.com')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export plans' })).toBeInTheDocument();
  });

  it('keeps Users and Allowlist and only APPENDS app tabs, hiding one the viewer lacks the permission for', async () => {
    const Domains = () => <p>domains panel</p>;
    const Secret = () => <p>secret panel</p>;
    renderUsers({
      Tabs: [
        { id: 'domains', label: 'Domains', Panel: Domains },
        { id: 'secret', label: 'Secret', Panel: Secret, permission: 'nobody:has' },
      ],
    });
    const tabs = await screen.findAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Users', 'Allowlist', 'Domains']);
    await userEvent.click(screen.getByRole('tab', { name: 'Domains' }));
    expect(await screen.findByText('domains panel')).toBeInTheDocument();
    expect(screen.queryByText('secret panel')).toBeNull();
    // The built-in tabs still work.
    await userEvent.click(screen.getByRole('tab', { name: 'Allowlist' }));
    await waitFor(() => expect(service.getAllowlist).toHaveBeenCalled());
    expect(screen.queryByText('domains panel')).toBeNull();
  });

  it('adds no tab and no app tabs for an empty Tabs list', async () => {
    renderUsers({ Tabs: [] });
    const tabs = await screen.findAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Users', 'Allowlist']);
  });
});

describe('OrganizationPage and OrganizationsPage slots', () => {
  it('draws the page slots and the member list slots', async () => {
    render(
      <OrganizationPage
        slots={{
          BeforeContent: () => <p>seats notice</p>,
          Sections: ({ position }) => <p>sections {position}</p>,
          AfterContent: () => <p>footer note</p>,
          RowActions: ({ row }) => <button type="button">Seat {row.email}</button>,
          DetailPanel: ({ row }) => <span>joined {row.joinedAt}</span>,
          Toolbar: () => <button type="button">Invite many</button>,
        }}
      />,
      { wrapperOptions: { route: '/admin/settings/organization', user: ORG_ADMIN, adapters: { api: service } } },
    );
    await screen.findByText('Other Person', {}, { timeout: 8000 });
    expect(screen.getByText('seats notice')).toBeInTheDocument();
    expect(screen.getByText('sections top')).toBeInTheDocument();
    expect(screen.getByText('sections bottom')).toBeInTheDocument();
    expect(screen.getByText('footer note')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Seat other@example.com' })).toBeInTheDocument();
    expect(screen.getByText('joined 2026-01-01T00:00:00Z')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Invite many' })).toBeInTheDocument();
    // The Members and Invites tabs are untouched.
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Members', 'Invites']);
  });

  it('replaces the header and passes readOnly for a viewer without org_members:write', async () => {
    render(
      <OrganizationPage slots={{ Header: ({ title, readOnly }) => <h1>{String(title)} readOnly={String(readOnly)}</h1> }} />,
      {
        wrapperOptions: {
          route: '/admin/settings/organization',
          user: { ...ORG_ADMIN, permissions: ['org_members:read'] },
          adapters: { api: service },
        },
      },
    );
    expect(await screen.findByRole('heading', { name: 'Organization readOnly=true' })).toBeInTheDocument();
  });

  it('adds per-organization slots on the Organizations page', async () => {
    render(
      <OrganizationsPage
        slots={{
          BeforeContent: () => <p>operator notice</p>,
          RowActions: ({ row }) => <button type="button">Audit {row.slug}</button>,
          DetailPanel: ({ row }) => <span>members: {row.memberCount}</span>,
          Toolbar: () => <button type="button">Bulk invite</button>,
        }}
      />,
      {
        wrapperOptions: {
          route: '/admin/settings/organizations',
          user: { ...mockAdminUser, permissions: [...mockAdminUser.permissions, 'organizations:read', 'organizations:write'] },
          adapters: { api: service },
        },
      },
    );
    await screen.findByText('Alpha', {}, { timeout: 8000 });
    expect(screen.getByText('operator notice')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Audit alpha' })).toBeInTheDocument();
    expect(screen.getByText('members: 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bulk invite' })).toBeInTheDocument();
  });
});

describe('the other identity pages take the page slots', () => {
  const slots = {
    BeforeContent: () => <p>before-slot</p>,
    Sections: ({ position }: { position: 'top' | 'bottom' }) => <p>sections-{position}</p>,
    AfterContent: () => <p>after-slot</p>,
  };

  it.each([
    ['UserTokensPage', <UserTokensPage key="t" slots={slots} />, mockUser],
    ['ActivateDevicePage', <ActivateDevicePage key="a" slots={slots} />, mockUser],
  ])('%s', async (_name, element, user) => {
    render(element, { wrapperOptions: { route: '/x', user, adapters: { api: service } } });
    expect(await screen.findByText('before-slot')).toBeInTheDocument();
    expect(screen.getByText('sections-top')).toBeInTheDocument();
    expect(screen.getByText('sections-bottom')).toBeInTheDocument();
    expect(screen.getByText('after-slot')).toBeInTheDocument();
  });

  it('UserTokensPage replaces its header', async () => {
    render(<UserTokensPage slots={{ Header: ({ title }) => <h1>custom {String(title)}</h1> }} />, {
      wrapperOptions: { route: '/settings/tokens', user: mockUser, adapters: { api: service } },
    });
    expect(await screen.findByRole('heading', { name: 'custom Access Tokens' })).toBeInTheDocument();
  });

  it('ActivateDevicePage hands its header the step and keeps the card', async () => {
    render(<ActivateDevicePage slots={{ Header: ({ title, description }) => <h1>{String(title)} | {String(description)}</h1> }} />, {
      wrapperOptions: { route: '/activate', user: mockUser, adapters: { api: service } },
    });
    expect(await screen.findByRole('heading', { name: 'Authorize Device | Link a device to your account' })).toBeInTheDocument();
  });
});

describe('LoginPage layout slots', () => {
  it('draws the contract slots between the title and the footer, in order', () => {
    render(
      <LoginPage
        slots={{
          Header: ({ title, description }) => (
            <h1 data-testid="hdr">
              {String(title)} / {String(description)}
            </h1>
          ),
          BeforeContent: () => <p data-testid="b">b</p>,
          Sections: ({ position }) => <p data-testid={`s-${position}`}>s</p>,
          BeforeProviders: () => <p data-testid="bp">bp</p>,
          AfterProviders: () => <p data-testid="ap">ap</p>,
          AfterContent: () => <p data-testid="a">a</p>,
          Footer: () => <p data-testid="f">f</p>,
        }}
      />,
      { wrapperOptions: { route: '/login', authenticated: false } },
    );
    expect(screen.getByTestId('hdr')).toHaveTextContent('Welcome / Sign in to continue');
    const order = ['hdr', 'b', 's-top', 'bp', 'ap', 's-bottom', 'a', 'f'].map((id) => screen.getByTestId(id));
    for (let index = 1; index < order.length; index += 1) {
      expect(order[index - 1]!.compareDocumentPosition(order[index]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    // The provider buttons sit between the two provider slots.
    const button = screen.getByRole('button', { name: /google/i });
    expect(screen.getByTestId('bp').compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(button.compareDocumentPosition(screen.getByTestId('ap')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('keeps Title working, and Header wins when both are given', () => {
    const { unmount } = render(<LoginPage slots={{ Title: () => <h1>old title</h1> }} />, { wrapperOptions: { route: '/login', authenticated: false } });
    expect(screen.getByRole('heading', { name: 'old title' })).toBeInTheDocument();
    unmount();
    render(<LoginPage slots={{ Title: () => <h1>old title</h1>, Header: () => <h1>new header</h1> }} />, {
      wrapperOptions: { route: '/login', authenticated: false },
    });
    expect(screen.queryByRole('heading', { name: 'old title' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'new header' })).toBeInTheDocument();
  });
});

describe('AuthCallbackPage slots', () => {
  it('draws the slots around the waiting screen and lets Header replace its line', () => {
    render(
      <AuthCallbackPage
        slots={{
          Header: ({ title }) => <p data-testid="hdr">{String(title)} (custom)</p>,
          BeforeContent: () => <p data-testid="b">b</p>,
          AfterContent: () => <p data-testid="a">a</p>,
        }}
      />,
      { wrapperOptions: { route: '/auth/callback?token=abc' } },
    );
    expect(screen.getByTestId('hdr')).toHaveTextContent('Completing authentication... (custom)');
    expect(screen.getByTestId('b')).toBeInTheDocument();
    expect(screen.getByTestId('a')).toBeInTheDocument();
    expect(screen.queryByText('Completing authentication...')).toBeNull();
  });
});

describe('reading user extensions', () => {
  it('userExtension answers the contribution, or undefined for none, a non-object or a prototype key', () => {
    const holder = { extensions: { billing: { plan: 'pro' }, odd: 'text' as unknown as Record<string, unknown> } };
    expect(userExtension<{ plan: string }>(holder, 'billing')?.plan).toBe('pro');
    expect(userExtension(holder, 'missing')).toBeUndefined();
    expect(userExtension(holder, 'odd')).toBeUndefined();
    expect(userExtension(holder, 'constructor')).toBeUndefined();
    expect(userExtension(holder, 'toString')).toBeUndefined();
    expect(userExtension(null, 'billing')).toBeUndefined();
    expect(userExtension({}, 'billing')).toBeUndefined();
  });

  it('useCurrentUserExtension reads /auth/me extensions of the signed-in user, and nothing outside a provider', () => {
    function Plan() {
      const billing = useCurrentUserExtension<{ plan: string }>('billing');
      return <span data-testid="plan">{billing?.plan ?? 'no plan'}</span>;
    }
    const withExtension = render(<Plan />, {
      wrapperOptions: { user: { ...mockUser, extensions: { billing: { plan: 'team' } } } },
    });
    expect(screen.getByTestId('plan')).toHaveTextContent('team');
    withExtension.unmount();

    const without = render(<Plan />, { wrapperOptions: { user: mockUser } });
    expect(screen.getByTestId('plan')).toHaveTextContent('no plan');
    without.unmount();

    rtlRender(<Plan />);
    expect(screen.getByTestId('plan')).toHaveTextContent('no plan');
  });
});

