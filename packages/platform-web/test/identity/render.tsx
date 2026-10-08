// A render helper for the identity tests moved from the reference app
// (issue #727): the same `render(ui, { wrapperOptions })` shape as the app's
// `__tests__/utils/test-utils.tsx`, over a MemoryRouter, an MUI theme and a
// settled auth context. Tests that mock `useAuth` or `usePermissions` mock the
// slice's own modules.

import { render as rtlRender } from '@testing-library/react';
import type { RenderOptions, RenderResult } from '@testing-library/react';
import { CssBaseline } from '@mui/material';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import type { ReactElement, ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';

import { AuthContext } from '../../src/identity/headless/index.js';
import type { AuthUser } from '../../src/identity/headless/index.js';
import { USER, authValue } from './harness.js';

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
}

const theme = createTheme();

export function render(
  ui: ReactElement,
  options: Omit<RenderOptions, 'wrapper'> & { wrapperOptions?: WrapperOptions } = {},
): RenderResult {
  const { wrapperOptions = {}, ...rest } = options;
  const { route = '/', authenticated = true, user = mockUser } = wrapperOptions;
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter initialEntries={[route]}>
        <ThemeProvider theme={theme}>
          <CssBaseline />
          <AuthContext.Provider value={authValue({ user: authenticated ? user : null })}>{children}</AuthContext.Provider>
        </ThemeProvider>
      </MemoryRouter>
    );
  }
  return rtlRender(ui, { wrapper: Wrapper, ...rest });
}
