# @marinoscar/platform-contract/android-app

The wire shapes of the Android companion slice (issue #746, PP-9.4, merged from EvoPath and MemoriaHub): the trusted Android apps and the Digital Asset Links statements, the hosted APK releases and their signed download links, and the Android test notification, as zod schemas plus inferred types and zod-free constants. `@marinoscar/platform-api/android-app` wraps them as DTOs (so the OpenAPI document is generated from them); `@marinoscar/platform-web/android-app` and `@marinoscar/platform-cli/android` take the types and constants. It depends on no other slice (`packages/platform-slices.json`).

## Purpose and scope

One source for what the `android-app` routes accept and return, and for the two rules every client must apply the same way: `normalizeSha256Fingerprint` (64 bare hex digits or colon pairs, either case, stored upper-case colon pairs) and `trustedAppKey` (the merge key of a package and a fingerprint).

Layout: `constants.ts` (zod-free: the settings key, routes and paths, limits, patterns, the typed refusal reasons, the TWA launch flags, the fingerprint normaliser), `schemas.ts` and `index.ts`.

The push subscription `platform` field (`PUSH_SUBSCRIPTION_PLATFORMS`) and the `android_app` channel id live in `@marinoscar/platform-contract/notifications`, beside the subscribe body they extend.

Not here: the routes, the APK inspector and the download tokens (`@marinoscar/platform-api/android-app`), the admin page and the TWA helpers (`@marinoscar/platform-web/android-app`).

## Install and peer dependencies

Ships inside `@marinoscar/platform-contract`; import it by its subpath:

```ts
import { normalizeSha256Fingerprint, updateAndroidAppSchema } from '@marinoscar/platform-contract/android-app';
import type { AndroidAppResponse, PublicRelease } from '@marinoscar/platform-contract/android-app';
```

None beyond the package's own peer, `zod` (`^4.4.3`). A browser that imports only the constants and the types never bundles `zod`.

## Quick start

The web slice types its client with the responses ([`apps/web/src/App.tsx`](../../../../apps/web/src/App.tsx) mounts the admin page that reads them):

```ts
import type { AndroidAppResponse } from '@marinoscar/platform-contract/android-app';
const view: AndroidAppResponse = await api.get('/admin/android-app');
```

## Configuration

None. Schemas and constants take no options.

## Extension-point catalog

None. The contract declares shapes; the seams (the device-source registry, the `android_app` channel) are in `@marinoscar/platform-api/android-app` and `@marinoscar/platform-api/notifications`.

The extension ladder and a recipe per extension: [docs/EXTENDING.md](../../../../docs/EXTENDING.md).

Supporting exports (experimental): the constants `ANDROID_APP_SETTINGS_KEY`, `ANDROID_APP_SETTINGS_PATH`, `ANDROID_APP_ADMIN_PATH`, `ASSET_LINKS_API_PATH`, `ASSET_LINKS_CACHE_CONTROL`, `ASSET_LINKS_RELATION`, `MAX_TRUSTED_ANDROID_APPS`, `ANDROID_PACKAGE_NAME_PATTERN`, `SHA256_FINGERPRINT_PATTERN`, `TRUSTED_APPS_ERROR_REASONS`, `ANDROID_RELEASES_KEY_PREFIX`, `MAX_APK_BYTES`, `MIN_VERSION_CODE`, `MAX_VERSION_CODE`, `MAX_VERSION_NAME_LENGTH`, `MAX_RELEASE_NOTES_LENGTH`, `VERSION_NAME_PATTERN`, `APK_MIME_TYPE`, `APK_FILE_FIELD`, `DOWNLOAD_LINK_TTL_SECONDS`, `DOWNLOAD_ROUTE_PREFIX`, `ANDROID_RELEASE_REASONS`, `ANDROID_APP_TEST_REASONS`, `ANDROID_APP_TEST_STATUSES`, `TWA_LAUNCH_PARAMS`; the helpers `normalizeSha256Fingerprint`, `trustedAppKey`, `dedupeTrustedApps`; the schemas `androidPackageNameSchema`, `sha256FingerprintSchema`, `trustedAndroidAppSchema`, `trustedAndroidAppsSchema`, `androidAppSettingsValueSchema`, `updateAndroidAppSchema`, `reportedAndroidAppSchema`, `assetLinkStatementSchema`, `androidPushSubscriptionCountsSchema`, `androidAppResponseSchema`, `releaseUploadFieldsSchema`, `publicReleaseSchema`, `adminReleaseSchema`, `downloadLinkSchema`, `androidAppTestNotificationRequestSchema`, `androidAppTestResultRowSchema`, `androidAppTestNotificationResponseSchema`, and their types.

## Data

None. The contract owns no table. The shapes mirror `android_app_releases` (the `android-app` fragment of `@marinoscar/platform-db`) and the `android_app` row of `system_settings`. `sizeBytes` is a decimal string because the column is `BigInt`.

## Permissions and settings

Declares none. The trusted list is the stored value of the `android_app` `system_settings` row (`androidAppSettingsValueSchema`); the API gates it with `system_settings:read` / `system_settings:write`.

## UI

None. Types only.

## Infra

None.

## Observability

None.

## Security notes

- A download link (`downloadLinkSchema.url`) is a bearer capability for ten minutes: never log it.
- The test notification result carries the push service host only (`endpointHost`), never the endpoint, which is a capability URL.
- The upload fields are `.strict()`: an unknown field is refused instead of ignored. `trust` defaults to `false`, so a new signing key is never trusted by accident.

## Conformance suite

None. `test/android-app.test.ts` pins the schemas (including that EvoPath's stored fingerprint format reads back unchanged) and `test/no-zod-in-constants.test.ts` keeps the constants zod-free.

## Upgrade notes

New in #746. From EvoPath: fingerprints are now also accepted as 64 bare hex digits (stored values unchanged); `sizeBytes` is a string; the upload gains `trust`. From MemoriaHub: `pushSubscriptions` joins the admin view; `adminReleaseSchema` adds `storageProvider`.

## Troubleshooting

- **A trusted-apps PUT answers 400.** `details.reason` names the first problem (`TOO_MANY_TRUSTED_APPS`, `INVALID_PACKAGE_NAME`, `INVALID_FINGERPRINT`, otherwise `INVALID_TRUSTED_APPS`); `details.issues` lists every one.
- **`sizeBytes` compared as a number.** It is a string; use `BigInt(sizeBytes)` or `Number(sizeBytes)` (exact below 2^53).

## Links

- API: [`@marinoscar/platform-api/android-app`](../../../platform-api/src/android-app/README.md). Web: [`@marinoscar/platform-web/android-app`](../../../platform-web/src/android-app/README.md).
- Spec: [native-companion-architecture.md](../../../../docs/specs/native-companion-architecture.md), [platform-packages.md](../../../../docs/specs/platform-packages.md).
