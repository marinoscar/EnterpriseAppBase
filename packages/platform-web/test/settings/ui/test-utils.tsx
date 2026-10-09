// Test helpers for the settings pages (issue #892), moved with the suites from
// the reference app: the same `render(ui, { wrapperOptions })` shape as the
// app's `__tests__/utils/test-utils.tsx` (a MemoryRouter, an MUI theme, a
// settled auth context and a platform host), over the package's test host
// instead of the app's MSW server.

import { CssBaseline } from '@mui/material';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { render as rtlRender, renderHook as rtlRenderHook } from '@testing-library/react';
import type { RenderHookResult, RenderOptions, RenderResult } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';

import { PlatformHostProvider } from '../../../src/core/index.js';
import { AuthContext } from '../../../src/identity/headless/index.js';
import type { AuthUser } from '../../../src/identity/headless/index.js';
import { createTestPlatformHost } from '../../../src/testing/index.js';
import type { TestPlatformHost, TestPlatformHostOptions } from '../../../src/testing/index.js';
import { USER, authValue } from '../../identity/harness.js';

/** The signed-in user, as `GET /api/auth/me` reports it. */
export type MockUser = AuthUser;

/** A viewer: their own settings only. */
export const mockUser: AuthUser = {
  ...USER,
  id: 'user-123',
  email: 'test@example.com',
  displayName: 'Test User',
  permissions: ['user_settings:read', 'user_settings:write'],
};

interface WrapperOptions {
  route?: string;
  user?: AuthUser | null;
  /** A ready host, or the options of one built from the user's permissions. */
  host?: TestPlatformHost | TestPlatformHostOptions;
}

const theme = createTheme();

function hostFor(user: AuthUser | null, host: WrapperOptions['host']): TestPlatformHost {
  if (host && 'requests' in host) return host;
  return createTestPlatformHost({ permissions: user?.permissions ?? [], userId: user?.id, ...host });
}

function wrapperFor(options: WrapperOptions) {
  const { route = '/', user = mockUser } = options;
  const host = hostFor(user, options.host);
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

/** Renders `ui` inside the router, the theme, the auth context and a test platform host. */
export function render(
  ui: ReactElement,
  options: Omit<RenderOptions, 'wrapper'> & { wrapperOptions?: WrapperOptions } = {},
): RenderResult {
  const { wrapperOptions = {}, ...rest } = options;
  return rtlRender(ui, { wrapper: wrapperFor(wrapperOptions), ...rest });
}

/** `renderHook` inside the same wrapper. */
export function renderHook<T>(callback: () => T, wrapperOptions: WrapperOptions = {}): RenderHookResult<T, unknown> {
  return rtlRenderHook(callback, { wrapper: wrapperFor(wrapperOptions) });
}
