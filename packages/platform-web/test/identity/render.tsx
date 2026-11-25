// A render helper for the identity tests moved from the reference app
// (issue #727): the same `render(ui, { wrapperOptions })` shape as the app's
// `__tests__/utils/test-utils.tsx`, over a MemoryRouter, an MUI theme and a
// settled auth context, plus the identity adapters when a test hands some in
// (`wrapperOptions.adapters`, e.g. a fake identity client). Tests that mock
// `useAuth` or `usePermissions` mock the slice's own modules.

import { render as rtlRender } from '@testing-library/react';
import type { RenderOptions, RenderResult } from '@testing-library/react';
import { CssBaseline } from '@mui/material';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import type { ReactElement, ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';

import { AuthContext, IdentityWebAdaptersProvider } from '../../src/identity/headless/index.js';
import type { AuthUser, IdentityWebAdapters } from '../../src/identity/headless/index.js';
import { USER, authValue } from './harness.js';

/** The app suites' `MockUser`: the signed-in user as `GET /api/auth/me` reports it. */
export type MockUser = AuthUser;

export const mockUser: AuthUser = USER;

export const mockAdminUser: AuthUser = {
  ...USER,
  id: 'admin-user-id',
  email: 'admin@example.com',
  displayName: 'Admin User',
  roles: [{ name: 'admin' }],
  permissions: ['users:read', 'users:write', 'rbac:manage', 'allowlist:read', 'allowlist:write', 'system_settings:read'],
};

interface WrapperOptions {
  route?: string;
  authenticated?: boolean;
  user?: AuthUser | null;
  /** Identity adapters for the tree (a fake `api`, a spinner, a table). Default none. */
  adapters?: IdentityWebAdapters;
}

const theme = createTheme();

export function render(
  ui: ReactElement,
  options: Omit<RenderOptions, 'wrapper'> & { wrapperOptions?: WrapperOptions } = {},
): RenderResult {
  const { wrapperOptions = {}, ...rest } = options;
  const { route = '/', authenticated = true, user = mockUser, adapters } = wrapperOptions;
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter initialEntries={[route]}>
        <ThemeProvider theme={theme}>
          <CssBaseline />
          <AuthContext.Provider value={authValue({ user: authenticated ? user : null })}>
            {adapters ? (
              <IdentityWebAdaptersProvider adapters={adapters}>{children}</IdentityWebAdaptersProvider>
            ) : (
              children
            )}
          </AuthContext.Provider>
        </ThemeProvider>
      </MemoryRouter>
    );
  }
  return rtlRender(ui, { wrapper: Wrapper, ...rest });
}
