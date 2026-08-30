import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { ThemeContextProvider, useThemeContext } from './contexts/ThemeContext';
import { ProtectedRoute } from './components/common/ProtectedRoute';
import { RequirePermission } from './components/common/RequirePermission';
import { Layout } from './components/common/Layout';
import { ErrorBoundary } from './components/common/ErrorBoundary';

// Pages (lazy loaded)
import { Suspense, lazy } from 'react';
import { LoadingSpinner } from './components/common/LoadingSpinner';

const LoginPage = lazy(() => import('./pages/LoginPage'));
const AuthCallbackPage = lazy(() => import('./pages/AuthCallbackPage'));
const ActivateDevicePage = lazy(() => import('./pages/ActivateDevicePage'));
const HomePage = lazy(() => import('./pages/HomePage'));
const UserSettingsPage = lazy(() => import('./pages/UserSettingsPage'));
const SystemSettingsPage = lazy(() => import('./pages/SystemSettingsPage'));

// Console — one route per card in `config/adminSections.tsx` (#92, epic #90).
const GeneralSettingsPage = lazy(() => import('./pages/Admin/GeneralSettingsPage'));
const AppearanceSettingsPage = lazy(() => import('./pages/Admin/AppearanceSettingsPage'));
const FeatureFlagsPage = lazy(() => import('./pages/Admin/FeatureFlagsPage'));
const AdvancedSettingsPage = lazy(() => import('./pages/Admin/AdvancedSettingsPage'));
const AdminUsersPage = lazy(() => import('./pages/Admin/UsersPage'));

// Test login page (development only)
const TestLoginPage = import.meta.env.PROD
  ? null
  : lazy(() => import('./pages/TestLoginPage'));

function AppRoutes() {
  const { theme } = useThemeContext();

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <ErrorBoundary>
        <Suspense fallback={<LoadingSpinner fullScreen />}>
          <Routes>
            {/* Public routes */}
            <Route path="/login" element={<LoginPage />} />
            <Route path="/auth/callback" element={<AuthCallbackPage />} />

            {/* Test login (development only) */}
            {!import.meta.env.PROD && TestLoginPage && (
              <Route path="/testing/login" element={<TestLoginPage />} />
            )}

            {/* Protected routes */}
            <Route element={<ProtectedRoute />}>
              {/* Device activation page - without layout for full-screen experience */}
              <Route path="/activate" element={<ActivateDevicePage />} />

              <Route element={<Layout />}>
                <Route path="/" element={<HomePage />} />
                <Route path="/settings" element={<UserSettingsPage />} />
                {/* Route-level AUTHORIZATION, not just authentication.
                    `ProtectedRoute` above only establishes that someone is
                    logged in — before this, a Viewer typing `/admin/settings`
                    reached the page and only then watched every API call 403.
                    `RequirePermission` was already in the codebase but had zero
                    usages; wrapping these routes is what turns it into the
                    enforcement point.

                    The permission on each route is the SAME string its card
                    declares in `config/adminSections.tsx`, which is the same
                    string the API's controller enforces — so the hub card, the
                    rail row, the menu entry and the route can no longer
                    disagree about who may go where.

                    ORDER IS NOT SIGNIFICANT HERE. React Router v6 ranks routes
                    by specificity rather than by declaration order, so
                    `/admin/settings/users` beats `/admin/settings` regardless
                    of where each sits in this list. They are grouped by surface
                    for reading, not for matching. */}

                {/* Both redirects are REAL ROUTES, not catch-all fallout.
                    Without them a bookmarked `/admin/users` matches only `*`
                    and lands silently on `/` — the user asked for a page that
                    still exists and got the home screen with no explanation.
                    `replace` keeps the dead URL out of the history stack, so
                    Back returns to wherever the user came from rather than
                    bouncing through the redirect again.

                    They sit INSIDE `ProtectedRoute` so an unauthenticated
                    bookmark goes to login and arrives here afterwards, rather
                    than being redirected first and losing the destination. */}
                <Route path="/admin" element={<Navigate to="/admin/settings" replace />} />
                <Route
                  path="/admin/users"
                  element={<Navigate to="/admin/settings/users" replace />}
                />

                {/* TODO(#93): `/admin/settings` becomes `SettingsHubPage` — the
                    searchable, grouped card grid that reads `ADMIN_SECTIONS`.
                    Until then it keeps rendering the old three-tab
                    `SystemSettingsPage` so the hub path does not 404 and the
                    Console destination has somewhere to land. The tabs it shows
                    now duplicate the four routes below; that duplication is
                    temporary and ends when #93 replaces this element. */}
                {/* ANY-OF, and the one route here that is not a single
                    permission. This gate MUST STAY IN SYNC WITH `console`'s
                    `anyPermission` in `config/destinations.ts` — the two lists
                    answer the same question ("may this user reach the admin
                    surface?") on two different surfaces, and #92 left them
                    disagreeing: the Console row appeared in the rail, bottom
                    bar, user menu and quick actions for a `users:read`-only
                    user, whose click then bounced straight back to `/`. That
                    split brain is exactly what `config/destinations.ts`'s
                    header says the destination model exists to prevent, so the
                    route follows the destination rather than the reverse.

                    `requireAll` defaults to `false`, so `permissions` is an OR
                    here — matching `anyPermission`'s semantics, not
                    `hasAllPermissions`'.

                    A `users:read`-only user consequently reaches this route and
                    meets `SystemSettingsPage`'s OWN access-denied state, since
                    that placeholder checks `system_settings:read` internally.
                    That is accepted for now — landing on a denial inside the
                    admin surface beats being ejected from it — and it
                    disappears with #93, when `SettingsHubPage` renders whatever
                    cards the user can actually see. The five child routes below
                    keep their single-permission gates: each is one specific
                    page with one specific permission. */}
                <Route
                  path="/admin/settings"
                  element={
                    <RequirePermission
                      permissions={['system_settings:read', 'users:read']}
                      fallback={<Navigate to="/" replace />}
                    >
                      <SystemSettingsPage />
                    </RequirePermission>
                  }
                />
                <Route
                  path="/admin/settings/general"
                  element={
                    <RequirePermission
                      permission="system_settings:read"
                      fallback={<Navigate to="/" replace />}
                    >
                      <GeneralSettingsPage />
                    </RequirePermission>
                  }
                />
                <Route
                  path="/admin/settings/appearance"
                  element={
                    <RequirePermission
                      permission="system_settings:read"
                      fallback={<Navigate to="/" replace />}
                    >
                      <AppearanceSettingsPage />
                    </RequirePermission>
                  }
                />
                <Route
                  path="/admin/settings/feature-flags"
                  element={
                    <RequirePermission
                      permission="system_settings:read"
                      fallback={<Navigate to="/" replace />}
                    >
                      <FeatureFlagsPage />
                    </RequirePermission>
                  }
                />
                {/* `system_settings:WRITE`, not `read`, and the one route here
                    whose permission differs from its siblings'. A raw editor
                    over the entire settings document has no read-only meaning —
                    see `config/adminSections.tsx`. */}
                <Route
                  path="/admin/settings/advanced"
                  element={
                    <RequirePermission
                      permission="system_settings:write"
                      fallback={<Navigate to="/" replace />}
                    >
                      <AdvancedSettingsPage />
                    </RequirePermission>
                  }
                />
                {/* `users:read` alone, even though the page also hosts the
                    allowlist. The route gate is about REACHABILITY and the page
                    is worth reaching for its Users tab; the Allowlist tab gates
                    its own content on `allowlist:read` inside the page. */}
                <Route
                  path="/admin/settings/users"
                  element={
                    <RequirePermission
                      permission="users:read"
                      fallback={<Navigate to="/" replace />}
                    >
                      <AdminUsersPage />
                    </RequirePermission>
                  }
                />
              </Route>
            </Route>

            {/* Fallback */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </ErrorBoundary>
    </ThemeProvider>
  );
}

export default function App() {
  return (
    <ThemeContextProvider>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </ThemeContextProvider>
  );
}
