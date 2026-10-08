# @marinoscar/platform-api/android-app

The server half of the Android companion (issue #746, PP-9.4), merged from EvoPath's and MemoriaHub's `apps/api/src/android-app/` (23 files each, 0 identical): the trusted Android apps and the public Digital Asset Links route, the hosted APK releases (streamed upload, list, make current, delete, latest, signed download links), the Android test notification, the provider of the `android_app` notification sender, the `android.assetlinks` and `android.releases` doctor checks, and the **device-source registry** that replaces both apps' group-by over a domain device table. It depends on `core`, `doctor`, `identity`, `settings`, `storage`, `notifications` and `testing` of this package (`packages/platform-slices.json`), and on `@marinoscar/platform-contract/android-app` for the wire shapes. The conformance suite is the nested subpath `@marinoscar/platform-api/android-app/testing`, catalogued here.

## Purpose and scope

An app ships an Android app built as a Trusted Web Activity (TWA) around its PWA plus at most one native module. The server has to (1) tell Chrome which signed apps may open the site full screen, (2) host the APK and offer updates, (3) push to the phone, and (4) show the administrator what paired devices actually run. Everything domain-specific (Health Connect sync, media sync, their device tables) stays in the app and plugs in through `registerAndroidDeviceSource`.

| Part | Source | What it is |
|---|---|---|
| Module | `android-app.module.ts`, `android-app.options.ts` | `AndroidAppModule.forRoot({ appName, apkStem })`: the four controllers, the services, the `android_app` sender, the doctor checks |
| Trusted apps | `android-app.service.ts`, `trusted-apps-validation.pipe.ts`, `asset-links.controller.ts` | The `android_app` `system_settings` row (through `SystemSettingsRowStore`), MemoriaHub's fingerprint normalisation and typed refusal reasons, the public `assetlinks.json` |
| Device sources | `device-sources.ts` | `registerAndroidDeviceSource`, `mergeReportedApps` |
| Releases | `releases/` | `ApkInspector` (ZIP signature, size ceiling, SHA-256, streaming), `download-token.ts` (HMAC, ten minutes), `AndroidReleaseService`, the admin and user controllers |
| Push | `android-app-push.service.ts` | `POST /api/admin/android-app/test-notification` |
| Storage | `android-app.key-prefixes.ts` | The `android-releases/` prefix, `survivesFactoryReset: true` |
| Doctor | `doctor/` | `android.assetlinks`, `android.releases` (read-only) |
| Test seams | `testing/` | The `android-app` conformance suite |

Not here: the `android_app` channel definition and its sender class (`@marinoscar/platform-api/notifications`), the admin page and the TWA helpers (`@marinoscar/platform-web/android-app`), the CLI group (`@marinoscar/platform-cli/android`), the Kotlin module (`@marinoscar/platform-infra/android/platform-core`), the nginx snippet (`@marinoscar/platform-infra`).

## Install and peer dependencies

Ships inside `@marinoscar/platform-api`; import it by its subpath:

```ts
import { AndroidAppModule, registerAndroidDeviceSource } from '@marinoscar/platform-api/android-app';
```

Beyond the package's peers, the slice needs from the app: core's `PlatformHostModule` (`PLATFORM_PRISMA`, `AUDIT_SINK`), `SettingsModule.forRoot()`, the global doctor and notifications modules, the storage configuration (`StorageProvidersModule` is imported by the slice), `@fastify/multipart` registered on the Fastify instance (the upload uses `request.parts()`), the composed `android-app` fragment of `@marinoscar/platform-db` (and `push_subscriptions.platform` of the notifications fragment), and `SECRETS_ENCRYPTION_KEY` (the download-link signing sub-key).

## Quick start

The reference app's binding ([`android-app.config.ts`](../../../../apps/api/src/platform/android-app/android-app.config.ts)):

```ts
import { ANDROID_IDENTITY_SOURCE, APP_NAME } from '@app/shared';
import { androidIdentity } from '@marinoscar/platform-contract/android-app';

registerAndroidAppNotificationChannel();          // in the notification manifest
registerAndroidAppKeyPrefixes();                  // in the storage key-prefix manifest
registerAndroidDeviceSource(EMPTY_DEVICE_SOURCE); // a native capability registers its own
export const androidAppModule = AndroidAppModule.forRoot({
  appName: APP_NAME,
  apkStem: androidIdentity(ANDROID_IDENTITY_SOURCE).apkStem,
});
```

## Configuration

`AndroidAppModule.forRoot(options)`:

| Option | Type | Default | Meaning |
|---|---|---|---|
| `appName` | `string` | required | The product name, in the test notification's title |
| `apkStem` | `string` | required | The download's file-name stem, `<apkStem>-<versionName>.apk` (lower kebab case); the identity's `android.apkStem` |
| `testNotificationLink` | `string` | `/` | Where tapping the test notification lands (root-relative) |
| `imports` | `AndroidAppImport[]` | `[]` | Extra modules the app binds |

No environment variable. The trusted list is runtime data (`/admin/settings/android`), storage is configured at `/admin/settings/storage`, Web Push (VAPID) at `/admin/settings/push`.

## Extension-point catalog

| Name | Kind | Signature | When to use | Stability | Example |
|---|---|---|---|---|---|
| `AndroidAppModule.forRoot` | option | `forRoot(options: AndroidAppModuleOptions): DynamicModule` | Mount the slice once, with the product name and the APK stem | experimental | [example](../../../../apps/api/src/platform/android-app/android-app.config.ts) |
| `registerAndroidDeviceSource` | registry | `registerAndroidDeviceSource(source: AndroidDeviceSource): void` | A native capability reports the (package, signing key) pairs its paired devices run, for the admin page and the doctor | experimental | [example](../../../../apps/api/src/examples/android-app/empty-device-source.ts) |

Supporting exports (experimental): `ANDROID_APP_OPTIONS`, `resolveAndroidAppModuleOptions`; `androidDeviceSourceRegistry`, `mergeReportedApps`; `ANDROID_RELEASES_KEY_PREFIX_DEF`, `registerAndroidAppKeyPrefixes`, `androidReleaseKey`; the services (`AndroidAppService`, `AndroidReleaseService`, `AndroidAppPushService`) and their helpers (`buildAssetLinks`, `toPublicRelease`, `toAdminRelease`, `versionRuleRefusal`, `toClientUploadError`, `toResultRow`); `ApkInspector`, `ZIP_MAGIC`; the token functions (`signDownloadToken`, `verifyDownloadToken`, `downloadTokenKey`, `DOWNLOAD_TOKEN_KEY_PURPOSE`); `TrustedAppsValidationPipe`, `reasonForIssue`; the controllers and DTOs; the doctor checks and their pure verdicts; the audit action constants; the structural data types and `isUniqueViolation`.

**A device source** ([example](../../../../apps/api/src/examples/android-app/empty-device-source.ts)):

```ts
registerAndroidDeviceSource({
  id: 'health-sync',
  reportedApps: () => prisma.healthSyncDevice.groupBy(...).then(toRows), // (packageName, signingSha256, deviceCount, lastSeenAt)
  devicesBehind: (pkg, code) => prisma.healthSyncDevice.count({ where: { status: 'active', packageName: pkg, appVersionCode: { lt: code } } }),
});
```

Rows of every source are merged by `trustedAppKey(packageName, normalizeSha256Fingerprint(sha))`, sorted by device count (descending), package name, fingerprint; untrusted pairs stay listed so an administrator can trust them. A failing source is logged and skipped. A source is read-only.

## Data

- `android_app_releases` (`AndroidAppRelease`, the `android-app` fragment; platform migration `0033_add_android_app`): `@@unique([packageName, versionCode])`, `sizeBytes BigInt` (returned as a decimal string), `storage_provider` and `bucket` (where the bytes went), uploader `SetNull`.
- **`android_app_releases_one_current_uniq_idx`**: a raw-SQL partial unique index (`((true)) WHERE is_current`), listed in `raw-sql-indexes.json` of `@marinoscar/platform-db`. Intentional schema drift: never `@@unique`, never a `findFirst` pre-check. Make-current clears and sets in one transaction; the index arbitrates concurrent calls and the loser's P2002 is a 409 `RELEASE_CURRENT_CONFLICT`.
- The trusted list: the `android_app` row of `system_settings` (`{ trustedApps: [{ packageName, sha256 }] }`), written through `SystemSettingsRowStore` (audited `android_app.trusted_apps.updated`).
- Objects: `android-releases/<releaseId>.apk`, the `android-releases` key prefix (`survivesFactoryReset: true`).
- Reads `users` (the download's user must be active) and `push_subscriptions` (counts, the test notification).

## Permissions and settings

| Route | Guard |
|---|---|
| `GET /api/admin/android-app` | `system_settings:read` |
| `PUT /api/admin/android-app`, `POST /api/admin/android-app/test-notification` | `system_settings:write` |
| `GET /api/admin/android-app/releases` | `system_settings:read` |
| `POST /api/admin/android-app/releases`, `POST .../releases/:id/make-current`, `DELETE .../releases/:id` | `system_settings:write` |
| `GET /api/android-app/releases/latest`, `POST /api/android-app/releases/:id/download-link` | `@Auth()` (any signed-in user) |
| `GET /api/android-app/download/:token` | `@Public()`: the signed token is the credential |
| `GET /api/well-known/assetlinks.json` | `@Public()`, `@AllowDuringMaintenance()`, deliberately |

Both apps' choice of `system_settings:*` is kept, so the admin card declares exactly `system_settings:read` (Settings UI Pattern rule 3). No new permission, no settings namespace.

## UI

None in this slice. The admin page (`/admin/settings/android`) and the update banner are `@marinoscar/platform-web/android-app`.

## Infra

The edge proxy must map `/.well-known/assetlinks.json` to `/api/well-known/assetlinks.json`: the snippet `nginx/snippets/android-assetlinks.conf` of `@marinoscar/platform-infra`, included by the app's nginx overlay. `@fastify/multipart` must allow a 150 MiB file on the upload route (the slice passes its own `limits`).

## Observability

Logs: every upload, make-current and delete (ids and versions, never a token or URL), each trusted-apps save (count), each test notification (counts per outcome), a failing device source (`warn`). Audit events: `android_app.trusted_apps.updated`, `android_app.release.uploaded`, `android_app.release.made_current`, `android_app.release.deleted`, `android_app.test_notification.sent` (hosts only). Doctor: `android.assetlinks`, `android.releases` (category `android`).

## Security notes

- **No bridge.** Nothing here (or in the Kotlin module) exposes a JavaScript interface: a bridge would turn an XSS into native code execution. The TWA and the native module meet only through the server and the launch URL.
- **assetlinks is public by design** (Chrome and the verifier fetch it unauthenticated) and read-only; it discloses only package names and certificate fingerprints, which every installed APK carries anyway.
- **The trust list is the gate.** An upload whose (package, signing key) pair is not trusted is refused (`RELEASE_UNTRUSTED_APP`) once the list is non-empty, unless the uploader sends `trust=true`; making a release current trusts its key (both apps' rule).
- **Download links are signed, bound and short-lived:** HMAC-SHA256 under `deriveSigningKey('android-app-download')` (a sub-key of `SECRETS_ENCRYPTION_KEY`, no new environment variable), bound to the release and the requesting user, ten minutes, and refused for a deactivated user. Changing the purpose label or rotating the master key invalidates links in flight, which is acceptable. Never log a token or a URL.
- **Never buffered.** The APK streams through `ApkInspector` into storage; a refusal deletes the stored bytes. Delete removes the object before the row.
- **Push endpoints are capability URLs:** the test notification returns and audits the host only.

## Conformance suite

Importing `@marinoscar/platform-api/android-app/testing` registers the `android-app` suite with `runPlatformConformance()`:

```ts
import { RAW_SQL_INDEXES } from '@marinoscar/platform-db';
import '@marinoscar/platform-api/android-app/testing';
runPlatformConformance({ sourceRoots: [API_SOURCE_ROOT], suites: { 'android-app': { rawSqlIndexNames: RAW_SQL_INDEXES.map((i) => i.name) } } });
```

| Case | Fails when |
|---|---|
| `routes` | assetlinks is not a public GET, another route is public, an admin route does not require exactly `system_settings:read` (GET) or `system_settings:write`, or a user route requires an admin permission |
| `data` | `android_app_releases_one_current_uniq_idx` is not on the raw-SQL index list |
| `storage` | `android-releases/` is not registered, or does not survive the factory reset |
| `notifications` | the `android_app` channel is not registered covered by `push` |

## Upgrade notes

New subpath in this version. From EvoPath's `apps/api/src/android-app/`: storage resolves through the storage slice (`503 STORAGE_NOT_CONFIGURED` instead of `STORAGE_PROVIDER` environment checks); `size_bytes` becomes `BIGINT` (an expand-only data migration at adoption) and is a string on the wire; fingerprints also accept 64 bare hex digits (stored values unchanged); reported apps come from `registerAndroidDeviceSource(healthSyncDevices)`; a new signing key needs `trust=true` once the list is non-empty. From MemoriaHub's: the test notification, the push counts and the two doctor checks are new; reported apps come from `registerAndroidDeviceSource(mediaSyncDevices)`; `storageProvider`/`bucket` are informational (the active storage serves downloads).

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| The TWA shows a URL bar | The installed app's (package, signing key) is not trusted, or nginx does not map `/.well-known/assetlinks.json` | Trust it on `/admin/settings/android` (the doctor's `android.assetlinks` names it); include the nginx snippet |
| Upload `503 STORAGE_NOT_CONFIGURED` | No usable storage configuration | Configure `/admin/settings/storage` |
| Upload `409 RELEASE_UNTRUSTED_APP` | A new package or signing key | Trust it first, or upload with `trust=true` (`android publish --trust`) |
| Upload `409 RELEASE_VERSION_NOT_NEWER` | Making it current would not raise `versionCode` | Bump `versionCode`, upload with `makeCurrent=false`, or `force=true` |
| Make-current `409 RELEASE_CURRENT_CONFLICT` | Two administrators at once | Reload; the other call won |
| Download `410 DOWNLOAD_LINK_EXPIRED` | Older than ten minutes | Request a new link |
| Reported apps empty | No device source registered (a plain TWA) | Expected; a native capability registers one |

## Links

- [Package README](../../README.md)
- [Contract](../../../platform-contract/src/android-app/README.md), [web counterpart](../../../platform-web/src/android-app/README.md), [notifications slice (the `android_app` channel)](../notifications/README.md), [storage slice](../storage/README.md)
- [Native companion architecture spec](../../../../docs/specs/native-companion-architecture.md)
- Runbooks: [Android app](../../../../docs/runbooks/android-app.md), [Android release](../../../../docs/runbooks/android-release.md)
- [Platform packages spec](../../../../docs/specs/platform-packages.md), [Package documentation standard](../../../../docs/PACKAGES.md)
