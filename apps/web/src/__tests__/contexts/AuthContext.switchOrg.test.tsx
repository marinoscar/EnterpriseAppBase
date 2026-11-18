/**
 * `AuthContext.switchOrg` (#726): posts `POST /api/auth/switch-org`, keeps the
 * new access token and reloads the user, so `activeOrg`, `memberships` and
 * the permissions follow the organization. A refusal leaves the session alone.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { server } from '../mocks/server';
import { AuthProvider, useAuth } from '@marinoscar/platform-web/identity/headless';
import { api } from '../../services/api';
import { removePushSubscription } from '@marinoscar/platform-web/notifications/headless';

vi.mock('@marinoscar/platform-web/notifications/headless', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@marinoscar/platform-web/notifications/headless')>()),
  removePushSubscription: vi.fn().mockResolvedValue(undefined),
}));

const ORG_A = { id: 'org-a', name: 'Alpha', slug: 'alpha' };
const ORG_B = { id: 'org-b', name: 'Beta', slug: 'beta' };
const MEMBERSHIPS = [
  { orgId: ORG_A.id, name: ORG_A.name, slug: ORG_A.slug, role: 'org_admin' },
  { orgId: ORG_B.id, name: ORG_B.name, slug: ORG_B.slug, role: 'viewer' },
];

function me(activeOrg: typeof ORG_A, permissions: string[]) {
  return {
    data: {
      id: 'user-1',
      email: 'user@example.com',
      displayName: 'User',
      roles: [{ name: 'viewer' }],
      permissions,
      isActive: true,
      tenancyMode: 'multi',
      activeOrg,
      memberships: MEMBERSHIPS,
    },
  };
}

function wrapper({ children }: { children: ReactNode }) {
  return (
    <MemoryRouter>
      <AuthProvider client={api} onBeforeLogout={removePushSubscription}>{children}</AuthProvider>
    </MemoryRouter>
  );
}

describe('AuthContext.switchOrg (#726)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    server.use(
      http.post('*/api/auth/refresh', () => HttpResponse.json({ accessToken: 'token-a', expiresIn: 900 })),
      http.get('*/api/auth/me', ({ request }) =>
        HttpResponse.json(
          request.headers.get('Authorization') === 'Bearer token-b'
            ? me(ORG_B, ['user_settings:read'])
            : me(ORG_A, ['user_settings:read', 'org_members:read']),
        ),
      ),
    );
  });

  it('exposes activeOrg and memberships from /api/auth/me', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));

    expect(result.current.activeOrg).toEqual(ORG_A);
    expect(result.current.memberships).toEqual(MEMBERSHIPS);
  });

  it('calls switch-org with the org id, keeps the new token and refreshes the user', async () => {
    const bodies: unknown[] = [];
    server.use(
      http.post('*/api/auth/switch-org', async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ data: { accessToken: 'token-b', expiresIn: 900 } });
      }),
    );
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));

    await act(async () => {
      await result.current.switchOrg(ORG_B.id);
    });

    expect(bodies).toEqual([{ orgId: ORG_B.id }]);
    expect(api.getAccessToken()).toBe('token-b');
    expect(result.current.activeOrg).toEqual(ORG_B);
    expect(result.current.user?.permissions).toEqual(['user_settings:read']);
  });

  it('rejects and keeps the current session when the API refuses', async () => {
    server.use(
      http.post('*/api/auth/switch-org', () =>
        HttpResponse.json({ statusCode: 404, message: 'Organization not found' }, { status: 404 }),
      ),
    );
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));

    await act(async () => {
      await expect(result.current.switchOrg('org-unknown')).rejects.toThrow();
    });

    expect(api.getAccessToken()).toBe('token-a');
    expect(result.current.activeOrg).toEqual(ORG_A);
  });
});
