import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { Routes, Route, Navigate } from 'react-router-dom';
// The identity slice (#727, PP-6.6): the auth provider and the identity
// pages' adapters are packaged; the app binds its transport, its logout
// clean-up and its adapters (`platform/identityAdapters.ts`).
import {
  AuthProvider,
  IdentityWebAdaptersProvider,
  RequireAuth,
  RequireMultiOrg,
  RequirePermission,
} from '@marinoscar/platform-web/identity/headless';
import { api } from './services/api';
import { appIdentityAdapters } from './platform/identityAdapters';
// The notifications web slice (#738): its configuration first, for its side
// effect, then the provider and the logout hook it exports.
import './platform/notifications';
import { removePushSubscription } from '@marinoscar/platform-web/notifications/headless';
import { ShellProviders } from '@marinoscar/platform-web/shell/headless';
import { APP_SHELL_PROVIDERS } from './platform/shellProviders';
import { ThemeContextProvider, useThemeContext } from './contexts/ThemeContext';
import { RequireAiEnabled } from './components/common/RequireAiEnabled';
import { Layout } from './components/common/Layout';
import { ErrorBoundary } from './components/common/ErrorBoundary';
// Issue #258, epic #254. Eagerly imported, not lazy: it renders on the error
// path of a deployment that is deliberately out of service, and a code-split
// chunk fetched at that moment is one more thing that has to be working for the
// screen explaining why nothing is working to appear at all.
import { MaintenanceGate } from './components/common/MaintenanceGate';
// PWA prompts (#219, epic #215). Eagerly imported, not lazy: `UpdatePrompt` is
// what REGISTERS the service worker, and a registration deferred behind a
// dynamic import would not happen until React had already decided it was
// needed. Both render `null` in their default state, so the cost is a few
// hundred bytes in the entry chunk.
import { UpdatePrompt } from './components/pwa/UpdatePrompt';
import { InstallPrompt } from './components/pwa/InstallPrompt';
// The platform host every packaged page reads (#696).
import { appPlatformApi } from './platform/platformHost';
// Onboarding (#745): one GET /api/onboarding for the shell (its provider is in
// `platform/shellProviders.tsx`); the welcome dialog (mounted in Layout), the
// user menu and both onboarding pages read it.
import './platform/onboarding';
// The telemetry slice (#704): its route guard. Its config provider and the
// app's adapters are in `platform/shellProviders.tsx`.
import { RequireTelemetryEnabled } from '@marinoscar/platform-web/telemetry/headless';

// Pages (lazy loaded)
import { Suspense, lazy } from 'react';
import { LoadingSpinner } from './components/common/LoadingSpinner';

// The identity pages are packaged (#727, PP-6.6,
// `@marinoscar/platform-web/identity/ui`): the login page is the packaged one
// with this app's slots (`identity/LoginPage.tsx`); the others are the
// package's pages as they ship, lazy like every other page.
const LoginPage = lazy(() => import('./identity/LoginPage'));
const AuthCallbackPage = lazy(() =>
  import('@marinoscar/platform-web/identity/ui').then((m) => ({ default: m.AuthCallbackPage })),
);
const ActivateDevicePage = lazy(() =>
  import('@marinoscar/platform-web/identity/ui').then((m) => ({ default: m.ActivateDevicePage })),
);
const HomePage = lazy(() => import('./pages/HomePage'));
// User settings — the hub (#96) plus one route per card in
// `config/userSettingsSections.tsx` (#91, epic #90). These replace the single
// stacked `UserSettingsPage`, which is deleted rather than left unrouted.
const UserSettingsHubPage = lazy(() => import('./pages/UserSettingsHubPage'));
const UserProfilePage = lazy(() => import('./pages/UserProfilePage'));
// `User`-prefixed to make explicit that it edits the signed-in user's own
// theme, not anything under the Console.
const UserAppearancePage = lazy(() => import('./pages/UserAppearancePage'));
// Issue #126, epic #109 — the per-user event x channel notification matrix.
const UserNotificationsPage = lazy(() =>
  import('@marinoscar/platform-web/notifications/ui').then((m) => ({ default: m.UserNotificationsPage })),
);
const UserTokensPage = lazy(() =>
  import('@marinoscar/platform-web/identity/ui').then((m) => ({ default: m.UserTokensPage })),
);

// Console — the hub (#93) plus one route per card in
// `config/adminSections.tsx` (#92, epic #90).
const SettingsHubPage = lazy(() => import('./pages/Admin/SettingsHubPage'));
// Issue #124, epic #109 — the admin email configuration and its test send.
const EmailSettingsPage = lazy(() => import('@marinoscar/platform-web/email/ui'));
// Issue #225, epic #215 — the deployment-wide browser-notification policy.
const NotificationSettingsPage = lazy(() =>
  import('@marinoscar/platform-web/notifications/ui').then((m) => ({ default: m.NotificationSettingsPage })),
);
// Issue #355 — runtime-configurable Web Push (VAPID) key management.
const PushConfigPage = lazy(() =>
  import('@marinoscar/platform-web/notifications/ui').then((m) => ({ default: m.PushConfigPage })),
);
// Issue #376, epic #372 — the object-storage configuration, its connection
// test and its bucket provisioner.
const StorageConfigPage = lazy(() => import('@marinoscar/platform-web/storage/ui'));
// Issue #258, epic #254 — the maintenance window's switch and its layers.
// `Admin`-prefixed locally to keep it distinct from `pages/MaintenancePage`,
// which is the screen a BLOCKED user sees rather than the page that opens and
// closes the window.
const AdminMaintenancePage = lazy(() => import('./pages/Admin/MaintenancePage'));
// Issue #266, epic #254 — the background queue's two Operations pages, and
// (#271) the fleet page with the node credentials it hosts as a section;
// packaged in `@marinoscar/platform-web/jobs/ui` since #854. Lazy like every
// other admin page: they pull in the shared DataTable, and none is on the path
// of a user who never opens the Console.
const JobsPage = lazy(() =>
  import('@marinoscar/platform-web/jobs/ui').then((m) => ({ default: m.JobsPage })),
);
const JobInsightsPage = lazy(() =>
  import('@marinoscar/platform-web/jobs/ui').then((m) => ({ default: m.JobInsightsPage })),
);
// The fleet page moved on into `@marinoscar/platform-web/nodes/ui` (#881).
const WorkersPage = lazy(() =>
  import('@marinoscar/platform-web/nodes/ui').then((m) => ({ default: m.WorkersPage })),
);
// Issue #287, epic #254 — the backup policy, the run history and the restore
// dialog. Lazy for the same reason: a DataTable, a policy form and the restore
// dialog that nobody who never opens the Console will ever mount.
const DbBackupPage = lazy(() => import('@marinoscar/platform-web/db-backup/ui'));
// Issue #325, epic #319 — the admin broadcast list and its composer. Lazy for
// the same reason: a DataTable, a composer dialog and a detail dialog that
// nobody who never opens the Console will ever mount.
const BroadcastsPage = lazy(() =>
  import('@marinoscar/platform-web/notifications/ui').then((m) => ({ default: m.BroadcastsPage })),
);
// Issue #401, epic #397 — what is actually deployed here: the version, the
// commit, the deploy run that put it there. Lazy like every other admin page;
// nobody who never opens the Console mounts it.
const AboutPage = lazy(() => import('./pages/Admin/AboutPage'));
const AdminUsersPage = lazy(() =>
  import('@marinoscar/platform-web/identity/ui').then((m) => ({ default: m.UsersPage })),
);
// Issue #425, epic #419 — placeholders, filled in by #429, #430 and #434.
const AiConfigPage = lazy(() => import('./pages/Admin/AiConfigPage'));
const AiModelsPage = lazy(() => import('./pages/Admin/AiModelsPage'));
// Issue #444, epic #420 — AI usage aggregates.
const AiUsagePage = lazy(() => import('./pages/Admin/AiUsagePage'));
// Issue #739 (PP-8.6) — the active organization's own AI keys, the AI slice's
// packaged page (`@marinoscar/platform-web/ai/ui`).
const OrgAiKeysPage = lazy(() => import('@marinoscar/platform-web/ai/ui'));
const UserAiKeysPage = lazy(() => import('./pages/UserAiKeysPage'));
const AiPlaygroundPage = lazy(() => import('./pages/AiPlaygroundPage'));
// Issue #537, epic #528 — the telemetry policy page and the SQL explorer. Lazy
// like every admin page; the explorer additionally lazy-loads its CodeMirror
// editor, so neither weighs on the entry chunk. Packaged since #704
// (`@marinoscar/platform-web/telemetry/ui`): each page has a subpath of its
// own so it stays in a chunk of its own.
const TelemetrySettingsPage = lazy(() => import('@marinoscar/platform-web/telemetry/ui/settings-page'));
const TelemetryExplorerPage = lazy(() => import('@marinoscar/platform-web/telemetry/ui/explorer-page'));
// Issue #578, epic #576 — the at-a-glance dashboard; lazy, and its charts
// (`@mui/x-charts`) travel in its own chunk.
const TelemetryDashboardPage = lazy(() => import('@marinoscar/platform-web/telemetry/ui/dashboard-page'));
const DoctorPage = lazy(() => import('./pages/Admin/DoctorPage'));
// Organization administration (#726, PP-6.7): multi-org deployments only.
const OrganizationPage = lazy(() =>
  import('@marinoscar/platform-web/identity/ui').then((m) => ({ default: m.OrganizationPage })),
);
// With the user-data slice's "Offboard" row action (#743).
const OrganizationsPage = lazy(() => import('./pages/UserDataPages').then((m) => ({ default: m.OrganizationsRoute })));
// The user-data slice's pages (#743, #880): the user Danger Zone and the admin
// factory reset mount as shipped; they re-read the user through the host's
// `viewer.refresh` (platform/platformHost.tsx).
const DangerZonePage = lazy(() => import('@marinoscar/platform-web/user-data/ui').then((m) => ({ default: m.UserDangerZonePage })));
const FactoryResetPage = lazy(() => import('@marinoscar/platform-web/user-data/ui').then((m) => ({ default: m.FactoryResetPage })));
// #733 (PP-8.1): the active organization's settings overrides.
const OrgSettingsPage = lazy(() => import('./pages/Admin/OrgSettingsPage'));
// The sharing slice's pages (#731): the groups settings destination and its
// detail page, and the public link page. One lazy chunk for the slice's UI.
const GroupsPage = lazy(() =>
  import('@marinoscar/platform-web/sharing/ui').then((module) => ({ default: module.GroupsPage })),
);
const GroupDetailPage = lazy(() =>
  import('@marinoscar/platform-web/sharing/ui').then((module) => ({ default: module.GroupDetailPage })),
);
const PublicLinkPage = lazy(() =>
  import('@marinoscar/platform-web/sharing/ui').then((module) => ({ default: module.PublicLinkPage })),
);
// Onboarding (#745): the packaged Setup guide and Getting started pages.
const SetupGuidePage = lazy(() =>
  import('@marinoscar/platform-web/onboarding/ui').then((m) => ({ default: m.SetupGuidePage })),
);
const DataExportPage = lazy(() =>
  import('@marinoscar/platform-web/exports/ui').then((m) => ({ default: m.DataExportPage })),
);
const GettingStartedPage = lazy(() =>
  import('@marinoscar/platform-web/onboarding/ui').then((m) => ({ default: m.GettingStartedPage })),
);
// Android app (#746): the packaged admin page.
const AndroidAppPage = lazy(() =>
  import('@marinoscar/platform-web/android-app/ui').then((m) => ({ default: m.AndroidAppPage })),
);

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
        {/* THE CLIENT GATE (#258, epic #254), around the whole route tree and
            inside `AuthProvider`.

            Around everything, because a maintenance window is a property of the
            deployment rather than of any one page — the user's next click is
            refused wherever they are — and because swapping the subtree is what
            makes the screen's retry work: the pages unmount, and clearing the
            block remounts them so their own effects re-issue the requests that
            failed.

            Inside `AuthProvider` because the screen asks who is looking:
            `system_settings:read` decides whether it offers a link to the page
            that closes the window. That answer comes from the session already
            in memory, never from the API, which is refusing.

            An ordinary 503 with no marker never reaches it — see
            `services/maintenance.ts` for why that distinction is the feature. */}
        <MaintenanceGate>
          <Suspense fallback={<LoadingSpinner fullScreen />}>
            <Routes>
              {/* Public routes */}
              <Route path="/login" element={<LoginPage />} />
              <Route path="/auth/callback" element={<AuthCallbackPage />} />
              {/* Issue #731. The public link page (`/s#lnk_…`), OUTSIDE
                  `RequireAuth`: anyone holding a share link opens it,
                  signed in or not, and no shell (no bell, no SSE stream, no
                  host) mounts around it. The packaged page takes the app's
                  transport directly; it reads the token from the fragment,
                  removes it from the address bar at once and sends it only in
                  `x-link-token`. Nothing in this app reads `location.hash` or
                  `location.href` for telemetry, so the token is never
                  captured; keep it that way for `/s`. */}
              <Route path="/s" element={<PublicLinkPage apiClient={appPlatformApi} />} />

              {/* Test login (development only) */}
              {!import.meta.env.PROD && TestLoginPage && (
                <Route path="/testing/login" element={<TestLoginPage />} />
              )}

              {/* Protected routes: the packaged signed-in gate (#727), with
                  this app's full-screen spinner while the session probe runs. */}
              <Route element={<RequireAuth loading={<LoadingSpinner fullScreen />} />}>
                {/* Device activation page - without layout for full-screen experience */}
                <Route path="/activate" element={<ActivateDevicePage />} />

                {/* The providers around the signed-in shell (#868): one
                    ordered list in `platform/shellProviders.tsx`, outermost
                    first, which documents why each sits where it does — the
                    notification centre (#127) wraps the SHELL so there is one
                    SSE connection per tab, the AI and telemetry configs
                    (#425, #537) are fetched once for the chrome and every
                    page, the slices' adapters (#704, #854, #740), the
                    platform host (#696) inside the feature providers so its
                    flags are real, and onboarding (#745) innermost. All
                    inside `RequireAuth`; `/activate` above sits outside the
                    shell on purpose (full-screen device flow) and gets no
                    bell and opens no stream. */}
                <Route
                  element={
                    <ShellProviders providers={APP_SHELL_PROVIDERS}>
                      <Layout />
                    </ShellProviders>
                  }
                >
                  <Route path="/" element={<HomePage />} />
                  {/* The per-user settings surface (#96, epic #90) — the same
                      hub component `/admin/settings` renders, over
                      `USER_SETTINGS_SECTIONS`, plus one route per card.

                      NONE OF THESE IS WRAPPED IN `RequirePermission`, and that is
                      the deliberate difference from the `/admin/settings/*` block
                      below rather than an oversight. `RequireAuth` above
                      establishes that someone is signed in, and that is the only
                      question these routes have: they edit the caller's OWN
                      settings, which the API grants to all three roles, and
                      `config/userSettingsSections.tsx` correspondingly declares no
                      `permission` on their cards. A gate here would deny a Viewer
                      their own display name. (The single exception, `/settings/ai`
                      below, gates on a grant the API really does withhold — see
                      its own comment.)

                      As above, declaration order does not matter — React Router
                      v6 ranks by specificity, so `/settings/profile` beats
                      `/settings` wherever each is written. */}
                  <Route path="/settings" element={<UserSettingsHubPage />} />
                  <Route path="/settings/profile" element={<UserProfilePage />} />
                  <Route path="/settings/appearance" element={<UserAppearancePage />} />
                  {/* Ungated like its siblings (#126): these are the caller's own
                      preferences, and the registry endpoint the page renders is
                      itself `@Auth()` with no permission for the same reason. */}
                  <Route path="/settings/notifications" element={<UserNotificationsPage />} />
                  <Route path="/settings/tokens" element={<UserTokensPage />} />
                  {/* Issue #731 (PP-7.4). The `Groups` card's destination and
                      its detail page, gated on `groups:read`: the string the
                      card declares (`groupsSettingsPage.card`) and the
                      `/api/groups` controller enforces, an org permission a
                      deployment can withhold. Written as literals because
                      `destinations.test.ts` and `platformPages.test.ts` read
                      this file as text. A destination, not a tab. */}
                  <Route
                    path="/settings/groups"
                    element={
                      <RequirePermission
                        permission="groups:read"
                        fallback={<Navigate to="/" replace />}
                      >
                        <GroupsPage />
                      </RequirePermission>
                    }
                  />
                  <Route
                    path="/settings/groups/:id"
                    element={
                      <RequirePermission
                        permission="groups:read"
                        fallback={<Navigate to="/" replace />}
                      >
                        <GroupDetailPage />
                      </RequirePermission>
                    }
                  />
                  {/* Issue #425, epic #419. THE ONE GATED `/settings/*` ROUTE,
                      and the exception is real: `ai:use` is a grant a
                      deployment can withhold from a role, and the
                      `/api/ai/keys` controller enforces exactly that string —
                      the same one the `AI Keys` card declares. Nested inside
                      it, `RequireAiEnabled` redirects while AI is switched
                      off, when every call the page makes would be refused. */}
                  <Route
                    path="/settings/ai"
                    element={
                      <RequirePermission
                        permission="ai:use"
                        fallback={<Navigate to="/" replace />}
                      >
                        <RequireAiEnabled>
                          <UserAiKeysPage />
                        </RequireAiEnabled>
                      </RequirePermission>
                    }
                  />
                  {/* Issue #425, epic #419 — the `ai` destination. Gated
                      exactly as the destination is: `ai:use` AND
                      `ai_config:read` (#593 — the Playground is an operator
                      tool, and `ai_config:read` is the string the admin
                      `/api/admin/ai/*` controllers enforce) plus AI being on. */}
                  <Route
                    path="/ai"
                    element={
                      <RequirePermission
                        permission="ai:use"
                        fallback={<Navigate to="/" replace />}
                      >
                        <RequirePermission
                          permission="ai_config:read"
                          fallback={<Navigate to="/" replace />}
                        >
                          <RequireAiEnabled>
                            <AiPlaygroundPage />
                          </RequireAiEnabled>
                        </RequirePermission>
                      </RequirePermission>
                    }
                  />
                  {/* Route-level AUTHORIZATION, not just authentication.
                      `RequireAuth` above only establishes that someone is
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

                      They sit INSIDE `RequireAuth` so an unauthenticated
                      bookmark goes to login and arrives here afterwards, rather
                      than being redirected first and losing the destination. */}
                  <Route path="/admin" element={<Navigate to="/admin/settings" replace />} />
                  <Route
                    path="/admin/users"
                    element={<Navigate to="/admin/settings/users" replace />}
                  />
                  {/* Issue #392. The "Deployment" page that issue asked for is
                      delivered by the About page, so this URL is a REDIRECT
                      and deliberately NOT a second `ADMIN_SECTIONS` card — one
                      question, one destination. Ungated for the same reason
                      as the two above: the TARGET route gates. */}
                  <Route
                    path="/admin/settings/deployment"
                    element={<Navigate to="/admin/settings/about" replace />}
                  />

                  {/* The Console hub (#93, epic #90) — the searchable, grouped
                      card grid that reads `ADMIN_SECTIONS`. It replaces the
                      three-tab placeholder that answered this route through #92,
                      whose tabs duplicated the four routes below. That
                      duplication is now gone: the hub NAVIGATES to those routes
                      instead of re-hosting them. */}
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

                      A `users:read`-only user consequently reaches this route
                      and — since #93 — sees a hub containing exactly the one card
                      that permission unlocks, instead of the placeholder page's
                      blanket access-denied state. The hub's own gate
                      (`visibleSettingsSections`) does that per CARD, which is why
                      this route only answers the coarser question "may this user
                      reach the admin surface at all?". The five child routes
                      below keep their single-permission gates: each is one
                      specific page with one specific permission.

                      `org_members:read` (#726) joins the list, with the
                      destination: an organization's administrator holds no
                      system permission and reaches a hub showing only the
                      `Organization` card. */}
                  <Route
                    path="/admin/settings"
                    element={
                      <RequirePermission
                        permissions={['system_settings:read', 'users:read', 'org_members:read']}
                        fallback={<Navigate to="/" replace />}
                      >
                        <SettingsHubPage />
                      </RequirePermission>
                    }
                  />
                  {/* Issue #124, epic #109. Same permission string the `Email`
                      card declares in `config/adminSections.tsx`, which is the
                      same string the API's email-settings controller enforces on
                      its GET — the invariant `destinations.test.ts` asserts for
                      every card. `system_settings:read` and not `:write`: saving
                      and test-sending need write, and the page disables both
                      without it, but the configuration is worth READING for
                      anyone diagnosing why mail is not arriving. */}
                  <Route
                    path="/admin/settings/email"
                    element={
                      <RequirePermission
                        permission="system_settings:read"
                        fallback={<Navigate to="/" replace />}
                      >
                        <EmailSettingsPage />
                      </RequirePermission>
                    }
                  />
                  {/* Issue #225, epic #215. `system_settings:read`, the same
                      string the `Notifications` card declares and the same one
                      `system-settings.controller.ts` enforces on its GET — the
                      invariant `destinations.test.ts` asserts for every card.
                      Saving needs `system_settings:write`, which the page gates
                      internally by disabling its controls. */}
                  <Route
                    path="/admin/settings/notifications"
                    element={
                      <RequirePermission
                        permission="system_settings:read"
                        fallback={<Navigate to="/" replace />}
                      >
                        <NotificationSettingsPage />
                      </RequirePermission>
                    }
                  />
                  {/* Issue #355. Same permission string the `Web Push` card
                      declares in `config/adminSections.tsx`, which is the
                      same string the API's push-config controller enforces on
                      its GET — the invariant `destinations.test.ts` asserts
                      for every card. `push:read` and not `:write`: generating,
                      rotating, enabling/disabling and removing all need
                      `push:write`, which the page disables without it, but
                      the configuration is worth READING for anyone diagnosing
                      why push notifications are not arriving. */}
                  <Route
                    path="/admin/settings/push"
                    element={
                      <RequirePermission
                        permission="push:read"
                        fallback={<Navigate to="/" replace />}
                      >
                        <PushConfigPage />
                      </RequirePermission>
                    }
                  />
                  {/* Issue #376, epic #372. Same permission string the
                      `Storage` card declares in `config/adminSections.tsx`,
                      which is the same string the API's storage-config
                      controller enforces on its GET — the invariant
                      `destinations.test.ts` asserts for every card.
                      `storage_config:read` and not `:write`: saving, testing
                      the connection and creating the bucket all need
                      `storage_config:write`, which the page disables without
                      it, but the configuration is worth READING for anyone
                      diagnosing why an upload failed. And deliberately NOT
                      `storage:read`, which every ordinary user holds — see the
                      card's own comment. */}
                  <Route
                    path="/admin/settings/storage"
                    element={
                      <RequirePermission
                        permission="storage_config:read"
                        fallback={<Navigate to="/" replace />}
                      >
                        <StorageConfigPage />
                      </RequirePermission>
                    }
                  />
                  {/* Issue #258, epic #254. Same permission string the
                      `Maintenance` card declares and the same one
                      `host/maintenance/maintenance.controller.ts` enforces on
                      its GET — the invariant `destinations.test.ts` asserts for
                      every card. Opening and closing a window needs
                      `system_settings:write`, which the page gates internally by
                      disabling its controls.

                      THIS IS ALSO THE ONE ROUTE `MaintenanceGate` NEVER COVERS,
                      mirroring `@AllowDuringMaintenance()` on the controller
                      behind it: the switch that ends a window has to be reachable
                      while the window is open, on both sides. */}
                  <Route
                    path="/admin/settings/maintenance"
                    element={
                      <RequirePermission
                        permission="system_settings:read"
                        fallback={<Navigate to="/" replace />}
                      >
                        <AdminMaintenancePage />
                      </RequirePermission>
                    }
                  />
                  {/* Issue #266, epic #254. `jobs:read` on both, the same
                      string the `Jobs` and `Job Insights` cards declare and the
                      same one `jobs/job-admin.controller.ts` enforces on its
                      list, stats and insights reads — the invariant
                      `destinations.test.ts` asserts for every card. Retrying,
                      deleting, sweeping and clearing the rollup all need
                      `jobs:write`, which each PAGE gates internally by omitting
                      the row actions and the sweep buttons.

                      TWO ROUTES, NOT A TAB. `/admin/settings/jobs/insights`
                      nests under the Jobs path deliberately, and React Router
                      v6 ranks by specificity, so the nested route wins wherever
                      it is declared. `settingsPageTitle`'s longest-prefix rule
                      is what keeps the compact AppBar titling it "Job Insights"
                      rather than "Jobs". */}
                  <Route
                    path="/admin/settings/jobs"
                    element={
                      <RequirePermission
                        permission="jobs:read"
                        fallback={<Navigate to="/" replace />}
                      >
                        <JobsPage />
                      </RequirePermission>
                    }
                  />
                  <Route
                    path="/admin/settings/jobs/insights"
                    element={
                      <RequirePermission
                        permission="jobs:read"
                        fallback={<Navigate to="/" replace />}
                      >
                        <JobInsightsPage />
                      </RequirePermission>
                    }
                  />
                  {/* Issue #271, epic #254. Guarded EXACTLY as the two Jobs
                      routes above are, and on `nodes:read` — the literal string
                      `nodes/nodes-admin.controller.ts` enforces on its fleet
                      list, its node detail and its credential list, and the
                      same one the `Worker Nodes` card declares (the invariant
                      `settingsCards.test.ts` asserts against the API's own
                      constants file). Deleting a node and creating or revoking
                      a credential need `nodes:write`, which the PAGE gates
                      internally by omitting the row actions and the create
                      button — the route gate is about REACHABILITY.

                      ONE ROUTE, NOT TWO, and no tab: node credentials are
                      CONTENT of this page rather than a destination of their
                      own, because revoking a leaked worker token is an
                      incident-response action and a second card would put two
                      clicks in front of it. See `WorkersPage.tsx` and
                      `NodeCredentials.tsx` (`packages/platform-web/src/jobs/ui/`)
                      for the full argument and the alternatives rejected. */}
                  <Route
                    path="/admin/settings/workers"
                    element={
                      <RequirePermission
                        permission="nodes:read"
                        fallback={<Navigate to="/" replace />}
                      >
                        <WorkersPage />
                      </RequirePermission>
                    }
                  />
                  {/* Issue #287, epic #254. Guarded EXACTLY as the Jobs and
                      Workers routes above are, and on `db_backup:read` — the
                      literal string `db-backup/db-backup.controller.ts`
                      enforces on its config read, its run list and its run
                      detail (`PERMISSIONS.DB_BACKUP_READ`), and the same one
                      the `Database Backup` card declares (the invariant
                      `destinations.test.ts` asserts for every card).

                      THREE PERMISSIONS BEHIND THIS ONE ROUTE, and only the
                      first is a reachability gate. Scheduling, cancelling and
                      deleting need `db_backup:write`; restoring and rolling
                      back need `db_backup:restore`, which the API keeps
                      SEPARATE from `write` precisely so it can be withheld from
                      someone who may schedule backups but must not be able to
                      replace the database. The PAGE gates both internally by
                      disabling its controls — widening this route gate to
                      either would make the page unreachable for the read-only
                      admin it is most useful to during an incident. */}
                  <Route
                    path="/admin/settings/db-backup"
                    element={
                      <RequirePermission
                        permission="db_backup:read"
                        fallback={<Navigate to="/" replace />}
                      >
                        <DbBackupPage />
                      </RequirePermission>
                    }
                  />
                  {/* Issue #325, epic #319. Guarded EXACTLY as the Jobs and
                      Workers routes above are, and on `broadcasts:read` — the
                      literal string
                      `notifications/broadcasts/broadcasts.controller.ts`
                      (`@marinoscar/platform-api/notifications`) enforces on its audience count, its list and its detail
                      read (`PERMISSIONS.BROADCASTS_READ`), and the same one the
                      `Broadcasts` card declares (the invariant
                      `destinations.test.ts` asserts for every card). Composing,
                      cancelling, deleting and test-sending need
                      `broadcasts:write`, which the PAGE gates internally by
                      disabling its controls with a tooltip — the route gate is
                      about REACHABILITY.

                      The `/admin/settings` hub gate is deliberately NOT widened
                      to include this permission. It mirrors `console`'s
                      `anyPermission` in `config/destinations.ts` byte for byte
                      (asserted in `destinations.test.ts`), and every holder of
                      `broadcasts:read` is an admin who also holds
                      `system_settings:read`, so nothing is unreachable.
                      Widening one side without the other is exactly the
                      disagreement that test exists to catch.

                      #738: ANY OF `broadcasts:read` and the org-scoped
                      `org_broadcasts:read`, the two strings the packaged
                      controller (`@Auth({ anyPermissions })`) accepts and the
                      card's permission list declares. An organization's
                      administrator reaches the Console on `org_members:read`
                      and sees only their organization's broadcasts. */}
                  <Route
                    path="/admin/settings/broadcasts"
                    element={
                      <RequirePermission
                        permissions={['broadcasts:read', 'org_broadcasts:read']}
                        fallback={<Navigate to="/" replace />}
                      >
                        <BroadcastsPage />
                      </RequirePermission>
                    }
                  />
                  {/* Issue #401, epic #397. Guarded EXACTLY as the Jobs,
                      Workers and Broadcasts routes above are, and on
                      `system_settings:read` — the literal string
                      `about/about.controller.ts` enforces on its single GET
                      (`PERMISSIONS.SYSTEM_SETTINGS_READ`), and the same one the
                      `About` card declares (the invariant `destinations.test.ts`
                      asserts for every card).

                      NO WRITE SIDE TO GATE. Unlike every other Operations
                      route, this page has no controls: the endpoint is one GET
                      and the page renders it. So this gate is the only gate,
                      and it is still about REACHABILITY — the page's own
                      `hasPermission` check is defence in depth, exactly as on
                      its siblings.

                      The endpoint ALWAYS answers 200, including when the deploy
                      record is missing, unreadable, written by a failed run, or
                      when the database is down. None of those is a routing or
                      an authorization concern, and none of them must ever be
                      turned into one: the page is opened precisely when things
                      are wrong. */}
                  <Route
                    path="/admin/settings/about"
                    element={
                      <RequirePermission
                        permission="system_settings:read"
                        fallback={<Navigate to="/" replace />}
                      >
                        <AboutPage />
                      </RequirePermission>
                    }
                  />
                  {/* Issue #425, epic #419. `ai_config:read` on both, the
                      same string the `AI` and `AI Models` cards declare and the
                      admin AI controller enforces on its reads — the invariant
                      `destinations.test.ts` asserts for every card. Writes need
                      `ai_config:write`, which each PAGE gates internally.
                      `/admin/settings/ai` is deliberately NOT behind
                      `RequireAiEnabled`: it is where AI is switched on, so it
                      must be reachable while AI is off. The Models page is,
                      matching its card's `feature: 'ai'`. Nested route, longest
                      prefix wins — the Job Insights precedent. */}
                  <Route
                    path="/admin/settings/ai"
                    element={
                      <RequirePermission
                        permission="ai_config:read"
                        fallback={<Navigate to="/" replace />}
                      >
                        <AiConfigPage />
                      </RequirePermission>
                    }
                  />
                  <Route
                    path="/admin/settings/ai/models"
                    element={
                      <RequirePermission
                        permission="ai_config:read"
                        fallback={<Navigate to="/" replace />}
                      >
                        <RequireAiEnabled>
                          <AiModelsPage />
                        </RequireAiEnabled>
                      </RequirePermission>
                    }
                  />
                  <Route
                    path="/admin/settings/ai/usage"
                    element={
                      <RequirePermission
                        permission="ai_config:read"
                        fallback={<Navigate to="/" replace />}
                      >
                        <RequireAiEnabled>
                          <AiUsagePage />
                        </RequireAiEnabled>
                      </RequirePermission>
                    }
                  />
                  {/* Issue #739 (PP-8.6). The `Organization AI keys` card's
                      route: `org_ai_config:read`, the ORG permission the AI
                      slice's `org-keys.controller.ts` enforces on
                      `GET /api/admin/ai/org-keys`, and the string the card
                      declares. Behind `RequireAiEnabled` like AI Models and
                      AI Usage. Writes are gated inside the page. */}
                  <Route
                    path="/admin/settings/ai/organization-keys"
                    element={
                      <RequirePermission
                        permission="org_ai_config:read"
                        fallback={<Navigate to="/" replace />}
                      >
                        <RequireAiEnabled>
                          <OrgAiKeysPage />
                        </RequireAiEnabled>
                      </RequirePermission>
                    }
                  />
                  {/* Issue #537, epic #528. `telemetry:read` is the string the
                      `Telemetry` card declares and `telemetry-admin.controller.ts`
                      enforces on its GETs. NOT behind `RequireTelemetryEnabled`:
                      this is where telemetry is switched on (the `AI` page's
                      precedent). Saving needs `telemetry:write`, which the
                      page gates internally. */}
                  <Route
                    path="/admin/settings/telemetry"
                    element={
                      <RequirePermission
                        permission="telemetry:read"
                        fallback={<Navigate to="/" replace />}
                      >
                        <TelemetrySettingsPage />
                      </RequirePermission>
                    }
                  />
                  {/* `telemetry:query`, the explorer controller's permission,
                      plus the feature: redirected while no store is deployed
                      or collection is off. */}
                  <Route
                    path="/admin/settings/telemetry/explorer"
                    element={
                      <RequirePermission
                        permission="telemetry:query"
                        fallback={<Navigate to="/" replace />}
                      >
                        <RequireTelemetryEnabled>
                          <TelemetryExplorerPage />
                        </RequireTelemetryEnabled>
                      </RequirePermission>
                    }
                  />
                  {/* Issue #578, epic #576. The SAME gates as the explorer:
                      `telemetry:query` (what the dashboard controller enforces)
                      plus the `telemetry` feature. */}
                  <Route
                    path="/admin/settings/telemetry/dashboard"
                    element={
                      <RequirePermission
                        permission="telemetry:query"
                        fallback={<Navigate to="/" replace />}
                      >
                        <RequireTelemetryEnabled>
                          <TelemetryDashboardPage />
                        </RequireTelemetryEnabled>
                      </RequirePermission>
                    }
                  />
                  {/* Issue #634. `system_settings:read`, the string the `Doctor`
                      card declares and `@marinoscar/platform-api/doctor`
                      enforces (bound in `apps/api/src/doctor/doctor.config.ts`).
                      Path and permission are the packaged page's descriptor
                      (`doctorSettingsPage.card`, #696), written as literals
                      because `destinations.test.ts` reads this file as text;
                      `platformPages.test.ts` proves the two agree.
                      NOT behind `RequireTelemetryEnabled` or `RequireAiEnabled`:
                      the page reports on those capabilities while they are
                      off. */}
                  <Route
                    path="/admin/settings/doctor"
                    element={
                      <RequirePermission
                        permission="system_settings:read"
                        fallback={<Navigate to="/" replace />}
                      >
                        <DoctorPage />
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
                  {/* Issue #726 (PP-6.7). The `Organization` card's route:
                      `org_members:read`, the ORG permission
                      `org-members.controller.ts` enforces on
                      `GET /api/org/members` and the string the card declares.
                      Nested inside it, `RequireMultiOrg` redirects in a
                      single-org deployment, exactly as `RequireAiEnabled`
                      does while AI is off ("org management hidden"). */}
                  <Route
                    path="/admin/settings/organization"
                    element={
                      <RequirePermission
                        permission="org_members:read"
                        fallback={<Navigate to="/" replace />}
                      >
                        <RequireMultiOrg>
                          <OrganizationPage />
                        </RequireMultiOrg>
                      </RequirePermission>
                    }
                  />
                  {/* Issue #726. The `Organizations` card's route:
                      `organizations:read`, the SYSTEM permission
                      `organizations-admin.controller.ts` enforces, and the
                      same multi-org gate. */}
                  <Route
                    path="/admin/settings/organizations"
                    element={
                      <RequirePermission
                        permission="organizations:read"
                        fallback={<Navigate to="/" replace />}
                      >
                        <RequireMultiOrg>
                          <OrganizationsPage />
                        </RequireMultiOrg>
                      </RequirePermission>
                    }
                  />
                  {/* Issue #733 (PP-8.1). The `Organization settings` card's
                      route: `org_settings:read`, the ORG permission the
                      settings slice's `org-settings.controller.ts` enforces
                      on `GET /api/org-settings`, and the same multi-org gate.
                      Writes are gated inside the page (`org_settings:write`). */}
                  <Route
                    path="/admin/settings/organization-settings"
                    element={
                      <RequirePermission
                        permission="org_settings:read"
                        fallback={<Navigate to="/" replace />}
                      >
                        <RequireMultiOrg>
                          <OrgSettingsPage />
                        </RequireMultiOrg>
                      </RequirePermission>
                    }
                  />
                  {/* Issue #745. The `Setup guide` card's route:
                      `system_settings:read`, the permission under which
                      `@marinoscar/platform-api/onboarding` adds the admin
                      block to `GET /api/onboarding` and gates
                      `GET /api/admin/onboarding/metrics` (the packaged
                      descriptor `setupGuideSettingsPage.card`, written as
                      literals because the registry tests read this file). */}
                  <Route
                    path="/admin/settings/setup"
                    element={
                      <RequirePermission
                        permission="system_settings:read"
                        fallback={<Navigate to="/" replace />}
                      >
                        <SetupGuidePage />
                      </RequirePermission>
                    }
                  />
                  {/* Issue #745. Ungated like its `/settings/*` siblings:
                      the caller's own checklist (`user_settings:read`, which
                      every role holds). */}
                  <Route path="/settings/getting-started" element={<GettingStartedPage />} />
                  {/* Issue #744. Ungated like its `/settings/*` siblings:
                      the caller's own data (`user_settings:read`, which every
                      role holds); an org admin also sees `org-data`. */}
                  <Route path="/settings/data-export" element={<DataExportPage />} />
                  {/* Issue #746. The `Android app` card's route:
                      `system_settings:read`, the string
                      `GET /api/admin/android-app` enforces (the packaged
                      descriptor `androidAppSettingsPage.card`, written as
                      literals because the registry tests read this file).
                      Writes are gated inside the page. */}
                  <Route
                    path="/admin/settings/android"
                    element={
                      <RequirePermission
                        permission="system_settings:read"
                        fallback={<Navigate to="/" replace />}
                      >
                        <AndroidAppPage />
                      </RequirePermission>
                    }
                  />
                  {/* Issue #743. The user Danger Zone: ungated like its
                      `/settings/*` siblings (`user_settings:write`, which
                      every role holds) and with no feature gate, so it stays
                      reachable while AI is off. */}
                  <Route path="/settings/danger-zone" element={<DangerZonePage />} />
                  {/* Issue #743. The factory reset: `system:factory_reset`,
                      the exact SYSTEM permission the user-data slice's
                      factory reset controller enforces (Admin only). */}
                  <Route
                    path="/admin/settings/factory-reset"
                    element={
                      <RequirePermission permission="system:factory_reset" fallback={<Navigate to="/" replace />}>
                        <FactoryResetPage />
                      </RequirePermission>
                    }
                  />
                </Route>
              </Route>

              {/* Fallback */}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </MaintenanceGate>
      </ErrorBoundary>
      {/* The PWA prompts (#219, epic #215) sit here — inside `ThemeProvider`
          so they are themed, OUTSIDE both `ErrorBoundary` and `Routes`, and
          outside `Layout`.

          Outside `Routes` because they belong to the DOCUMENT, not to any
          page: `UpdatePrompt` owns the service-worker registration, which must
          happen on `/login` and `/activate` too (those sessions run on the same
          precached shell, and the worker is also what makes notifications
          possible on Android at all). Mounting them inside `Layout` would tie
          both to the authenticated shell and re-run registration on every
          route change into and out of it.

          Outside `ErrorBoundary` because a page that has crashed is precisely
          when "a new version is available" is most likely to be the fix — a
          prompt inside the boundary would be replaced by the fallback along
          with the page.

          NEITHER RENDERS ANYTHING in its default state (no waiting worker, no
          captured install event), so a normal page load is pixel-identical to
          one before this change. */}
      <UpdatePrompt />
      <InstallPrompt />
    </ThemeProvider>
  );
}

export default function App() {
  return (
    <ThemeContextProvider>
      {/* `client` is the app's one transport (its token holder and refresh);
          `onBeforeLogout` drops this device's push subscription while the
          access token is still valid (#365). The identity adapters wrap the
          whole route tree: the login and callback pages render outside the
          signed-in shell. */}
      <AuthProvider client={api} onBeforeLogout={removePushSubscription}>
        <IdentityWebAdaptersProvider adapters={appIdentityAdapters}>
          <AppRoutes />
        </IdentityWebAdaptersProvider>
      </AuthProvider>
    </ThemeContextProvider>
  );
}
