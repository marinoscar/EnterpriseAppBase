/**
 * PP-14.25: an app adds a column to the packaged Users page from the API's
 * user-list extension, and reads the signed-in user's extension, with no
 * package edit.
 *
 * `apps/web/src/platform-extensions/identity/TeamColumn.example.tsx` is the
 * example. This renders the REAL packaged page
 * (`@marinoscar/platform-web/identity/ui`) through the app's own DataTable over
 * MSW responses shaped like `GET /api/users` with `extensions.team` on the rows
 * the API's extension contributed for, passes the slot, and asserts the column is
 * drawn from the rows the page already holds. It also pins that the page without
 * the slot draws no such column.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';

import { UsersPage } from '@marinoscar/platform-web/identity/ui';
import { installLayoutStubs, resetContainerWidth } from '@marinoscar/platform-web/datatable/testing';
import { render, mockAdminUser, type MockUser } from '../../utils/test-utils';
import { server } from '../../mocks/server';
import {
  CurrentTeamBadge,
  TEAM_COLUMN_ID,
  TEAM_USERS_PAGE_SLOTS,
  teamLabel,
  withTeamColumn,
} from '../../../platform-extensions/identity/TeamColumn.example';

const ROW = {
  isActive: true,
  providerDisplayName: null,
  profileImageUrl: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
};
const USERS = [
  { ...ROW, id: 'u-1', email: 'ada@example.com', displayName: 'Ada', roles: ['admin'], extensions: { team: { team: 'Core', lead: true } } },
  { ...ROW, id: 'u-2', email: 'bob@example.com', displayName: 'Bob', roles: ['viewer'], extensions: { team: { team: 'Growth', lead: false } } },
  { ...ROW, id: 'u-3', email: 'cy@example.com', displayName: 'Cy', roles: ['viewer'] },
];

const ROLES = [
  { id: 'admin', label: 'System administrator', description: 'System administrator', scope: 'system', assignable: true },
  { id: 'viewer', label: 'Viewer', description: 'Read-only', scope: 'org', assignable: true },
];

beforeAll(() => {
  installLayoutStubs();
});

beforeEach(() => {
  resetContainerWidth(1400);
  server.use(
    http.get('*/api/roles', ({ request }) => {
      const scope = new URL(request.url).searchParams.get('scope');
      return HttpResponse.json({ data: ROLES.filter((role) => !scope || role.scope === scope) });
    }),
    http.get('*/api/users', () =>
      HttpResponse.json({ data: { items: USERS, total: USERS.length, page: 1, pageSize: 10, totalPages: 1 } }),
    ),
  );
});

describe('the team column on the Users page (user-list extension)', () => {
  it('draws the column from extensions.team, placed after Roles, blank for a user with no team', async () => {
    render(<UsersPage slots={TEAM_USERS_PAGE_SLOTS} />, { wrapperOptions: { user: mockAdminUser, route: '/admin/settings/users' } });
    await screen.findByText('ada@example.com');

    const headers = screen.getAllByRole('columnheader').map((header) => header.textContent);
    expect(headers.indexOf('Team')).toBe(headers.indexOf('Roles') + 1);
    expect(screen.getByText('Core (lead)')).toBeInTheDocument();
    expect(screen.getByText('Growth')).toBeInTheDocument();
    expect(screen.queryByText('undefined')).toBeNull();
  });

  it('draws no such column without the slot', async () => {
    render(<UsersPage />, { wrapperOptions: { user: mockAdminUser, route: '/admin/settings/users' } });
    await screen.findByText('ada@example.com');
    expect(screen.queryByRole('columnheader', { name: 'Team' })).toBeNull();
    expect(screen.queryByText('Core (lead)')).toBeNull();
  });

  it('keeps the Users and Allowlist tabs', async () => {
    render(<UsersPage slots={TEAM_USERS_PAGE_SLOTS} />, { wrapperOptions: { user: mockAdminUser, route: '/admin/settings/users' } });
    await screen.findByText('ada@example.com');
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Users', 'Allowlist']);
  });
});

describe('reading the extension', () => {
  it('teamLabel tolerates a row with no team or a malformed one', () => {
    expect(teamLabel({})).toBeNull();
    expect(teamLabel({ extensions: { team: { team: 7 as unknown as string, lead: false } } })).toBeNull();
    expect(teamLabel({ extensions: { team: { team: 'Core', lead: true } } })).toBe('Core (lead)');
  });

  it('withTeamColumn appends when there is no Roles column', () => {
    const base = [{ id: 'email', label: 'Email', priority: 'primary' as const }];
    expect(withTeamColumn(base).map((column) => column.id)).toEqual(['email', TEAM_COLUMN_ID]);
  });

  it('the badge reads the signed-in user\'s /auth/me extensions', () => {
    const withTeam: MockUser = { ...mockAdminUser, extensions: { team: { team: 'Platform', lead: false } } };
    const first = render(<CurrentTeamBadge />, { wrapperOptions: { user: withTeam } });
    expect(screen.getByText('Platform')).toBeInTheDocument();
    first.unmount();
    render(<CurrentTeamBadge />, { wrapperOptions: { user: mockAdminUser } });
    expect(screen.queryByText('Platform')).toBeNull();
  });
});
