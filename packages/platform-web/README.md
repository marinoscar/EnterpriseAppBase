# @marinoscar/platform-web

The React side of the platform: pages, components and hooks built on MUI, exposed one subpath per slice. ESM with `sideEffects: false`; it loads in plain Node ESM as well as through a bundler.

## Purpose and scope

Pages, components, hooks and settings-page descriptors of the platform's web slices. It does not own the app's router or settings registries; the app binds the package's descriptors into its own. The app's theme is the app's: the shell slice offers one to build on (`createShellTheme`).

Status: pre-release (the current channel and how to install it: the [release runbook](../../docs/runbooks/release-platform-packages.md)). The root export is only the package name (`PLATFORM_PACKAGE`); the slices are subpath exports, each with its own README:

- `@marinoscar/platform-web/core`: the web host ports every packaged page reuses (`PlatformHostProvider`, `PlatformApiClient`, `PlatformViewer`, `PlatformSettingsPage`). [README](src/core/README.md).
- `@marinoscar/platform-web/testing`: test doubles for those ports (`createTestPlatformHost`). [README](src/testing/README.md).
- `@marinoscar/platform-web/doctor/headless` and `@marinoscar/platform-web/doctor/ui`: the admin Doctor page, its hook and client, and its settings-page descriptor (#696). [README](src/doctor/README.md).
- `@marinoscar/platform-web/telemetry/headless` and `@marinoscar/platform-web/telemetry/ui` (plus `/telemetry/ui/settings-page`, `/explorer-page`, `/dashboard-page`): the telemetry settings page, explorer and dashboard, their client, hooks, app adapters, admin cards and theme-token contract (#704). [README](src/telemetry/README.md).
- `@marinoscar/platform-web/identity/headless` and `@marinoscar/platform-web/identity/ui`: the auth context and route guards, the identity client and data hooks, the sign-in provider registry, and the login, callback, device-activation, Access Tokens, Users & Allowlist and organization pages with their registry entries (#727). [README](src/identity/README.md).
- `@marinoscar/platform-web/settings/headless` and `@marinoscar/platform-web/settings/ui`: `SettingsHub`, the section registry's types and helpers, the open feature registry (`registerSettingsFeature`) and the settings hooks (`useSystemSettings`, `useUserSettings`, `useOrgSettings`) (#733). [README](src/settings/README.md).
- `@marinoscar/platform-web/sharing/headless` and `@marinoscar/platform-web/sharing/ui`: the sharing hooks and client (groups, members, invites, grants, link grants, shared with me, the public link), the link-renderer registry, the share dialog, the group pages, the public `/s` page and the groups settings-page descriptor (#731). [README](src/sharing/README.md).
- `@marinoscar/platform-web/credentials/headless` and `@marinoscar/platform-web/credentials/ui`: the write-only secret field `SecretField` and its unified helper text `savedSecretHelperText` (#735). [README](src/credentials/README.md).
- `@marinoscar/platform-web/onboarding/headless` and `@marinoscar/platform-web/onboarding/ui`: `OnboardingProvider` and `useOnboarding`, the welcome dialog, the checklist, the Setup guide and Getting started pages, the Activation section, `FeatureUnavailableNotice` and its registry, and the "Getting started" menu item (#745). [README](src/onboarding/README.md).
- `@marinoscar/platform-web/email/headless` and `@marinoscar/platform-web/email/ui`: the email settings hook `useEmailSettings` and the `/admin/settings/email` page `EmailSettingsPage` (#737). [README](src/email/README.md).
- `@marinoscar/platform-web/jobs/headless` and `@marinoscar/platform-web/jobs/ui`: the job queue client, hooks and adapters, and the Jobs and Job Insights pages with their registry entries (#854); it re-exports the worker-fleet names of the nodes slice. [README](src/jobs/README.md).
- `@marinoscar/platform-web/nodes/headless` and `@marinoscar/platform-web/nodes/ui`: the worker-fleet and node-credential client, hooks and adapters, and the Worker Nodes page with its registry entry (#881). [README](src/nodes/README.md).
- `@marinoscar/platform-web/storage/headless` and `@marinoscar/platform-web/storage/ui`: the storage config hook `useStorageConfig`, the storage-config and objects clients, and the `/admin/settings/storage` page `StorageConfigPage` with its switch dialog (#736). [README](src/storage/README.md).
- `@marinoscar/platform-web/exports/headless` and `@marinoscar/platform-web/exports/ui`: the exports client and hooks (`useExportSources`, `useExports`, `useCreateExport`, `useExport` with polling), `ExportDialog` (fields from the source's descriptor, `slots.form`), `ExportsList`, `DataExportPage` and the "Download your data" card descriptor (#744). [README](src/exports/README.md).
- `@marinoscar/platform-web/ai/headless` and `@marinoscar/platform-web/ai/ui`: the organization's own AI keys and effective AI policy hooks (`useOrgAiKeys`, `useOrgAiPolicy`) and the Organization AI keys page `OrgAiKeysPage` (#739). [README](src/ai/README.md).
- `@marinoscar/platform-web/db-backup/headless` and `@marinoscar/platform-web/db-backup/ui`: the db-backup client `createDbBackupApi`, the hooks `useDbBackupConfig` / `useDbBackupRuns` / `useDbBackupActions`, and the `/admin/settings/db-backup` page `DbBackupPage` with its admin card `dbBackupAdminSections` (#740). [README](src/db-backup/README.md).
- `@marinoscar/platform-web/notifications/headless` and `@marinoscar/platform-web/notifications/ui`: the notification provider and hooks, the push subscription services, the service-worker helpers, the AppBar bell, the permission banner, the preferences matrix and the user, admin policy, Web Push and Broadcasts pages. [README](src/notifications/README.md).
- `@marinoscar/platform-web/android-app/headless` and `@marinoscar/platform-web/android-app/ui`: the Trusted Web Activity launch helpers, the Android client and hooks, the update banner and the admin Android app page. [README](src/android-app/README.md).
- `@marinoscar/platform-web/user-data/headless` and `@marinoscar/platform-web/user-data/ui`: the user Danger Zone page, the admin factory reset page, the organization offboarding dialog, the typed-confirmation dialog and the start-and-poll hook. [README](src/user-data/README.md).
- `@marinoscar/platform-web/shell/headless` and `@marinoscar/platform-web/shell/ui`: the app shell: `ShellLayout` (the five coupled breakpoint gates), `ShellAppBar`, `ShellNavigationRail` (with Console mode), `ShellBottomNav`, `ShellUserMenu`, the navigation model (`ShellNavigation`, `ShellDestination`), the rail's collapse preference, `createShellTheme` with `ShellThemeProvider` / `ShellRoot`, and `ShellProviders`, with slots for branding and navigation (#868). [README](src/shell/README.md).
- `@marinoscar/platform-web/host/headless` and `@marinoscar/platform-web/host/ui`: the About page, the admin Maintenance page and the public maintenance screen, with the maintenance recogniser and block store, `createHostApi` and the `useAbout`, `useMaintenance` and `useMaintenanceBlock` hooks (#891). [README](src/host/README.md).
- `@marinoscar/platform-web/datatable/headless`, `@marinoscar/platform-web/datatable/ui` and `@marinoscar/platform-web/datatable/testing`: the responsive `DataTable` (desktop grid, tablet expander, phone cards) with its filters, view bar, CSV export and bulk actions, the layout-preference port `DataTablePreferencesPort`, and the jsdom layout stubs and conformance suite (#897). [README](src/datatable/README.md).

## Install and peer dependencies

```bash
npm install @marinoscar/platform-web
```

Install these in the app; the package never bundles its own copy (a second copy breaks dependency injection, hooks or theme context).

| Package | Range |
|---|---|
| `@emotion/react` | `^11.14.0` |
| `@emotion/styled` | `^11.14.1` |
| `@mui/icons-material` | `^9.1.0` |
| `@mui/material` | `^9.1.0` |
| `react` | `^19.2.7` |
| `react-dom` | `^19.2.7` |
| `react-router-dom` | `^7.17.0` |

Optional peer `@mui/x-data-grid` `^9.10.1` is also needed by `@marinoscar/platform-web/datatable/ui` and, since the AI lists use it, by `@marinoscar/platform-web/ai/ui`. Optional peers, needed only by `@marinoscar/platform-web/telemetry/ui` (#704): `@mui/x-charts` `^9.14.0`, `@mui/x-data-grid` `^9.10.1`, `@uiw/react-codemirror` `^4.25.12` and `@codemirror/lang-sql` `^6.10.0`.

## Quick start

Mount the app's host once, inside the auth provider, then register each packaged page as a card and a route (the reference app: [`platformHost.tsx`](../../apps/web/src/platform/platformHost.tsx), [`adminSections.tsx`](../../apps/web/src/config/adminSections.tsx)):

```tsx
<PlatformHostProvider host={host}><Layout /></PlatformHostProvider>

// ADMIN_SECTIONS, appended last
{ ...doctorSettingsPage.card, Icon: doctorSettingsPage.Icon },
```

See the [core README](src/core/README.md#registering-a-packaged-page-settings-ui-pattern).

## Configuration

None at the package level. `PlatformHostProvider`'s host is documented in the [core README](src/core/README.md#configuration), `DoctorPage`'s props in the [doctor README](src/doctor/README.md#configuration).

## Extension-point catalog

None. The root export is only the package name; the extension points live in the slice catalogs ([core](src/core/README.md#extension-point-catalog), [doctor](src/doctor/README.md#extension-point-catalog)).

## Data

None. The browser holds no data model; it reads and writes through the API.

## Permissions and settings

The Doctor's card and route require `system_settings:read`, the exact string `@marinoscar/platform-api/doctor` enforces ([README](src/doctor/README.md#permissions-and-settings)). Packaged pages check no permission themselves: the app's route gate does.

## UI

One page so far: the Doctor (`/admin/settings/doctor`), one admin registry card, one slot (`slots.Header`), and the theme tokens `palette.status.*` ([README](src/doctor/README.md#ui)).

## Infra

None. The package ships no deployment configuration and reads no environment variable.

## Observability

None. No slice logs or measures anything in the browser yet.

## Security notes

Pages never hold an API key and never call an AI provider from the browser; they call the API only through the app's transport (`PlatformApiClient`), and authorization stays in the API and the app's route gates.

## Conformance suite

None yet. The package ships no conformance suite; `runPlatformConformance()` and the suites arrive with the platform's conformance harness.

## Upgrade notes

None. No version has been published yet, so there is nothing to migrate from.

## Troubleshooting

None yet. Build and import problems common to every platform package are in [DEVELOPMENT.md § Platform packages](../../docs/DEVELOPMENT.md#platform-packages).

## Links

- [Platform packages spec](../../docs/specs/platform-packages.md): the extension contract and the package documentation standard
- [Package documentation standard and checks](../../docs/PACKAGES.md): how this README, the TSDoc and the catalog are checked
- [DEVELOPMENT.md § Platform packages](../../docs/DEVELOPMENT.md#platform-packages): build, test and lint commands
