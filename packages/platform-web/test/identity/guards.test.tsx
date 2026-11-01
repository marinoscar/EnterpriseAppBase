// The packaged guards and permission hook (issue #727), moved from the
// reference app's ProtectedRoute, RequirePermission, RequireMultiOrg,
// useOrgsFeature and usePermissions.

import { render, renderHook, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import {
  AuthContext,
  RequireAuth,
  RequireMultiOrg,
  RequirePermission,
  useOrgsFeature,
  usePermissions,
} from '../../src/identity/headless/index.js';
import type { AuthContextValue } from '../../src/identity/headless/index.js';
import { USER, authValue } from './harness.js';

function withAuth(value: AuthContextValue, route = '/') {
  return ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[route]}>
      <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
    </MemoryRouter>
  );
}

function LoginProbe() {
  const location = useLocation();
  const from = (location.state as { from?: { pathname: string } } | null)?.from?.pathname;
  return <p>login from {from}</p>;
}

describe('RequireAuth', () => {
  function routes(element: ReactNode) {
    return (
      <Routes>
        <Route path="/login" element={<LoginProbe />} />
        <Route element={element}>
          <Route path="/secret" element={<p>secret</p>} />
        </Route>
      </Routes>
    );
  }

  it('renders the loading node while the probe runs', () => {
    render(routes(<RequireAuth loading={<p>loading</p>} />), { wrapper: withAuth(authValue({ isLoading: true }), '/secret') });
    expect(screen.getByText('loading')).toBeInTheDocument();
  });

  it('renders the nested routes for a signed-in user', () => {
    render(routes(<RequireAuth />), { wrapper: withAuth(authValue(), '/secret') });
    expect(screen.getByText('secret')).toBeInTheDocument();
  });

  it('redirects a signed-out visitor to the login path with state.from', () => {
    render(routes(<RequireAuth />), { wrapper: withAuth(authValue({ user: null }), '/secret') });
    expect(screen.getByText('login from /secret')).toBeInTheDocument();
  });
});

describe('RequirePermission', () => {
  const admin = authValue({ user: { ...USER, roles: [{ name: 'admin' }], permissions: ['users:read', 'users:write'] } });

  it('renders children when the single permission is held', () => {
    render(<RequirePermission permission="users:read">ok</RequirePermission>, { wrapper: withAuth(admin) });
    expect(screen.getByText('ok')).toBeInTheDocument();
  });

  it('renders the fallback when it is not', () => {
    render(
      <RequirePermission permission="system_settings:read" fallback={<p>no</p>}>
        ok
      </RequirePermission>,
      { wrapper: withAuth(admin) },
    );
    expect(screen.getByText('no')).toBeInTheDocument();
  });

  it('treats permissions as any-of, or all-of with requireAll', () => {
    const { rerender } = render(
      <RequirePermission permissions={['nope', 'users:read']}>any</RequirePermission>,
      { wrapper: withAuth(admin) },
    );
    expect(screen.getByText('any')).toBeInTheDocument();
    rerender(
      <RequirePermission permissions={['nope', 'users:read']} requireAll fallback={<p>denied</p>}>
        all
      </RequirePermission>,
    );
    expect(screen.getByText('denied')).toBeInTheDocument();
  });

  it('checks roles', () => {
    render(
      <RequirePermission roles={['viewer', 'admin']} role="admin">
        role ok
      </RequirePermission>,
      { wrapper: withAuth(admin) },
    );
    expect(screen.getByText('role ok')).toBeInTheDocument();
  });
});

describe('usePermissions', () => {
  it('answers from the user and keeps predicate identity across renders', () => {
    const value = authValue({ user: { ...USER, roles: [{ name: 'admin' }], permissions: ['a', 'b'] } });
    const { result, rerender } = renderHook(() => usePermissions(), { wrapper: withAuth(value) });
    const first = result.current.hasPermission;
    expect(result.current.hasPermission('a')).toBe(true);
    expect(result.current.hasAllPermissions('a', 'b')).toBe(true);
    expect(result.current.hasAnyPermission('x', 'b')).toBe(true);
    expect(result.current.isAdmin).toBe(true);
    rerender();
    expect(result.current.hasPermission).toBe(first);
  });

  it('holds nothing for a signed-out viewer', () => {
    const { result } = renderHook(() => usePermissions(), { wrapper: withAuth(authValue({ user: null })) });
    expect(result.current.permissions.size).toBe(0);
    expect(result.current.isAdmin).toBe(false);
  });
});

describe('useOrgsFeature and RequireMultiOrg', () => {
  it('is off outside a provider and in single-org mode', () => {
    expect(renderHook(() => useOrgsFeature()).result.current).toBe(false);
    expect(renderHook(() => useOrgsFeature(), { wrapper: withAuth(authValue()) }).result.current).toBe(false);
  });

  it('renders in multi-org mode, and the fallback otherwise', () => {
    const multi = authValue({ user: { ...USER, tenancyMode: 'multi' } });
    render(<RequireMultiOrg>orgs</RequireMultiOrg>, { wrapper: withAuth(multi) });
    expect(screen.getByText('orgs')).toBeInTheDocument();
    render(<RequireMultiOrg fallback={<p>single</p>}>orgs</RequireMultiOrg>, { wrapper: withAuth(authValue()) });
    expect(screen.getByText('single')).toBeInTheDocument();
  });
});
