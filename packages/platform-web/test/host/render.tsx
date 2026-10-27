// A render helper for the host slice's tests (issue #891), moved from the
// reference app's suites. The same `render(ui, { wrapperOptions: { user } })`
// shape as the app's `__tests__/utils/test-utils.tsx`, over a MemoryRouter, an
// MUI theme, a settled auth context (what `usePermissions` reads) and a test
// platform host whose canned responses a test sets with `serve` / `fail`
// instead of msw. `requests` records every call the page made.

import { render as rtlRender } from '@testing-library/react';
import type { RenderOptions, RenderResult } from '@testing-library/react';
import { CssBaseline } from '@mui/material';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import type { ReactElement, ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';

import { PlatformHostProvider } from '../../src/core/index.js';
import { AuthContext } from '../../src/identity/headless/index.js';
import type { AuthUser } from '../../src/identity/headless/index.js';
import { createTestApiError, createTestPlatformHost } from '../../src/testing/index.js';
import type { TestApiRequest, TestApiResponse } from '../../src/testing/index.js';
import { USER, authValue } from '../identity/harness.js';

export type MockUser = AuthUser;

/** A signed-in user who holds no permission of the host slice. */
export const mockUser: AuthUser = USER;

/** A signed-in administrator: `system_settings:read` and `:write`. */
export const mockAdminUser: AuthUser = {
  ...USER,
  id: 'admin-user-id',
  email: 'admin@example.com',
  displayName: 'Admin User',
  roles: [{ name: 'admin' }],
  permissions: ['system_settings:read', 'system_settings:write'],
};

const responses: Record<string, TestApiResponse> = {};

/** Every request any rendered page made since the last {@link reset}. */
export const requests: TestApiRequest[] = [];

/** Forget the canned responses and the recorded requests. Call it in `beforeEach`. */
export function reset(): void {
  for (const key of Object.keys(responses)) delete responses[key];
  requests.length = 0;
}

/** Answer `METHOD path` with a value, or with a function of the request. */
export function serve(method: TestApiRequest['method'], path: string, value: TestApiResponse): void {
  responses[`${method} ${path}`] = value;
}

/** Answer `METHOD path` with an API error of the given status and message. */
export function fail(method: TestApiRequest['method'], path: string, status: number, message: string): void {
  responses[`${method} ${path}`] = () => {
    throw createTestApiError(status, message);
  };
}

const theme = createTheme();

interface WrapperOptions {
  user?: AuthUser | null;
  route?: string;
}

/** The provider tree as a wrapper component, for `render` and `renderHook`. */
export function makeWrapper(options: WrapperOptions = {}): (props: { children: ReactNode }) => ReactElement {
  const { user = mockUser, route = '/' } = options;
  const host = createTestPlatformHost({ permissions: user?.permissions ?? [], responses });
  // The test host records into its own list; mirror it into the shared one.
  const recorded = host.requests;
  const push = recorded.push.bind(recorded);
  recorded.push = (...items: TestApiRequest[]) => {
    requests.push(...items);
    return push(...items);
  };

  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter initialEntries={[route]}>
        <ThemeProvider theme={theme}>
          <CssBaseline />
          <AuthContext.Provider value={authValue({ user })}>
            <PlatformHostProvider host={host}>{children}</PlatformHostProvider>
          </AuthContext.Provider>
        </ThemeProvider>
      </MemoryRouter>
    );
  };
}

export function render(
  ui: ReactElement,
  options: Omit<RenderOptions, 'wrapper'> & { wrapperOptions?: WrapperOptions } = {},
): RenderResult {
  const { wrapperOptions = {}, ...rest } = options;
  return rtlRender(ui, { wrapper: makeWrapper(wrapperOptions), ...rest });
}
