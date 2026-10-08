// The identity lists over the table seam (issue #727): the app's table gets
// the list's columns, rows and paging; without one, the plain MUI fallback
// renders the same rows.

import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { PlatformHostProvider } from '../../src/core/index.js';
import { AuthContext, IdentityWebAdaptersProvider } from '../../src/identity/headless/index.js';
import type { IdentityDataTableProps, IdentityWebAdapters } from '../../src/identity/headless/index.js';
import { PersonalAccessTokens, UserList } from '../../src/identity/ui/index.js';
import { createTestPlatformHost } from '../../src/testing/index.js';
import { USER, authValue } from './harness.js';

const ADA = {
  id: 'u1',
  email: 'ada@example.com',
  displayName: 'Ada',
  providerDisplayName: null,
  profileImageUrl: null,
  isActive: true,
  roles: ['admin'],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function mount(ui: ReactNode, adapters: IdentityWebAdapters = {}) {
  const host = createTestPlatformHost({
    permissions: ['users:read'],
    responses: {
      'GET /users': { items: [ADA], total: 1, page: 1, pageSize: 10, totalPages: 1 },
      'GET /pat': [],
    },
  });
  render(
    <MemoryRouter>
      <AuthContext.Provider value={authValue({ user: { ...USER, permissions: ['users:read'] } })}>
        <PlatformHostProvider host={host}>
          <IdentityWebAdaptersProvider adapters={adapters}>{ui}</IdentityWebAdaptersProvider>
        </PlatformHostProvider>
      </AuthContext.Provider>
    </MemoryRouter>,
  );
  return host;
}

describe('identity lists', () => {
  it('render the rows in the fallback table without an app table', async () => {
    const host = mount(<UserList />);
    expect(await screen.findByText('ada@example.com')).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Users' })).toBeInTheDocument();
    expect(host.requests[0]?.path).toBe('/users?page=1&pageSize=10');
  });

  it("hand the app's table the columns, rows and paging", async () => {
    const seen: IdentityDataTableProps<unknown>[] = [];
    function AppTable<Row>(props: IdentityDataTableProps<Row>) {
      seen.push(props as IdentityDataTableProps<unknown>);
      return <p>app table: {props.rows.length} rows</p>;
    }
    mount(<UserList />, { DataTable: AppTable });
    expect(await screen.findByText('app table: 1 rows')).toBeInTheDocument();
    const last = seen.at(-1)!;
    expect(last.tableId).toBe('admin-users');
    expect(last.columns.map((c) => c.id)).toEqual(['email', 'isActive', 'displayName', 'roles', 'createdAt', 'id']);
    expect(last.pagination).toMatchObject({ page: 0, pageSize: 10, total: 1 });
  });

  it('PersonalAccessTokens reads the tokens on mount', async () => {
    const host = mount(<PersonalAccessTokens />);
    await waitFor(() => expect(host.requests.map((r) => r.path)).toContain('/pat'));
  });
});
