// Test helpers for the notifications web slice (issue #738), moved with the
// suites from the reference app: the same `render(ui, { wrapperOptions })`
// shape as the app's `__tests__/utils/test-utils.tsx` (a MemoryRouter, an MUI
// theme, a settled auth context and a platform host carrying the user's
// permissions), plus a configured slice whose API client talks to a stubbed
// `fetch` (`routeFetch`), in place of the app's MSW server.

import { render as rtlRender } from '@testing-library/react';
import type { RenderOptions, RenderResult } from '@testing-library/react';
import { CssBaseline } from '@mui/material';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import type { ReactElement, ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';

import { PlatformHostProvider, PlatformHttpClient } from '../../src/core/index.js';
import { AuthContext } from '../../src/identity/headless/index.js';
import type { AuthUser } from '../../src/identity/headless/index.js';
import { configureNotificationsWeb } from '../../src/notifications/headless/api.js';
import { createTestPlatformHost } from '../../src/testing/index.js';
import { USER, authValue } from '../identity/harness.js';

/** The signed-in user, as `GET /api/auth/me` reports it. */
export type MockUser = AuthUser;

/** A viewer: their own settings only. */
export const mockUser: AuthUser = {
  ...USER,
  permissions: ['user_settings:read', 'user_settings:write'],
};

/** An administrator holding the notifications permissions the seed grants `admin`. */
export const mockAdminUser: AuthUser = {
  ...USER,
  id: 'admin-user-id',
  email: 'admin@example.com',
  displayName: 'Admin User',
  roles: [{ name: 'admin' }],
  permissions: [
    'user_settings:read',
    'user_settings:write',
    'system_settings:read',
    'system_settings:write',
    'broadcasts:read',
    'broadcasts:write',
    'push:read',
    'push:write',
  ],
};

interface WrapperOptions {
  route?: string;
  authenticated?: boolean;
  user?: AuthUser | null;
}

const theme = createTheme();

/**
 * Renders `ui` inside the router, the theme, the auth context and a test
 * platform host (the user's permissions).
 */
export function render(
  ui: ReactElement,
  options: Omit<RenderOptions, 'wrapper'> & { wrapperOptions?: WrapperOptions } = {},
): RenderResult {
  const { wrapperOptions = {}, ...rest } = options;
  const { route = '/', authenticated = true, user = mockUser } = wrapperOptions;
  const host = createTestPlatformHost({ permissions: user?.permissions ?? [], userId: user?.id });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter initialEntries={[route]}>
        <ThemeProvider theme={theme}>
          <CssBaseline />
          <AuthContext.Provider value={authValue({ user: authenticated ? user : null })}>
            <PlatformHostProvider host={host}>{children}</PlatformHostProvider>
          </AuthContext.Provider>
        </ThemeProvider>
      </MemoryRouter>
    );
  }
  return rtlRender(ui, { wrapper: Wrapper, ...rest });
}

/** One stubbed route: `METHOD /api/path/:param`, answered like an msw resolver. */
export type FetchRoute = (context: { request: Request; params: Record<string, string> }) => Response | Promise<Response>;

/** The msw `HttpResponse.json` the moved suites call, over a plain `Response`. */
export const HttpResponse = {
  json(body: unknown, init: ResponseInit = {}): Response {
    return new Response(JSON.stringify(body), {
      status: 200,
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init.headers as Record<string, string> | undefined) },
    });
  },
};

function match(pattern: string, pathname: string): Record<string, string> | null {
  const want = pattern.split('/');
  const got = pathname.split('/');
  if (want.length !== got.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < want.length; i += 1) {
    const part = want[i]!;
    if (part.startsWith(':')) params[part.slice(1)] = decodeURIComponent(got[i]!);
    else if (part !== got[i]) return null;
  }
  return params;
}

/**
 * Configures the slice with a real `PlatformHttpClient` over a stubbed
 * `fetch` that answers `routes` (`'GET /api/admin/broadcasts'`); an
 * unmatched request answers 404. The most specific route wins (exact paths
 * before `:param` ones). Restore with `vi.unstubAllGlobals()`.
 *
 * @returns the fetch mock, for call assertions.
 */
export function routeFetch(routes: Record<string, FetchRoute>): ReturnType<typeof vi.fn> {
  const entries = Object.entries(routes).sort(([a], [b]) => (a.includes(':') ? 1 : 0) - (b.includes(':') ? 1 : 0));
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(new URL(String(input), 'http://localhost'), init);
    const url = new URL(request.url);
    for (const [key, handler] of entries) {
      const [method, path] = key.split(' ');
      if (method !== request.method) continue;
      const params = match(path!, url.pathname);
      if (params) return handler({ request, params });
    }
    return new Response(JSON.stringify({ message: 'Not found' }), { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  configureNotificationsWeb({
    api: new PlatformHttpClient({ baseUrl: '/api', refreshLockName: 'test-notifications-refresh' }),
    apiBaseUrl: '/api',
  });
  return fetchMock;
}
