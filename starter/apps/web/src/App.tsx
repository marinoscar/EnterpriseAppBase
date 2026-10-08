import { APP_NAME } from '@app/shared';
import { AppBar, Box, Button, CircularProgress, Container, Toolbar, Typography } from '@mui/material';
import { Link, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { DoctorPage } from '@marinoscar/platform-web/doctor/ui';
import {
  AuthProvider,
  IdentityWebAdaptersProvider,
  RequireAuth,
  RequirePermission,
  useAuth,
  useOrgsFeature,
  usePermissions,
} from '@marinoscar/platform-web/identity/headless';
import { AuthCallbackPage, LoginPage, OrganizationPage, OrganizationsPage, UserTokensPage, UsersPage } from '@marinoscar/platform-web/identity/ui';
import { JobInsightsPage, JobsPage } from '@marinoscar/platform-web/jobs/ui';
import { registerSettingsFeature, useSettingsFeatures } from '@marinoscar/platform-web/settings/headless';
import { SettingsHub, type SettingsHubProps } from '@marinoscar/platform-web/settings/ui';
import type { ReactElement } from 'react';

import { api } from './api';
import { ADMIN_SECTIONS } from './config/adminSections';
import { USER_SETTINGS_SECTIONS } from './config/userSettingsSections';
import { NotesPage } from './pages/NotesPage';
import { AppPlatformHost } from './platformHost';

// The `orgs` feature: the organization cards show only in multi-organization mode.
declare module '@marinoscar/platform-web/settings/headless' {
  interface SettingsFeatureRegistry {
    orgs: true;
  }
}
registerSettingsFeature('orgs', useOrgsFeature);

const spinner = (
  <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '60vh' }}>
    <CircularProgress aria-label="Loading" />
  </Box>
);

/** A route behind the permission its card declares (the same string the API enforces). */
function Gate({ permission, children }: { permission: string; children: ReactElement }) {
  return (
    <RequirePermission permission={permission} fallback={<Navigate to="/" replace />}>
      {children}
    </RequirePermission>
  );
}

function Shell() {
  const { user, logout } = useAuth();
  const { hasPermission } = usePermissions();
  return (
    <AppPlatformHost>
      <AppBar position="static" elevation={0}>
        <Toolbar sx={{ gap: 1 }}>
          <Typography variant="h6" component={Link} to="/" sx={{ flexGrow: 1, color: 'inherit', textDecoration: 'none' }}>
            {APP_NAME}
          </Typography>
          <Button color="inherit" component={Link} to="/notes">
            Notes
          </Button>
          <Button color="inherit" component={Link} to="/settings">
            Settings
          </Button>
          {hasPermission('system_settings:read') && (
            <Button color="inherit" component={Link} to="/admin/settings">
              Admin
            </Button>
          )}
          <Button color="inherit" onClick={() => void logout()} aria-label={`Sign out ${user?.email ?? ''}`}>
            Sign out
          </Button>
        </Toolbar>
      </AppBar>
      <Outlet />
    </AppPlatformHost>
  );
}

function Home() {
  const { user } = useAuth();
  return (
    <Container sx={{ py: 4 }}>
      <Typography variant="h4" component="h1">
        Welcome{user?.displayName ? `, ${user.displayName}` : ''}
      </Typography>
      <Typography color="text.secondary" sx={{ mt: 1 }}>
        Start with your notes, or open Settings.
      </Typography>
    </Container>
  );
}

/** The routes. Every settings page is reachable from a registry card (config/). */
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/auth/callback" element={<AuthCallbackPage />} />
      <Route element={<RequireAuth loading={spinner} />}>
        <Route element={<Shell />}>
          <Route index element={<Home />} />
          <Route path="notes" element={<Gate permission="notes:read"><NotesPage /></Gate>} />
          <Route path="settings" element={<Hub sections={USER_SETTINGS_SECTIONS} hubKey="user-settings-hub" title="Settings" subtitle="Manage your account preferences." />} />
          <Route path="settings/tokens" element={<UserTokensPage />} />
          <Route path="admin/settings" element={<Hub sections={ADMIN_SECTIONS} hubKey="admin-settings-hub" title="Administration" subtitle="Users, background jobs and the health of this deployment." />} />
          <Route path="admin/settings/users" element={<Gate permission="users:read"><UsersPage /></Gate>} />
          <Route path="admin/settings/organization" element={<Gate permission="org_members:read"><OrganizationPage /></Gate>} />
          <Route path="admin/settings/organizations" element={<Gate permission="organizations:read"><OrganizationsPage /></Gate>} />
          <Route path="admin/settings/jobs" element={<Gate permission="jobs:read"><JobsPage /></Gate>} />
          <Route path="admin/settings/jobs/insights" element={<Gate permission="jobs:read"><JobInsightsPage /></Gate>} />
          <Route path="admin/settings/doctor" element={<Gate permission="system_settings:read"><DoctorPage /></Gate>} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

/** Both hubs are one packaged component bound to a registry (the Settings UI Pattern). */
function Hub(props: Omit<SettingsHubProps, 'hasPermission' | 'features'>) {
  const { hasPermission } = usePermissions();
  return <SettingsHub {...props} features={useSettingsFeatures()} hasPermission={hasPermission} />;
}

export default function App() {
  return (
    <AuthProvider client={api}>
      <IdentityWebAdaptersProvider adapters={{ appName: APP_NAME }}>
        <AppRoutes />
      </IdentityWebAdaptersProvider>
    </AuthProvider>
  );
}
