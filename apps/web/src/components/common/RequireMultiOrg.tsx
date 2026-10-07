/**
 * Route guard: render `children` only in a multi-organization deployment
 * (#726, PP-6.7), i.e. while `/api/auth/me` reports `tenancyMode: 'multi'`.
 *
 * The FEATURE half of an org-administration route's gate, the twin of
 * `RequireAiEnabled`; `RequirePermission` is the permission half, and
 * `App.tsx` nests this inside it. In single-org mode ("org management
 * hidden", the platform-packages spec) a direct URL falls back exactly like a
 * feature-off AI page: a replace-redirect home.
 *
 * No loading state: the mode arrives with the signed-in user, which
 * `ProtectedRoute` has already waited for. The API still enforces every
 * permission; this only decides reachability.
 */
import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useOrgsFeature } from '../../hooks/useOrgsFeature';

interface RequireMultiOrgProps {
  children: ReactNode;
  /** Rendered in single-org mode. Defaults to a replace-redirect to `/`, like every settings route. */
  fallback?: ReactNode;
}

export function RequireMultiOrg({ children, fallback = <Navigate to="/" replace /> }: RequireMultiOrgProps) {
  const orgs = useOrgsFeature();
  return <>{orgs ? children : fallback}</>;
}
