# @marinoscar/platform-web/android-app

The web half of the Android companion (issue #746, PP-9.4), merged from EvoPath's and MemoriaHub's `apps/web`: the Trusted Web Activity (TWA) launch helpers, the API client and hooks, the shared Android identity, the admin **Android app** page (trusted apps, releases, test notification), the update banner and the packaged settings-page descriptor. Two entry points: `@marinoscar/platform-web/android-app/headless` (no component) and `@marinoscar/platform-web/android-app/ui` (MUI). It depends on `core` of this package (`packages/platform-slices.json`) and on `@marinoscar/platform-contract/android-app`.

## Purpose and scope

The PWA stays the product; inside the Android app it runs in a TWA. The web needs to know when it runs there (to offer an update or a deep link into a native screen) and to give administrators one page for the trust list and the APKs.

| Part | Entry | What it is |
|---|---|---|
| TWA helpers | `/headless` (`twa.ts`) | `captureTwaLaunch` (once, at startup), `isRunningInTwa` (the saved flag or an `android-app://` referrer), `getInstalledAppVersion` |
| Identity | `/headless` (`identity.ts`) | `androidIdentity(identity)`: the same derivation as the API, the CLI and the Gradle build |
| Client and hooks | `/headless` (`client.ts`, `hooks.ts`) | `createAndroidAppClient(api)`, `useAndroidRelease(enabled)`, `useAndroidAppConfig()`, `useAndroidAppClient()` |
| Admin page | `/ui` (`AndroidAppPage.tsx`, `settings-page.ts`) | `AndroidAppPage` and `androidAppSettingsPage` (`/admin/settings/android`, `system_settings:read`) |
| Banner | `/ui` (`AndroidUpdateBanner.tsx`, `DownloadApkButton.tsx`) | "Android app X is available", only inside the TWA when a newer `versionCode` exists |

Not here: the routes and the trust rules (`@marinoscar/platform-api/android-app`), the Android app itself (`@marinoscar/platform-infra/android/platform-core` and the app's shell), any JavaScript-to-Kotlin bridge (there is none, by design).

## Install and peer dependencies

Ships inside `@marinoscar/platform-web`; import it by its subpaths:

```ts
import { captureTwaLaunch, useAndroidRelease } from '@marinoscar/platform-web/android-app/headless';
import { AndroidAppPage, AndroidUpdateBanner, androidAppSettingsPage } from '@marinoscar/platform-web/android-app/ui';
```

The package's peers: `react`, `react-dom`, `react-router-dom`, `@mui/material`, `@mui/icons-material`. The app mounts `PlatformHostProvider` (the transport, the viewer's permissions); the upload needs a transport with `postFormData` (`PlatformHttpClient` has it).

## Quick start

The reference app ([`main.tsx`](../../../../apps/web/src/main.tsx), [`Layout.tsx`](../../../../apps/web/src/components/common/Layout.tsx), [`adminSections.tsx`](../../../../apps/web/src/config/adminSections.tsx), [`App.tsx`](../../../../apps/web/src/App.tsx)):

```tsx
captureTwaLaunch(undefined, ANDROID_TWA_KEY_PREFIX);                       // main.tsx, before the router
<AndroidUpdateBanner keyPrefix={ANDROID_TWA_KEY_PREFIX} />                 // Layout, above <Outlet />
{ ...androidAppSettingsPage.card, Icon: androidAppSettingsPage.Icon },    // ADMIN_SECTIONS, General
<Route path="/admin/settings/android" element={<RequirePermission permission="system_settings:read"><AndroidAppPage /></RequirePermission>} />
```

## Configuration

| Option | Where | Default | Meaning |
|---|---|---|---|
| `prefix` | `captureTwaLaunch(search?, prefix?)`, `isRunningInTwa(prefix?)`, `getInstalledAppVersion(prefix?)` | `android` | The `sessionStorage` key prefix; the reference app passes the identity's `storagePrefix` |
| `keyPrefix` | `AndroidUpdateBanner` | `android` | The same prefix (the dismissal key lives in `localStorage` under it) |
| `detailsPath` | `AndroidUpdateBanner` | none | A "Details" button target; none by default, because the admin page needs `system_settings:read` |

No environment variable.

## Extension-point catalog

The extension ladder and a recipe per extension: [docs/EXTENDING.md](../../../../docs/EXTENDING.md).

| Name | Kind | Signature | When to use | Stability | Example |
|---|---|---|---|---|---|
| `captureTwaLaunch` | hook | `captureTwaLaunch(search?: string, prefix?: string): void` | Remember a TWA launch and the installed build once, before the router drops the query string | experimental | [example](../../../../apps/web/src/main.tsx) |
| `androidIdentity` | hook | `androidIdentity(identity: AndroidIdentitySource): AndroidIdentity` | Derive the application id, deep-link scheme, storage prefix and APK stem from `identity.json` (and its `android` block) | experimental | [example](../../../../apps/web/src/config/androidApp.ts) |
| `createAndroidAppClient` | hook | `createAndroidAppClient(api: AndroidAppTransport): AndroidAppClient` | Call the android-app API from an app's own component | experimental | [example](../../../../apps/web/src/__tests__/android/androidApp.test.tsx) |
| `useAndroidRelease` | hook | `useAndroidRelease(enabled?: boolean): UseAndroidReleaseReturn` | Read the current release (an app's own update prompt) | experimental | [example](../../../../apps/web/src/__tests__/android/androidApp.test.tsx) |
| `AndroidAppPage` | component | `AndroidAppPage(): ReactElement` | The admin page, routed behind `system_settings:read` | experimental | [example](../../../../apps/web/src/App.tsx) |
| `AndroidUpdateBanner` | component | `AndroidUpdateBanner(props?: AndroidUpdateBannerProps): ReactElement \| null` | The in-TWA update notice, mounted once in the layout | experimental | [example](../../../../apps/web/src/components/common/Layout.tsx) |
| `androidAppSettingsPage` | component | `PlatformSettingsPage<never>` | The admin card descriptor, appended to the app's registry | experimental | [example](../../../../apps/web/src/config/adminSections.tsx) |

Supporting exports (experimental): `DEFAULT_TWA_KEY_PREFIX`, `twaSessionKeys`, `isRunningInTwa`, `getInstalledAppVersion`, `InstalledAppVersion`; `AndroidAppClient`, `AndroidAppTransport`, `AndroidReleaseUploadInput`, `useAndroidAppClient`, `useAndroidAppConfig` and the hooks' return types; the contract types re-exported by `/headless`; `DownloadApkButton`; the copy constants (`ANDROID_APP_PATH`, `ANDROID_APP_TITLE`, `ANDROID_APP_DESCRIPTION`, `ANDROID_APP_READ_ONLY_MESSAGE`, `ANDROID_APP_READ_PERMISSION`, `ANDROID_APP_WRITE_PERMISSION`, `ANDROID_PACKAGE_ERROR`, `ANDROID_SHA_ERROR`).

## Data

None. The page reads and writes through `/api/admin/android-app*` and `/api/android-app/*`; the browser keeps only the TWA launch flags (`sessionStorage`) and the banner's dismissed `versionCode` (`localStorage`).

## Permissions and settings

The card and the route gate on `system_settings:read`, the exact string `GET /api/admin/android-app` enforces (Settings UI Pattern rule 3). Every write control (trust, remove, upload, make current, delete, test notification) is disabled without `system_settings:write`; the API enforces it either way. The banner and `useAndroidRelease` need only a signed-in user. No settings namespace.

## UI

- **`AndroidAppPage`** (`/admin/settings/android`): three sections. *Trusted apps*: the list (remove), an add form that normalises the fingerprint (64 hex digits or colon pairs, either case), the pairs paired devices report with a one-click Trust, and the `assetlinks.json` preview. *Releases*: newest first with the current one marked, download, make current, delete (not the current one), and an upload form (fields first, then the APK; Make current; Trust a new signing key). *Notifications*: push subscription counts and "Send me a test notification", with the server's reason when nothing was sent.
- **`AndroidUpdateBanner`**: an info `Alert` with a download button, dismissible per `versionCode`. Renders nothing, and requests nothing, outside the TWA, so it never appears in the visual baselines.
- **`DownloadApkButton`**: asks for the signed link and navigates to it, so the browser or the Android installer downloads natively.

The card joins the admin hub's General group; the hub's visual baselines change once (regenerated by the orchestrating CI job).

## Infra

None. The edge locations (assetlinks, the 160m upload, the unbuffered download) are the `@marinoscar/platform-infra` snippet `nginx/platform/android-app.conf`.

## Observability

None client-side. The API logs and audits every action.

## Security notes

- **Presentation only.** `isRunningInTwa` and the installed version decide what to OFFER; they grant nothing, and the server never trusts them.
- **No bridge.** Nothing here calls into native code; the TWA and the native module meet through the server.
- **Download links are capabilities.** The button never shows, stores or logs the URL; it navigates to it once.
- Storage access is wrapped: blocked storage falls back to the `android-app://` referrer and to an undismissable-for-now banner.

## Conformance suite

None. `test/android-app/android-app.test.tsx` covers the TWA helpers, the banner (only in the TWA, only when newer, dismissal remembered) and the page (trust with normalisation, refusal before the API call, read-only without `:write`, the test notification's reason); the reference app's registry tests pin the card's permission to the controller.

## Upgrade notes

New in #746. From EvoPath's `utils/twa.ts`, `utils/androidIdentity.ts`, `pages/Admin/AndroidAppPage.tsx` and `components/common/AndroidUpdateBanner.tsx` (and MemoriaHub's twins): the storage keys take an explicit prefix (pass the identity's `storagePrefix`, or the old `APP_SLUG`, to keep a session's flags across the upgrade); the banner's "Details" link is opt-in (`detailsPath`); `sizeBytes` is a string.

## Troubleshooting

- **The banner never shows in the app.** The launch URL carries no `appVersionCode` (an old build), or `captureTwaLaunch` runs after the router dropped the query string (call it in `main.tsx`, before rendering).
- **Upload says the transport cannot send multipart.** Pass the app's `PlatformHttpClient` (it has `postFormData`) to `PlatformHostProvider`.
- **The card is missing.** The viewer lacks `system_settings:read`.

## Links

- [Package README](../../README.md), [API slice](../../../platform-api/src/android-app/README.md), [contract](../../../platform-contract/src/android-app/README.md)
- [Native companion architecture spec](../../../../docs/specs/native-companion-architecture.md), [Settings UI spec](../../../../docs/specs/settings-ui.md)
- Runbooks: [Android app](../../../../docs/runbooks/android-app.md), [Android release](../../../../docs/runbooks/android-release.md)
