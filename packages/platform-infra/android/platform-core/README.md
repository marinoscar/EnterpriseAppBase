# @marinoscar/platform-infra/android/platform-core

The platform's Android library module (`:platform-core`, Kotlin package `io.github.marinoscar.platform.android.core`): the Trusted Web Activity launcher, server configuration, the device-flow pairing, encrypted token storage, the JSON API client, app updates from the server's APK releases and notification-permission rules, shared by every platform Android app. It ships as plain Gradle files inside `@marinoscar/platform-infra`, so no Maven registry is involved; the app's `settings.gradle.kts` includes it from `node_modules`. Design: [native companion architecture](../../../../docs/specs/native-companion-architecture.md).

## Purpose and scope

What the module owns, merged from EvoPath's and MemoriaHub's apps:

| Package | Contents |
|---|---|
| `twa` | `TwaLauncher`, the base launcher activity (a `LauncherActivity` of androidbrowserhelper) |
| `config` | `ServerUrls` (https origin rules, the launch URL), `ServerConfig` (the saved server, `<storagePrefix>_config`) |
| `pairing` | `DeviceFlowTransport`, `DeviceFlowPoller` (RFC 8628), `PairingManager`, the `PairingHook` seam, `TokenRevoker`, `DeviceInfo` |
| `auth` | `TokenStore` (`EncryptedTokenStore` in `<storagePrefix>_secure`), `AuthFailures` (the `401` and `409 DEVICE_REVOKED` rules) |
| `net` | `ApiClient` (envelope unwrapping, error parsing, no secret in a log line), `ApiResult`, `ApiError` |
| `update` | `UpdateChecker`, `UpdatePolicy`, `BackgroundUpdateCheck`, `AppUpdates.download` (`/api/android-app/releases/latest`, then a signed link) |
| `notifications` | `NotificationPermissions` (state, action and row for `POST_NOTIFICATIONS`), the first-open prompt |
| `util` | `AppInfo` (installed version, signing fingerprint), `Fingerprints`, `PlatformLog` |
| (root) | `PlatformIdentity` (product name, storage prefix, deep-link scheme, default server, from `BuildConfig`) |

Out of scope, owned by each app: native capabilities (EvoPath's Health Connect sync, MemoriaHub's media sync), their device tables, screens and diagnostics, and the app's own icons and copy. A capability plugs in through `PairingHook` here and `registerAndroidDeviceSource` on the server ([API slice](../../../platform-api/src/android-app/README.md)).

## Install and peer dependencies

Ships inside `@marinoscar/platform-infra` (the npm workspace or the installed package). Include it from the app's `settings.gradle.kts`, the recipe the reference shell uses ([apps/android/settings.gradle.kts](../../../../apps/android/settings.gradle.kts)):

```kotlin
include(":platform-core")
project(":platform-core").projectDir =
    file("../../node_modules/@marinoscar/platform-infra/android/platform-core")
```

The app's root `build.gradle.kts` declares the plugins with `apply false`: `com.android.application` and `com.android.library` 8.13.2, `org.jetbrains.kotlin.android` and `org.jetbrains.kotlin.plugin.serialization` 2.2.21 ([example](../../../../apps/android/build.gradle.kts), [versions](../../../../apps/android/gradle/libs.versions.toml)); Gradle 8.14.3 and JDK 17 or newer. The module pins its own dependencies (androidbrowserhelper 2.6.2, OkHttp 4.12.0, kotlinx.serialization 1.9.0, coroutines 1.10.2, security-crypto 1.1.0, core-ktx 1.17.0), so the app's version catalog needs no entry for them. compileSdk 36, minSdk 26.

## Quick start

The reference shell ([apps/android](../../../../apps/android)) is the whole recipe:

```kotlin
// app/build.gradle.kts
apply(from = project(":platform-core").file("identity.gradle.kts"))
val identity = project.extensions.extraProperties.get("platformIdentity") as Map<String, String>
android { defaultConfig { applicationId = identity.getValue("applicationId") /* … */ } }
dependencies { implementation(project(":platform-core")) }
```

```kotlin
// The launcher (declared in the manifest with the TWA meta-data and an activity-alias)
class TwaLauncherActivity : TwaLauncher() {
    override fun setupActivity() = SetupActivity::class.java
}
```

The setup screen saves the server with `ServerConfig.from(context).setServerUrl(input)` ([SetupActivity](../../../../apps/android/app/src/main/kotlin/com/enterpriseapp/android/SetupActivity.kt)). Build: `cd apps/android && ./gradlew assembleDebug testDebugUnitTest`.

## Configuration

Identity and version come from Gradle, through `identity.gradle.kts`, applied by the module and by the app. It reads the app's `packages/shared/identity.json` (two levels above the Gradle root) and its optional `android` block, and derives exactly what `androidIdentity()` of `@marinoscar/platform-contract/android-app` derives for the CLI and the API:

| Value | Default | `android` block | `-P` override |
|---|---|---|---|
| `applicationId` | `com.<token>.android` (token: the repository name lower-cased to letters and digits) | `applicationId` | `app.applicationId` |
| `storagePrefix` | `<token>` (never change it for a shipped app) | `storagePrefix` | none |
| `deepLinkScheme` | the repository name lower-cased to scheme characters (`app`-prefixed when it starts with a digit), plus `-android` | `deepLinkScheme` | `app.deepLinkScheme` |
| `apkStem` | `slugify(productName)-android` | `apkStem` | none |
| `productName` | identity.json `productName` | none | `app.productName` |
| `versionName`, `versionCode` | `apps/android/version.properties` | none | `app.versionName`, `app.versionCode` |
| default server | empty (the setup screen asks) | none | `app.serverUrl` |
| identity file | `../../packages/shared/identity.json` from the Gradle root | none | `app.identityJson` |

The script stores the result as the extra property `platformIdentity` (a `Map<String, String>`, also carrying `themeColor` and `backgroundColor` as `#FFRRGGBB`, `twaHost` and `twaHostUnset`). The module's `BuildConfig` gets `PRODUCT_NAME`, `STORAGE_PREFIX`, `DEEP_LINK_SCHEME`, `DEFAULT_SERVER_URL` and `TWA_HOST`, read through `PlatformIdentity`.

## Extension-point catalog

The extension ladder and a recipe per extension: [docs/EXTENDING.md](../../../../docs/EXTENDING.md).

Kotlin and Gradle seams (not TypeScript symbols, so `check:package-docs` does not read this table):

| Name | Kind | Signature | When to use | Stability | Example |
|---|---|---|---|---|---|
| `:platform-core` include | overlay | `include(":platform-core")` + `projectDir` | Add the module to an app's Gradle build | experimental | [settings.gradle.kts](../../../../apps/android/settings.gradle.kts) |
| `identity.gradle.kts` | option | `apply(from = …)` then `extra["platformIdentity"]` | Derive applicationId, label, scheme, prefix and version from identity.json | experimental | [app/build.gradle.kts](../../../../apps/android/app/build.gradle.kts) |
| `TwaLauncher` | component | `abstract class TwaLauncher : LauncherActivity` | The app's launcher: subclass it and name the setup screen | experimental | [TwaLauncherActivity.kt](../../../../apps/android/app/src/main/kotlin/com/enterpriseapp/android/TwaLauncherActivity.kt) |
| `TwaLauncher.onAppOpen` | hook | `protected open fun onAppOpen()` | A native capability's debounced "app opened" work | experimental | [TwaLauncher.kt](src/main/kotlin/io/github/marinoscar/platform/android/core/twa/TwaLauncher.kt) |
| `PairingHook` | hook | `interface PairingHook { register; unregister; onPaired; onForgotten }` | Register this phone with a native capability's device API after the device flow | experimental | [PairingManagerTest.kt](src/test/kotlin/io/github/marinoscar/platform/android/core/pairing/PairingManagerTest.kt) |
| `PlatformLog.sink` | hook | `var sink: (Level, String, String, Throwable?) -> Unit` | Keep the module's log lines in the app's diagnostics buffer | experimental | [ApiClientTest.kt](src/test/kotlin/io/github/marinoscar/platform/android/core/net/ApiClientTest.kt) |
| `ServerConfig` | option | `ServerConfig.from(context).setServerUrl(input)` | Save the server address from a setup or settings screen | experimental | [SetupActivity.kt](../../../../apps/android/app/src/main/kotlin/com/enterpriseapp/android/SetupActivity.kt) |

## Data

On-device only, every name prefixed with `storagePrefix`:

| File | Kind | Contents |
|---|---|---|
| `<prefix>_config` | SharedPreferences | `server_url` (not secret) |
| `<prefix>_secure` | EncryptedSharedPreferences (Keystore AES-256 GCM) | `token`, `token_id`, `expires_at`, `device_id`, `installation_id` |
| `<prefix>_app_update` | SharedPreferences | the last check, the offered release, the notified versionCode |
| `<prefix>_notifications` | SharedPreferences | whether the permission prompt was shown or requested |

The app excludes shared preferences from cloud backup and device transfer (the reference shell's `backup_rules.xml` and `data_extraction_rules.xml`). Server-side data (releases, trusted apps, push subscriptions) belongs to the [API slice](../../../platform-api/src/android-app/README.md#data).

## Permissions and settings

Android permissions merged into the app: `INTERNET`, `ACCESS_NETWORK_STATE`, `POST_NOTIFICATIONS`, plus a `<queries>` entry for Custom Tabs services. Server permissions: none of its own; pairing mints a personal access token for the approving user, and the release routes need only an authenticated user. The trusted apps behind `/.well-known/assetlinks.json` are the `android_app` system setting (`system_settings:write`).

## UI

None. The module draws nothing: the app owns its setup screen, its native screens and their copy. `NotificationPermissions.row()` returns the strings and action for a Notifications row, and `UpdatePolicy` the update notification's title and text.

## Infra

The server publishes `/.well-known/assetlinks.json` for the trusted (package, signing key) pairs; the nginx snippet `platform/android-app.conf` routes it ([infra README](../../README.md#infra)). CI builds the reference shell with `.github/workflows/android.yml` (debug APK and JVM unit tests, no secret).

## Observability

`PlatformLog` writes one line per failed API call (method, path, status, API code and `details.reason`) and pairing milestones, to logcat by default. Never a token, a query string, a body or a header. Device-flow polling noise (`authorization_pending`, `slow_down`) is left out.

## Security notes

- No WebView and no JavaScript interface, anywhere: the web app runs in the user's browser through the TWA, and the two sides coordinate only through the launch URL, deep links, the server and Digital Asset Links. A bridge would turn XSS into native code execution. `src/android-core.test.ts` greps the module and the reference shell.
- Tokens live only in `EncryptedTokenStore`; an unreadable keyset resets the pairing instead of falling back to plain storage.
- The device flow asks for a PAT (`clientInfo.tokenType: "pat"`) and refuses any other credential type.
- `AuthFailures.classify`: a `401` stops work and asks to re-pair; `409 DEVICE_REVOKED` forgets the pairing.
- A download link is followed only on the configured server's origin (`UpdatePolicy.downloadUrl`); the server address must be https.

## Conformance suite

JVM unit tests in `src/test` (100 tests): `ServerUrls` and `ServerConfig`, the device-flow poller and request shape, `PairingManager` with and without a hook, the token store, `ApiClient` envelope and error parsing, `AuthFailures`, fingerprint normalisation (the server's two accepted forms), the update policy and checker, `sizeBytes` as a decimal string, notification-permission states. Run them with `cd apps/android && ./gradlew :platform-core:testDebugUnitTest`.

## Upgrade notes

New in `@marinoscar/platform-infra` 0.1 (#746). For EvoPath and MemoriaHub, adopting it means deleting their copies of `twa/`, `pairing/`, `auth/`, `net/`, `config/`, `update/` and `util/` and importing from this package; an app that shipped with another `storagePrefix` or `applicationId` pins both in identity.json's `android` block first, or installed phones lose the server address and the pairing.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `platform-core not found` at configuration | `node_modules` is not installed | `npm install` at the repository root |
| `Product identity not found` | the Gradle root is not two levels below the repository root | pass `-Papp.identityJson=<path>` |
| The TWA shows a URL bar | `assetlinks.json` does not list this package and signing key | trust the app in Admin, Android app, or publish a release with `--trust` |
| Web Push stays Chrome's | the build had no `app.serverUrl`, so the https intent-filter names `invalid.example` | build with `-Papp.serverUrl=https://<server>` |
| Pairing fails with "issued a … instead of an access token" | the server answered a non-PAT credential | update the server; the device flow must honour `tokenType: "pat"` |

## Links

- [Native companion architecture](../../../../docs/specs/native-companion-architecture.md)
- [Android app runbook](../../../../docs/runbooks/android-app.md) and [release runbook](../../../../docs/runbooks/android-release.md)
- [API slice](../../../platform-api/src/android-app/README.md), [web slice](../../../platform-web/src/android-app/README.md), [CLI group](../../../platform-cli/src/android/README.md)
- [Device authorization](../../../../docs/DEVICE-AUTH.md)
