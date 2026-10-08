// Shared helpers for the identity slice's package tests (issue #727): a fake
// session client and an auth-context value builder.

import { vi } from 'vitest';

import type { AuthContextValue, AuthSessionClient, AuthUser } from '../../src/identity/headless/index.js';

export const USER: AuthUser = {
  id: 'u1',
  email: 'ada@example.com',
  displayName: 'Ada',
  profileImageUrl: null,
  roles: [{ name: 'viewer' }],
  permissions: ['user_settings:read'],
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
};

export interface FakeSessionClient extends AuthSessionClient {
  get: ReturnType<typeof vi.fn> & AuthSessionClient['get'];
  post: ReturnType<typeof vi.fn> & AuthSessionClient['post'];
  setAccessToken: ReturnType<typeof vi.fn> & AuthSessionClient['setAccessToken'];
  refreshToken: ReturnType<typeof vi.fn> & AuthSessionClient['refreshToken'];
  expire(): void;
}

/** A session client answering from a table: `GET /auth/me`, `GET /auth/providers`, POSTs. */
export function fakeSessionClient(options: {
  refreshed?: boolean;
  me?: AuthUser | Error;
  providers?: { name: string; authUrl: string }[];
  post?: (path: string, body?: unknown) => unknown;
} = {}): FakeSessionClient {
  const listeners = new Set<() => void>();
  const client = {
    get: vi.fn(async (path: string) => {
      if (path === '/auth/providers') return { providers: options.providers ?? [{ name: 'google', authUrl: '/api/auth/google' }] };
      if (path === '/auth/me') {
        if (options.me instanceof Error) throw options.me;
        return options.me ?? USER;
      }
      throw Object.assign(new Error('not found'), { status: 404 });
    }),
    post: vi.fn(async (path: string, body?: unknown) => options.post?.(path, body)),
    setAccessToken: vi.fn(),
    refreshToken: vi.fn(async () => options.refreshed ?? false),
    onSessionExpired: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    expire: () => listeners.forEach((listener) => listener()),
  };
  return client as unknown as FakeSessionClient;
}

/** A settled auth-context value for components that only read it. */
export function authValue(overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  const user = overrides.user === undefined ? USER : overrides.user;
  return {
    user,
    isLoading: false,
    isAuthenticated: user !== null,
    providers: [{ name: 'google', authUrl: '/api/auth/google' }],
    sessionExpired: false,
    login: vi.fn(),
    logout: vi.fn(async () => undefined),
    refreshUser: vi.fn(async () => undefined),
    setAccessToken: vi.fn(),
    activeOrg: user?.activeOrg ?? null,
    memberships: user?.memberships ?? [],
    switchOrg: vi.fn(async () => undefined),
    ...overrides,
  };
}
