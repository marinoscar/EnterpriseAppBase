// Route and content guards (issue #727, PP-6.6), moved from the reference
// app's `components/common/{ProtectedRoute,RequirePermission,RequireMultiOrg}.tsx`
// and `hooks/useOrgsFeature.ts`. Headless: no markup of their own beyond what
// the caller passes. They decide REACHABILITY and visibility only; the API
// enforces every permission.

import { useContext } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';

import { AuthContext, useAuth } from './auth-context.js';
import { usePermissions } from './use-permissions.js';

/**
 * What {@link RequireAuth} takes.
 *
 * @stability stable
 */
export interface RequireAuthProps {
  /** Rendered while the boot-time session probe runs (the app's full-screen spinner). Default nothing. */
  loading?: ReactNode;
  /**
   * Where a signed-out visitor is sent, with `state.from` so the login page
   * can send them back.
   *
   * @defaultValue `'/login'`
   */
  loginPath?: string;
  /** The protected content; defaults to the nested routes (`<Outlet />`). */
  children?: ReactNode;
}

/**
 * Route guard: the nested routes (or `children`) for a signed-in user; a
 * replace-redirect to the login page, carrying `state.from`, otherwise.
 *
 * @param props - see {@link RequireAuthProps}.
 * @returns the guarded element.
 *
 * @example
 * ```tsx
 * <Route element={<RequireAuth loading={<LoadingSpinner fullScreen />} />}>
 *   <Route path="/" element={<HomePage />} />
 * </Route>
 * ```
 *
 * @extensionPoint component
 * @stability stable
 */
export function RequireAuth({ loading = null, loginPath = '/login', children }: RequireAuthProps): ReactElement {
  const { user, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return <>{loading}</>;
  }

  if (!user) {
    return <Navigate to={loginPath} state={{ from: location }} replace />;
  }

  return children === undefined ? <Outlet /> : <>{children}</>;
}

/**
 * What {@link RequirePermission} takes. Every condition given must hold.
 *
 * @stability stable
 */
export interface RequirePermissionProps {
  /** One permission the viewer must hold. */
  permission?: string;
  /** Several permissions: any of them, or all with `requireAll`. */
  permissions?: string[];
  /**
   * With `permissions`: require all of them instead of any.
   *
   * @defaultValue `false`
   */
  requireAll?: boolean;
  /** One role the viewer must have. */
  role?: string;
  /** Several roles: any of them. */
  roles?: string[];
  /** Rendered when the conditions hold. */
  children: ReactNode;
  /** Rendered otherwise (a route passes `<Navigate to="/" replace />`). Default nothing. */
  fallback?: ReactNode;
}

/**
 * Render `children` only when the viewer holds the permissions and roles
 * named; `fallback` otherwise. Pass the exact permission string the API route
 * enforces.
 *
 * @param props - see {@link RequirePermissionProps}.
 * @returns the guarded element.
 *
 * @example
 * ```tsx
 * <RequirePermission permission="users:read" fallback={<Navigate to="/" replace />}>
 *   <UsersPage />
 * </RequirePermission>
 * ```
 *
 * @extensionPoint component
 * @stability stable
 */
export function RequirePermission({
  permission,
  permissions,
  requireAll = false,
  role,
  roles,
  children,
  fallback = null,
}: RequirePermissionProps): ReactElement {
  const { hasPermission, hasAnyPermission, hasAllPermissions, hasRole, hasAnyRole } = usePermissions();

  // Check single permission
  if (permission && !hasPermission(permission)) {
    return <>{fallback}</>;
  }

  // Check multiple permissions
  if (permissions && permissions.length > 0) {
    const hasPerms = requireAll ? hasAllPermissions(...permissions) : hasAnyPermission(...permissions);
    if (!hasPerms) {
      return <>{fallback}</>;
    }
  }

  // Check single role
  if (role && !hasRole(role)) {
    return <>{fallback}</>;
  }

  // Check multiple roles
  if (roles && roles.length > 0 && !hasAnyRole(...roles)) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}

/**
 * Whether ORGANIZATION management exists in this deployment: true iff
 * `GET /api/auth/me` reports `tenancyMode: 'multi'`. In single-org mode the
 * Organization and Organizations cards, their routes and the org switcher are
 * absent ("org management hidden").
 *
 * Reads the auth context without `useAuth()`, so it answers "off" outside an
 * `AuthProvider` or with nobody signed in (fail closed), and never fetches.
 *
 * @returns `true` in a multi-organization deployment.
 *
 * @extensionPoint hook
 * @stability stable
 */
export function useOrgsFeature(): boolean {
  const auth = useContext(AuthContext);
  return auth?.user?.tenancyMode === 'multi';
}

/**
 * What {@link RequireMultiOrg} takes.
 *
 * @stability stable
 */
export interface RequireMultiOrgProps {
  /** Rendered in a multi-organization deployment. */
  children: ReactNode;
  /** Rendered in single-org mode. Defaults to a replace-redirect to `/`, like every settings route. */
  fallback?: ReactNode;
}

/**
 * Route guard: render `children` only in a multi-organization deployment
 * ({@link useOrgsFeature}). The FEATURE half of an org-administration route's
 * gate; {@link RequirePermission} is the permission half. No loading state:
 * the mode arrives with the signed-in user, which {@link RequireAuth} has
 * already waited for.
 *
 * @param props - see {@link RequireMultiOrgProps}.
 * @returns the guarded element.
 *
 * @extensionPoint component
 * @stability stable
 */
export function RequireMultiOrg({ children, fallback = <Navigate to="/" replace /> }: RequireMultiOrgProps): ReactElement {
  const orgs = useOrgsFeature();
  return <>{orgs ? children : fallback}</>;
}
