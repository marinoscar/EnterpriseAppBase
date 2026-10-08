# @marinoscar/platform-web

The React side of the platform: pages, components and hooks built on MUI, exposed one subpath per slice. ESM with `sideEffects: false`; it loads in plain Node ESM as well as through a bundler.

## Purpose and scope

Pages, components, hooks and settings-page descriptors of the platform's web slices. It does not own the app's router, theme or settings registries; the app binds the package's descriptors into its own.

Status: pre-release (version `0.0.0`). The root export is only the package name (`PLATFORM_PACKAGE`); the slices are subpath exports, each with its own README:

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
- `@marinoscar/platform-web/jobs/headless` and `@marinoscar/platform-web/jobs/ui`: the job queue and worker-fleet client, hooks and adapters, and the Jobs, Job Insights and Worker Nodes pages with their registry entries (#854). [README](src/jobs/README.md).
- `@marinoscar/platform-web/storage/headless` and `@marinoscar/platform-web/storage/ui`: the storage config hook `useStorageConfig`, the storage-config and objects clients, and the `/admin/settings/storage` page `StorageConfigPage` with its switch dialog (#736). [README](src/storage/README.md).
- `@marinoscar/platform-web/exports/headless` and `@marinoscar/platform-web/exports/ui`: the exports client and hooks (`useExportSources`, `useExports`, `useCreateExport`, `useExport` with polling), `ExportDialog` (fields from the source's descriptor, `slots.form`), `ExportsList`, `DataExportPage` and the "Download your data" card descriptor (#744). [README](src/exports/README.md).

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

Optional peers, needed only by `@marinoscar/platform-web/telemetry/ui` (#704): `@mui/x-charts` `^9.14.0`, `@mui/x-data-grid` `^9.10.1`, `@uiw/react-codemirror` `^4.25.12` and `@codemirror/lang-sql` `^6.10.0`.

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
