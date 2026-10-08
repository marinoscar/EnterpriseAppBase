// The identity API client and data hooks (issue #727): byte-identical paths
// over the host's transport, and the client resolution order.

import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { PlatformHostProvider } from '../../src/core/index.js';
import {
  IdentityWebAdaptersProvider,
  createIdentityApi,
  useIdentityApi,
  useOrgMembers,
  usePersonalAccessTokens,
  useUsers,
} from '../../src/identity/headless/index.js';
import type { IdentityApi } from '../../src/identity/headless/index.js';
import { createTestApiError, createTestPlatformHost } from '../../src/testing/index.js';
import type { TestPlatformHost } from '../../src/testing/index.js';

const page = <T,>(items: T[]) => ({ items, total: items.length, page: 1, pageSize: 10, totalPages: 1 });

function wrap(host: TestPlatformHost) {
  return ({ children }: { children: ReactNode }) => <PlatformHostProvider host={host}>{children}</PlatformHostProvider>;
}

describe('createIdentityApi', () => {
  it('sends the reference app paths and query strings', async () => {
    const host = createTestPlatformHost({
      responses: {
        '/users': page([]),
        '/allowlist': page([]),
        '/auth/device/activate': {},
        'POST /auth/device/authorize': { success: true, message: 'ok' },
        'GET /pat': [],
        'DELETE /pat/p1': undefined,
        '/org/members': page([]),
        'PATCH /org/members/u%2F1': {},
        '/admin/organizations': page([]),
        'PATCH /admin/organizations/o1': {},
      },
    });
    const identity = createIdentityApi(host.api);

    await identity.getUsers({ page: 2, pageSize: 25, search: 'ada', role: 'admin', isActive: false, sortBy: 'email', sortOrder: 'asc' });
    await identity.getAllowlist({ status: 'pending' });
    await identity.getDeviceActivationInfo('ABCD-EFGH');
    await identity.authorizeDevice('ABCD-EFGH', true);
    await identity.getPersonalAccessTokens();
    await identity.revokePersonalAccessToken('p1');
    await identity.getOrgMembers({ status: 'all', search: '' });
    await identity.updateOrgMember('u/1', { roleName: 'viewer' });
    await identity.getOrganizations();
    await identity.renameOrganization('o1', 'New');

    expect(host.requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      'GET /users?page=2&pageSize=25&search=ada&role=admin&isActive=false&sortBy=email&sortOrder=asc',
      'GET /allowlist?status=pending',
      'GET /auth/device/activate?code=ABCD-EFGH',
      'POST /auth/device/authorize',
      'GET /pat',
      'DELETE /pat/p1',
      'GET /org/members?status=all',
      'PATCH /org/members/u%2F1',
      'GET /admin/organizations',
      'PATCH /admin/organizations/o1',
    ]);
    expect(host.requests[3]?.body).toEqual({ userCode: 'ABCD-EFGH', approve: true });
    expect(host.requests[9]?.body).toEqual({ name: 'New' });
  });
});

describe('useIdentityApi', () => {
  it('prefers an explicit client, then the adapters, then the host', () => {
    const host = createTestPlatformHost();
    const explicit = {} as IdentityApi;
    const fromAdapters = {} as IdentityApi;
    const both = ({ children }: { children: ReactNode }) => (
      <PlatformHostProvider host={host}>
        <IdentityWebAdaptersProvider adapters={{ api: fromAdapters }}>{children}</IdentityWebAdaptersProvider>
      </PlatformHostProvider>
    );
    expect(renderHook(() => useIdentityApi(explicit), { wrapper: both }).result.current).toBe(explicit);
    expect(renderHook(() => useIdentityApi(), { wrapper: both }).result.current).toBe(fromAdapters);
    expect(typeof renderHook(() => useIdentityApi(), { wrapper: wrap(host) }).result.current.getUsers).toBe('function');
  });

  it('throws with neither a host nor an adapter client', () => {
    expect(() => renderHook(() => useIdentityApi())).toThrow(/no identity client/);
  });
});

describe('identity data hooks', () => {
  it('useUsers reads a page and reports a failure as error text', async () => {
    const user = { id: 'u1', email: 'a@b.c', displayName: null, providerDisplayName: null, profileImageUrl: null, isActive: true, roles: [], createdAt: '', updatedAt: '' };
    const host = createTestPlatformHost({ responses: { 'GET /users': page([user]) } });
    const { result } = renderHook(() => useUsers(), { wrapper: wrap(host) });
    await act(() => result.current.fetchUsers({ page: 1 }));
    expect(result.current.users).toEqual([user]);
    expect(result.current.total).toBe(1);

    const failing = createTestPlatformHost({ responses: { 'GET /users': () => { throw createTestApiError(403, 'Forbidden'); } } });
    const second = renderHook(() => useUsers(), { wrapper: wrap(failing) });
    await act(() => second.result.current.fetchUsers());
    expect(second.result.current.error).toBe('Forbidden');
  });

  it('usePersonalAccessTokens reads the list on mount', async () => {
    const host = createTestPlatformHost({ responses: { 'GET /pat': [{ id: 'p1' }] } });
    const { result } = renderHook(() => usePersonalAccessTokens(), { wrapper: wrap(host) });
    await waitFor(() => expect(result.current.tokens).toHaveLength(1));
  });

  it('useOrgMembers rethrows a refused write and re-reads after a good one', async () => {
    let refuse = true;
    const host = createTestPlatformHost({
      responses: {
        'GET /org/members': page([]),
        'DELETE /org/members/u1': () => {
          if (refuse) throw createTestApiError(409, 'Last admin');
          return undefined;
        },
      },
    });
    const { result } = renderHook(() => useOrgMembers(), { wrapper: wrap(host) });
    await expect(result.current.removeMember('u1')).rejects.toThrow('Last admin');
    await waitFor(() => expect(result.current.error).toBe('Last admin'));
    refuse = false;
    await act(() => result.current.removeMember('u1'));
    expect(host.requests.at(-1)?.path).toBe('/org/members');
  });
});
