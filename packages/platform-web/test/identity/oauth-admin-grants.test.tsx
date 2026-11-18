// Console → OAuth clients → a client's Details → Connections (#1203): the
// admin grant routes, `useOAuthAdminGrants`, and the drawer section (list,
// "Include revoked", paging, Revoke behind a confirmation, read-only, empty
// and error states).

import { act, renderHook, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { PlatformHostProvider } from '../../src/core/index.js';
import { DataTable } from '../../src/datatable/ui/index.js';
import { AuthContext, createOAuthServerApi, useOAuthAdminGrants } from '../../src/identity/headless/index.js';
import type { IdentityDataTableComponent } from '../../src/identity/headless/index.js';
import { OAuthClientsPage } from '../../src/identity/ui/index.js';
import { createTestApiError, createTestPlatformHost } from '../../src/testing/index.js';
import type { TestApiRequest, TestApiResponse } from '../../src/testing/index.js';
import { resetViewportWidth, setViewportWidth } from '../viewport.js';
import { USER, authValue } from './harness.js';
import { adminGrant, client, mountOAuth } from './oauth-fixtures.js';

const CLIENT = client();
const GRANT = adminGrant();
const REVOKED = adminGrant({
  id: '99999999-9999-4999-8999-999999999999',
  user: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: 'person.b@example.test' },
  organization: null,
  revokedAt: '2026-01-03T00:00:00.000Z',
  revokedReason: 'admin',
});
const READ = ['oauth_clients:read'];
const WRITE = [...READ, 'oauth_clients:write'];

const page = <T,>(items: T[], total = items.length, pageNumber = 1, pageSize = 20) => ({
  items,
  total,
  page: pageNumber,
  pageSize,
  totalPages: Math.max(1, Math.ceil(total / pageSize)),
});

const grantReads = (requests: TestApiRequest[]) =>
  requests.filter((request) => request.method === 'GET' && request.path.startsWith('/admin/oauth/grants'));

describe('createOAuthServerApi: admin grants', () => {
  it('calls the documented routes with the query', async () => {
    const host = createTestPlatformHost({
      responses: { 'GET /admin/oauth/grants': page([GRANT]), 'DELETE /admin/oauth/grants/g1': undefined },
    });
    const oauth = createOAuthServerApi(host.api);
    expect((await oauth.listAdminGrants()).items).toHaveLength(1);
    await oauth.listAdminGrants({ clientId: 'c1', userId: 'u1', includeRevoked: true, page: 2, pageSize: 10 });
    await oauth.revokeAdminGrant('g1');
    expect(host.requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      'GET /admin/oauth/grants',
      'GET /admin/oauth/grants?clientId=c1&userId=u1&includeRevoked=true&page=2&pageSize=10',
      'DELETE /admin/oauth/grants/g1',
    ]);
  });
});

describe('useOAuthAdminGrants', () => {
  function wrapper(responses: Record<string, TestApiResponse>) {
    const host = createTestPlatformHost({ responses });
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <AuthContext.Provider value={authValue({ user: USER })}>
          <PlatformHostProvider host={host}>{children}</PlatformHostProvider>
        </AuthContext.Provider>
      );
    }
    return { host, Wrapper };
  }

  it('filters by client, includes revoked on request (back to page 1), and re-reads after a revoke', async () => {
    const { host, Wrapper } = wrapper({
      'GET /admin/oauth/grants': page([GRANT], 45),
      [`DELETE /admin/oauth/grants/${GRANT.id}`]: undefined,
    });
    const { result } = renderHook(() => useOAuthAdminGrants({ clientId: CLIENT.id }), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.grants).toHaveLength(1));
    expect(host.requests.at(-1)?.path).toBe(`/admin/oauth/grants?clientId=${CLIENT.id}&page=1&pageSize=20`);
    result.current.setPagination({ page: 2, pageSize: 20 });
    await waitFor(() => expect(host.requests.at(-1)?.path).toBe(`/admin/oauth/grants?clientId=${CLIENT.id}&page=2&pageSize=20`));
    result.current.setIncludeRevoked(true);
    await waitFor(() =>
      expect(host.requests.at(-1)?.path).toBe(`/admin/oauth/grants?clientId=${CLIENT.id}&includeRevoked=true&page=1&pageSize=20`),
    );
    await result.current.revoke(GRANT.id);
    expect(host.requests.at(-2)).toMatchObject({ method: 'DELETE', path: `/admin/oauth/grants/${GRANT.id}` });
    expect(host.requests.at(-1)?.method).toBe('GET');
  });

  it('reports a failed read in error', async () => {
    const { Wrapper } = wrapper({
      'GET /admin/oauth/grants': () => {
        throw createTestApiError(500, 'Boom');
      },
    });
    const { result } = renderHook(() => useOAuthAdminGrants({ clientId: CLIENT.id }), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.error).toBe('Boom'));
    expect(result.current.grants).toEqual([]);
  });
});

function mountPage(permissions: string[], grants: TestApiResponse) {
  return mountOAuth(<OAuthClientsPage />, {
    route: '/admin/settings/oauth-clients',
    permissions,
    adapters: { appName: 'Product X', DataTable: DataTable as unknown as IdentityDataTableComponent },
    responses: {
      'GET /admin/oauth/clients': page([CLIENT]),
      'GET /admin/oauth/grants': grants,
      [`DELETE /admin/oauth/grants/${GRANT.id}`]: undefined,
    },
  });
}

async function openConnections(user: ReturnType<typeof userEvent.setup>) {
  await screen.findAllByText('Example Desk');
  const direct = screen.queryAllByRole('button', { name: /^Details/ });
  if (direct.length > 0) {
    await user.click(direct[0]!);
  } else {
    await user.click(screen.getAllByRole('button', { name: /^Row actions/ })[0]!);
    await user.click(await screen.findByRole('menuitem', { name: /^Details/ }));
  }
  const drawer = await screen.findByRole('region', { name: 'Example Desk' });
  return within(drawer).getByRole('region', { name: 'Connections' });
}

describe('OAuthClientsPage: a client’s connections', () => {
  it('lists the client’s grants: email, scopes, organization, dates and status', async () => {
    const user = userEvent.setup();
    const { host } = mountPage(WRITE, page([GRANT]));
    const section = await openConnections(user);
    expect(await within(section).findByText('person.a@example.test')).toBeInTheDocument();
    expect(within(section).getByText('runs:read')).toBeInTheDocument();
    expect(within(section).getByText('runs:write')).toBeInTheDocument();
    expect(within(section).getByText(/Org Alpha/)).toBeInTheDocument();
    expect(within(section).getByText(/Last used never/)).toBeInTheDocument();
    expect(within(section).getByText('Active')).toBeInTheDocument();
    expect(grantReads(host.requests)[0]?.path).toBe(`/admin/oauth/grants?clientId=${CLIENT.id}&page=1&pageSize=20`);
  });

  it('"Include revoked" re-reads with includeRevoked=true and shows the reason', async () => {
    const user = userEvent.setup();
    const { host } = mountPage(WRITE, (request: TestApiRequest) =>
      request.path.includes('includeRevoked=true') ? page([GRANT, REVOKED]) : page([GRANT]),
    );
    const section = await openConnections(user);
    await within(section).findByText('person.a@example.test');
    expect(within(section).queryByText('person.b@example.test')).not.toBeInTheDocument();
    await user.click(within(section).getByRole('switch', { name: 'Include revoked' }));
    expect(await within(section).findByText('person.b@example.test')).toBeInTheDocument();
    expect(grantReads(host.requests).at(-1)?.path).toBe(`/admin/oauth/grants?clientId=${CLIENT.id}&includeRevoked=true&page=1&pageSize=20`);
    expect(within(section).getByText('Revoked')).toBeInTheDocument();
    expect(within(section).getByText(/revoked by an administrator/)).toBeInTheDocument();
    // A revoked grant offers no Revoke.
    expect(within(section).getAllByRole('button', { name: /Revoke the connection/ })).toHaveLength(1);
  });

  it('pages through the connections', async () => {
    const user = userEvent.setup();
    const { host } = mountPage(WRITE, page([GRANT], 45));
    const section = await openConnections(user);
    expect(await within(section).findByText('1–20 of 45')).toBeInTheDocument();
    await user.click(within(section).getByRole('button', { name: 'Next page of connections' }));
    await waitFor(() => expect(grantReads(host.requests).at(-1)?.path).toBe(`/admin/oauth/grants?clientId=${CLIENT.id}&page=2&pageSize=20`));
  });

  it('revokes only after confirming, then re-reads the connections and the clients', async () => {
    const user = userEvent.setup();
    const { host } = mountPage(WRITE, page([GRANT]));
    const section = await openConnections(user);
    await user.click(await within(section).findByRole('button', { name: 'Revoke the connection of person.a@example.test' }));
    const dialog = await screen.findByRole('dialog', { name: 'Revoke this connection?' });
    expect(within(dialog).getByText(/stops working for person.a@example.test at once/)).toBeInTheDocument();
    expect(host.requests.some((request) => request.method === 'DELETE')).toBe(false);
    const readsBefore = grantReads(host.requests).length;
    const clientReadsBefore = host.requests.filter((request) => request.path.startsWith('/admin/oauth/clients')).length;
    await user.click(within(dialog).getByRole('button', { name: 'Revoke' }));
    await waitFor(() => expect(host.requests.find((request) => request.method === 'DELETE')?.path).toBe(`/admin/oauth/grants/${GRANT.id}`));
    await waitFor(() => expect(grantReads(host.requests).length).toBeGreaterThan(readsBefore));
    await waitFor(() =>
      expect(host.requests.filter((request) => request.path.startsWith('/admin/oauth/clients')).length).toBeGreaterThan(clientReadsBefore),
    );
  });

  it('cancelling the confirmation revokes nothing', async () => {
    const user = userEvent.setup();
    const { host } = mountPage(WRITE, page([GRANT]));
    const section = await openConnections(user);
    await user.click(await within(section).findByRole('button', { name: /Revoke the connection/ }));
    await user.click(within(await screen.findByRole('dialog', { name: 'Revoke this connection?' })).getByRole('button', { name: 'Cancel' }));
    expect(host.requests.some((request) => request.method === 'DELETE')).toBe(false);
  });

  it('hides Revoke without oauth_clients:write', async () => {
    const user = userEvent.setup();
    mountPage(READ, page([GRANT]));
    const section = await openConnections(user);
    expect(await within(section).findByText('person.a@example.test')).toBeInTheDocument();
    expect(within(section).queryByRole('button', { name: /Revoke/ })).not.toBeInTheDocument();
  });

  it('says so when the client has no connections', async () => {
    const user = userEvent.setup();
    mountPage(WRITE, page([]));
    const section = await openConnections(user);
    expect(await within(section).findByText('No active connections.')).toBeInTheDocument();
  });

  it('shows the error when the connections cannot be read', async () => {
    const user = userEvent.setup();
    mountPage(WRITE, () => {
      throw createTestApiError(500, 'The grant list failed.');
    });
    const section = await openConnections(user);
    expect(await within(section).findByText('The grant list failed.')).toBeInTheDocument();
    expect(within(section).queryByText('No active connections.')).not.toBeInTheDocument();
  });

  describe('at phone width (360px)', () => {
    afterEach(() => act(() => resetViewportWidth()));

    it('opens the connections from the client list and revokes after confirming', async () => {
      act(() => setViewportWidth(360));
      const user = userEvent.setup();
      const { host } = mountPage(WRITE, page([GRANT]));
      const section = await openConnections(user);
      expect(await within(section).findByText('person.a@example.test')).toBeInTheDocument();
      await user.click(within(section).getByRole('button', { name: 'Revoke the connection of person.a@example.test' }));
      await user.click(within(await screen.findByRole('dialog', { name: 'Revoke this connection?' })).getByRole('button', { name: 'Revoke' }));
      await waitFor(() => expect(host.requests.find((request) => request.method === 'DELETE')?.path).toBe(`/admin/oauth/grants/${GRANT.id}`));
    });
  });
});
