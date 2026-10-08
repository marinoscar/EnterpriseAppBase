# Native Companion Architecture (PWA in a TWA plus a native module)

> **Status:** shipped in the platform (#746, PP-9.4), merged from EvoPath's and MemoriaHub's specs of the same name · **Code:** Kotlin [`packages/platform-infra/android/platform-core`](../../packages/platform-infra/android/platform-core/README.md), API [`packages/platform-api/src/android-app`](../../packages/platform-api/src/android-app/README.md), web [`packages/platform-web/src/android-app`](../../packages/platform-web/src/android-app/README.md), CLI [`packages/platform-cli/src/android`](../../packages/platform-cli/src/android/README.md), reference shell `apps/android` · **API:** `/api/android-app/*`, `/api/admin/android-app/*`, `/api/well-known/assetlinks.json`, `/api/auth/device/*` (see `/api/docs`) · **Admin UI:** `/admin/settings/android` · **Runbooks:** [android-app.md](../runbooks/android-app.md), [android-release.md](../runbooks/android-release.md) · **Recipe:** [section 4](#4-extending-it-in-a-fork)

A platform Android app is the web app in a Trusted Web Activity (TWA) plus, optionally, one small native Kotlin module, coordinated through the server. The web app stays the product. A native module exists only to reach an on-device API the web cannot (EvoPath: Health Connect; MemoriaHub: the media library). The two halves share no process-level bridge: they meet through a launch URL, a deep link, the server's REST API, a device-flow pairing and Digital Asset Links. The platform ships everything both apps had in common: the TWA shell, the Kotlin core module, the server's release hosting and trust document, the Android push channel, the web's TWA helpers and the CLI release commands. Each app keeps its own native capability.

## 1. Purpose

- **What it is.**
  - The architectural pattern every platform Android app follows, and the platform pieces that implement it.
  - The record of the options weighed and why a TWA plus native module won, in both apps independently.
  - The inventory of the five coordination channels, their failure modes and where each surfaces in diagnostics.
- **What it is not.**
  - Not a capability spec: EvoPath's `health-connect-sync.md` and MemoriaHub's media-sync spec stay in those apps.
  - Not an operator guide: see the [Android app runbook](../runbooks/android-app.md) and the [release runbook](../runbooks/android-release.md).
  - Not a second client. A native module has no business logic of its own beyond reading the device API, shaping a payload and retrying.
- **Problem it solves.** A PWA cannot reach on-device APIs (Health Connect has no web or cloud API; a browser cannot watch the media library in the background). The product must still be a web app: one UI, one release path, Web Push and the same sign-in everywhere. So the phone runs a small native piece that reads the API locally and pushes to the server, while the web app keeps every screen and every rule. A product with no native capability ships the plain shell: an installable icon, full-screen web app, delegated Web Push and server-hosted updates.

## 2. How it works

### 2.1 Options considered

| Option | Reaches on-device APIs | Keeps the web app as the product | Sign-in | Verdict |
|---|---|---|---|---|
| Pure PWA | No | Yes | Browser session | Not enough for a native capability; still the product |
| Cloud API (server pulls) | No usable API for phone-local data | Yes | n/a | Unavailable |
| Capacitor or another WebView wrapper | Yes, through plugins | Partly: the UI runs in an embedded WebView, not the browser | Google blocks OAuth in embedded user agents (`disallowed_useragent`); a WebView loses the browser's PWA features | Rejected |
| Standalone native companion app | Yes | Yes | Own login | Rejected: two installs, two logins, two icons |
| **TWA plus native module** | **Yes, in the native module** | **Yes, the TWA is the real browser PWA** | **Shared browser session; the native side uses a paired token** | **Chosen** |

| | TWA | WebView |
|---|---|---|
| Engine | The user's browser (Chrome or another TWA-capable browser) | An embedded renderer inside the app |
| Cookies and storage | Shared with the browser | Private to the app |
| Service worker, Web Push, install state | The browser's own | Not the browser's |
| Trust | Verified by Digital Asset Links between the site and the signing key | None needed, and none given |
| JavaScript bridge | None | Possible, and a larger attack surface |

A WebView is a second browser to test, with its own cookie jar and service-worker behaviour, and Google's sign-in refuses it ([RFC 8252](https://datatracker.ietf.org/doc/html/rfc8252)). The TWA is the web app displayed full screen. Its cost is that it cannot call into Kotlin, which is why the coordination channels exist.

### 2.2 Architecture

```
 Phone                                                     Server (same origin)
┌───────────────────────────────────────────────┐
│ applicationId com.<token>.android             │        GET /.well-known/assetlinks.json
│                                               │ ◄─────────────────────────────────────────┐
│  TwaLauncherActivity : TwaLauncher            │                                           │
│   opens <server>/?source=twa&appVersion=…     │        Authorization: Bearer pat_…        │
│   (or SetupActivity when no server is set)    │ ─────────────────────────────────────────►│
│            │                                  │   GET  /api/android-app/releases/latest   │
│            ▼ renders the web app              │   POST /api/<capability>/devices …        │
│   ┌──────────────────┐  deep link             │                                           │
│   │ web app (browser)│  <scheme>://<host>     │                                           │
│   │ session cookie   │ ───────► native module │ (optional, app-owned: pairing UI, worker) │
│   └────────┬─────────┘                        │                                           │
└────────────┼──────────────────────────────────┘                                           │
             │ REST with the browser session (JWT)              nginx ──► api ──────────────┘
             └─────────────────────────────────────────────────────────►  │
                                                  android_app_releases · android_app setting
                                                  object storage: android-releases/<id>.apk
```

| Component | Role | Code |
|---|---|---|
| `TwaLauncher` | Opens the web app at the configured server with the launch flags; the setup screen when no server is set | `platform-core/…/twa/TwaLauncher.kt` |
| Reference shell | A `TwaLauncher` subclass, a setup screen, the manifest (TWA meta-data, launcher alias, https and deep-link filters, Web Push delegation) | `apps/android/app/src/main` |
| Pairing | RFC 8628 device flow for a PAT, encrypted token storage, the `PairingHook` a capability implements | `platform-core/…/pairing/`, `…/auth/TokenStore.kt` |
| Update check | Asks the server for a newer release; opens a signed download link | `platform-core/…/update/` |
| Web helpers | Detect the TWA, read the installed version, the update banner, the admin page | `platform-web/src/android-app/` |
| API | Trusted apps and the assetlinks document, hosted releases, the device-source registry, the `android_app` push channel | `platform-api/src/android-app/`, `platform-api/src/notifications/channels/android-app-notification.channel.ts` |
| Object storage | Holds the APKs under `android-releases/` (survives a factory reset) | [storage-providers.md](storage-providers.md) |
| CLI | Builds, signs and publishes releases, bumps the version, checks the toolchain, an optional deploy step | `platform-cli/src/android/` |
| Native capability | The app's own Kotlin module, server routes, device table and diagnostics | the app ([section 4](#4-extending-it-in-a-fork)) |

### 2.3 Why there is no JavaScript to Kotlin bridge

The platform has no `addJavascriptInterface`, no `postMessage` channel and no custom scheme the page can call synchronously; `apps/android/app/src/main` contains no `WebView` (`packages/platform-infra/src/android-core.test.ts` and the shell's `NoEmbeddedBrowserTest` grep for it). Both apps reached this independently:

- A TWA is the browser, which exposes no way to hand a page a native object; a bridge needs a WebView ([section 2.1](#21-options-considered)).
- A bridge turns every XSS in the web app into native code execution with the app's permissions. Without one, a compromised page reaches only what its own session can reach over REST.
- The halves stay independently deployable: the web ships with every server deploy, the APK only when native code changes.
- The cost is that nothing is synchronous. The web asks, the server mediates, the phone answers later.

### 2.4 The five coordination channels

| # | Channel | Direction | Carries |
|---|---|---|---|
| a | Launch URL query | native to web | "I am the app", the app version |
| b | Deep link | web to native | "open this native screen" |
| c | The server as hub | native and web, through REST | data, runs, diagnostics, releases |
| d | Device-flow pairing in a Custom Tab | web session to native credential | a `pat_` token |
| e | Digital Asset Links | server to the browser | trust: full-screen mode, no URL bar |

**a. Launch URL (`?source=twa&appVersion=&appVersionCode=`).**

- **Mechanism.** `TwaLauncher.getLaunchingUrl()` builds `<server>/?source=twa&appVersion=<versionName>&appVersionCode=<versionCode>` through `ServerUrls.twaLaunchUrl`, from the installed package's version. An https link on the server's host opens at that page with the same parameters (`twaLaunchUrlFor`). The manifest's `DEFAULT_URL` is a placeholder, so one APK works against any deployment. The web app calls `captureTwaLaunch()` once at startup and keeps the flags in `sessionStorage` under a per-app key prefix; `isRunningInTwa()` is true for the stored flag or an `android-app://` referrer; `getInstalledAppVersion()` returns the build.
- **Used for.** Presentation only: offering a capability's deep link, and `AndroidUpdateBanner` when the installed `versionCode` is behind the current release. It grants nothing.
- **Failure mode.** The query string disappears after the first navigation and `sessionStorage` can be blocked; the referrer check covers a missed flag. Anyone can forge it, which is why it never gates an API.
- **Diagnostics.** None on the server: the flag is a hint. A capability's device registration reports the version (EvoPath: `appVersionCode`), and the Doctor check `android.releases` counts devices behind the current release through the device sources.

**b. Deep link (`<scheme>://<host>`).**

- **Mechanism.** The scheme is the identity's `deepLinkScheme` (default `<repo>-android`). The reference shell answers `<scheme>://open` on its launcher alias; a capability declares its own host on its own activity (EvoPath: `health-sync`).
- **Failure mode.** Outside the app the link has no handler, so the web offers it only when `isRunningInTwa()`. A renamed fork gets its own scheme, unless the `android` block pins the shipped one.
- **Diagnostics.** None: it is a navigation.

**c. The server as hub.**

- **Mechanism.** The native side calls the server with its token; the web reads the same data with the browser session. Neither half talks to the other. The platform's own routes: the current release (`GET /api/android-app/releases/latest`), a signed download link, and the trusted apps. A capability adds its device and data routes, and reports its devices to the platform through `registerAndroidDeviceSource` so the admin page and the assetlinks Doctor check see every (package, signing key) pair in use.
- **Failure mode.** A phone offline leaves the server stale; every write a capability makes is idempotent, so a late sync is harmless ([section 2.6](#26-data-flow-and-correctness-patterns)).
- **Diagnostics.** The Doctor checks `android.assetlinks` and `android.releases` ([doctor.md](doctor.md)); a capability adds its own.

**d. Pairing through the device flow.**

- **Mechanism.** `PairingManager` requests a code (`POST /api/auth/device/code` with `clientInfo.tokenType: "pat"`), the app shows the user code and opens the activation page in a Custom Tab, which shares the browser's cookie jar, so the user is already signed in and only approves. The app polls `POST /api/auth/device/token` (RFC 8628: `authorization_pending`, `slow_down` adds 5 s up to 60 s) and receives a `pat_` token, stored in `EncryptedTokenStore` as soon as it arrives; then the capability's `PairingHook.register` tells its API about the phone, retryable without a second approval. Unpairing calls the hook's `unregister`, or `DELETE /api/pat/{id}` without a hook.
- **Failure mode.** Signed out of the browser: the Custom Tab shows the normal sign-in, then the approval. A token that expires or is revoked answers `401`: the app stops work and asks to re-pair. A `409 DEVICE_REVOKED` makes it forget the pairing (`AuthFailures.classify`).
- **Diagnostics.** The capability's own (EvoPath: `pairing.token`, `auth.valid`).

**e. Digital Asset Links trust.**

- **Mechanism.** The browser opens the TWA without a URL bar only if `/.well-known/assetlinks.json` lists the app's package and signing SHA-256. The system setting `android_app` holds the trusted list (at most 10); `GET /api/well-known/assetlinks.json` serves it as a bare array, public and reachable during maintenance, and the nginx snippet `platform/android-app.conf` maps `/.well-known/assetlinks.json` to it. An administrator trusts a pair at `/admin/settings/android` (from the pairs devices report, or by hand); publishing or making a release current with `trust` adds its pair.
- **Failure mode.** An untrusted or mistyped fingerprint, or a changed key, leaves the app working with a URL bar. The browser caches a failed verification, which is why the document survives maintenance windows.
- **Diagnostics.** The Doctor check `android.assetlinks` warns when a paired device reports a (package, signing key) pair the document does not list.

### 2.5 Identity and security model

| | Browser (web app) | Native module |
|---|---|---|
| Credential | Access JWT in memory plus the HttpOnly `refresh_token` cookie | `pat_` token in `EncryptedSharedPreferences` (`<storagePrefix>_secure`) |
| Obtained by | Sign-in in the browser | Device flow approved in that same browser |
| Lifetime | 15 minutes, rotated refresh | `DEVICE_PAT_EXPIRY_DAYS` (default 90) |
| Revoked by | Sign out | Unpair, or the Access Tokens page |

- **Identity from `identity.json`.** `platform-core/identity.gradle.kts` derives the applicationId (`com.<token>.android`), the deep-link scheme, the storage prefix, the label and the brand colours; `androidIdentity()` of `@marinoscar/platform-contract/android-app` derives the same values for the API, the web and the CLI. The optional `android` block pins any of `applicationId`, `deepLinkScheme`, `storagePrefix` and `apkStem` (an app that shipped under other names copies them there). Changing the applicationId or the storage prefix of a shipped app orphans installed copies or loses their server address and pairing.
- **The signing key is the trust anchor.** Lose the keystore and installed copies can never be updated; leak it and someone else can ship an APK the browser opens full screen against your server. The CLI keeps it outside every checkout ([android-release.md](../runbooks/android-release.md)).
- **No token in logs.** `PlatformLog` lines carry method, path, status and API code; never a body, query string or header.
- **Presentation hints are not authorization.** The server never trusts `?source=twa` or the app version.
- **A release upload refuses an untrusted pair.** `POST /api/admin/android-app/releases` answers `409 RELEASE_UNTRUSTED_APP` when the trusted list is non-empty and does not hold the APK's (package, signing key), unless the upload says `trust=true`.

### 2.6 Data flow and correctness patterns

The platform's own data:

- `android_app_releases`: the APKs a deployment hosts, `@@unique([packageName, versionCode])`, `size_bytes` a BigInt (sent as a decimal string).
- `android_app_releases_one_current_uniq_idx`: a raw-SQL partial unique index (`ON android_app_releases ((true)) WHERE is_current`), at most one current release deployment-wide. Intentional schema drift: Prisma cannot express it; never declare it as `@@unique` and never replace it with a `findFirst` pre-check. Two concurrent "make current" calls: one wins, the other answers `409 RELEASE_CURRENT_CONFLICT`.
- `push_subscriptions.platform`: `browser` (default) or `android_app`, with the CHECK constraint `push_subscriptions_platform_check`. The `android_app` notification channel sends only to `android_app` subscriptions; `collapseOverlappingChannels` drops it when `push` also resolves for the same event, so nobody receives two toasts. A subscription is re-tagged only up to `android_app`, never back.

Patterns for a capability's data (both apps follow them):

- **Idempotent upserts with an owned key**, `(user, provider = <capability>:<deviceId>, externalId)`, through a raw-SQL partial unique index listed in `raw-sql-indexes.json`.
- **Window-based reconciliation** only for the scopes the run names, so an empty read is never mistaken for "everything was deleted".
- **A run ledger** on both sides, inserted even for a failed or skipped run.
- **One request, one transaction.** Work that outlives the request (thumbnails, transcoding) is a queue job ([job-queue.md](job-queue.md)).

### 2.7 Lifecycle and releases

| Change | Needs a new APK | Needs only a server deploy |
|---|---|---|
| Any web screen, copy, rule or API change | No | Yes |
| Trusting another build (`/admin/settings/android`) | No | No (a setting) |
| A new native permission, reader, worker or screen | Yes | Also, to accept a new payload |
| Renaming the product without an `android` block | Yes: the package changes, so it is a new app | Yes |

- **Version.** `apps/android/version.properties` holds `versionName` and `versionCode`; `<cli> android version` bumps it. `versionCode` must strictly increase: the server refuses a duplicate (`409 RELEASE_VERSION_EXISTS`) and a non-newer current release (`409 RELEASE_VERSION_NOT_NEWER`, unless forced).
- **Release paths.** `<cli> android release` (build, sign, upload, make current), the terminal menu's Android screen, the optional deploy step (`<PREFIX>DEPLOY_ANDROID=1`, after `verify`), the upload form at `/admin/settings/android`, and `.github/workflows/android.yml` (debug APK and unit tests only). Procedures: [android-release.md](../runbooks/android-release.md).
- **Server-hosted releases.** The APK is streamed to object storage (`android-releases/<id>.apk`, at most 150 MiB, never buffered) and served through a signed 10-minute same-origin link (`POST /api/android-app/releases/:id/download-link`, then `GET /api/android-app/download/<token>`), so the system downloader needs no `Authorization` header. Rollback is making an older release current.
- **In-app update.** Inside the TWA, the web app's `AndroidUpdateBanner` compares the launch URL's `appVersionCode` with the current release. A native screen can use `UpdateChecker` (every launch, 5-minute debounce, only while paired) and `BackgroundUpdateCheck` (at most every 6 hours, one notification per version).

### 2.8 Where each concern lives

| Concern | Native | Web | Server |
|---|---|---|---|
| Reads the device API | Yes | No | No |
| Business rules and precedence | No | No | Yes |
| User interface for the data | Pairing, toggles, diagnostics only | Everything else | n/a |
| Authorization | Presents a PAT | Presents a JWT | Decides |

### 2.9 Trade-offs and limits

- **Android only.** A TWA is an Android concept.
- **A TWA-capable browser is required**; without one the launcher falls back to a Custom Tab with a URL bar.
- **Two credentials.** The browser session and the paired token are separate; expiry of the PAT means re-pairing.
- **No synchronous web to native calls.** Design features as "the phone pushes, the web reads".
- **Sideloaded, not Play.** The app is distributed from the deployment. A Play listing would add policy reviews (Health Connect data use, photo and video permissions).
- **Background limits.** WorkManager's periodic work is best-effort (Doze, App Standby, vendor battery savers).
- **Digital Asset Links are cached.** A newly trusted key takes a few minutes; the browser remembers a failed verification.

## 3. Configuration and permissions

- **Env vars:** `DEVICE_PAT_EXPIRY_DAYS` (pairing token lifetime). The download-link key derives from `SECRETS_ENCRYPTION_KEY`. Storage is configured at runtime ([storage-providers.md](storage-providers.md)); no Android variable exists.
- **System setting:** `android_app` (`trustedApps`), edited at `/admin/settings/android`.
- **Build inputs:** `apps/android/version.properties`, `packages/shared/identity.json` (and its `android` block), the Gradle property `app.serverUrl`, the signing variables `ANDROID_KEYSTORE_FILE`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.

| Route | Auth |
|---|---|
| `GET /api/well-known/assetlinks.json` | public, reachable during maintenance |
| `GET`/`PUT /api/admin/android-app`, `POST …/test-notification` | `system_settings:read` / `system_settings:write` |
| `GET /api/admin/android-app/releases`; `POST` (upload), `POST …/:id/make-current`, `DELETE …/:id` | `system_settings:read` / `system_settings:write` |
| `GET /api/android-app/releases/latest`, `POST …/:id/download-link` | any signed-in user (JWT or PAT) |
| `GET /api/android-app/download/:token` | the signed token |
| `/api/auth/device/code`, `/api/auth/device/token` | device flow; activation needs the user's session |

## 4. Extending it in a fork

### 4.1 A plain TWA app

Nothing beyond `identity.json`: build `apps/android`, trust the signing key, publish a release. The reference shell is the whole app.

### 4.2 Adding a native capability

Work through the layers in this order.

1. **Decide it needs native code.** If a web API (Web Push, File System Access, Web Share) can do it, use the web app.
2. **A Kotlin module of the app** (for example `:health-sync`), depending on `:platform-core`. Put the platform API behind a gateway interface so the engine is unit-testable on the JVM; background work goes in a `CoroutineWorker` with a unique name, a network constraint and backoff; permission loss is a reported `skipped` run, not a crash.
3. **Pairing reuse.** Implement `PairingHook` (`register` posts the device to the capability's API and returns its id; `unregister` removes it; `onPaired` schedules the worker; `onForgotten` cancels it) and build `PairingManager` with it. Apply `AuthFailures.classify` to every authenticated call: `REPAIR_REQUIRED` stops work and asks to re-pair; `FORGET_PAIRING` calls `forgetLocally()`.
4. **Launch hooks.** Override `TwaLauncher.onAppOpen()` for a debounced app-open sync; declare the capability's deep-link host on its own activity; the web offers the link only when `isRunningInTwa()`.
5. **Server routes and the device source.** The device table, the ingestion routes (idempotent upserts through a raw-SQL partial unique index, reconciliation inside a window), and `registerAndroidDeviceSource({ id, reportedApps, devicesBehind })` so the admin page and `android.assetlinks` see the capability's phones. Register the table in the user-data ownership manifests; long-running work is a queue job.
6. **Notifications.** An event that should reach the app declares the `android_app` channel; `collapseOverlappingChannels` keeps it from doubling with `push`.
7. **Diagnostics.** One pure check per failure you can name, each with its own timeout, never throwing.
8. **Release.** Bump `version.properties`, `<cli> android release`, and confirm the signing key is still trusted.
9. **Tests.** JVM unit tests for mapping, payloads and checks (`./gradlew testDebugUnitTest`); API service, integration and `*.db.spec.ts` tests for the upserts; web component tests for the TWA-only surfaces.

Shipped examples: EvoPath's Health Connect sync and MemoriaHub's media sync (resumable chunked uploads, MediaStore generation catch-up, post-processing as queue jobs).

## 5. Guardrails

- `packages/platform-infra/src/android-core.test.ts`: the module ships its Gradle files, keeps the neutral package, builds the launch URL with all three parameters, and neither it nor `apps/android/app/src/main` embeds a browser.
- `apps/android/app/src/test/.../NoEmbeddedBrowserTest.kt` and the 100 JVM tests of `:platform-core` (CI: `.github/workflows/android.yml`).
- `packages/platform-db/test/raw-sql-indexes.spec.ts` and `apps/api/test/android-app/android-app-releases.db.spec.ts`: the partial unique index exists and decides concurrent "make current" calls.
- `packages/platform-api/test/android-app/*.spec.ts` and `apps/api/test/android-app/*.spec.ts`: fingerprints, the trusted-apps schema and pipe, the APK inspector, download tokens, device-source merging, the doctor checks, the routes and their guards, conformance.
- `packages/platform-api/test/notifications/android-app-channel.spec.ts`: channel collapse and re-tag rules.
- `packages/platform-web/test/android-app/android-app.test.tsx`: TWA detection and the banner shown only inside the TWA.
- `apps/api/test/docs-links.spec.ts`: this spec's links.

## 6. Design decisions

- **TWA plus native module, not a WebView wrapper.** Google's sign-in refuses embedded user agents, and a wrapper replaces the browser's PWA behaviour with its own.
- **No JavaScript bridge.** A bridge needs a WebView and widens the XSS blast radius.
- **The server is the hub.** The phone pushes, the web reads; multi-device support, history and diagnostics follow.
- **Pairing in a Custom Tab with the device flow**, for a separate, revocable PAT. Rejected: embedded sign-in (blocked), a secret in the launch URL (leaks through logs and history).
- **The Kotlin core ships as files inside an npm package.** Rejected: Maven Central or a GitHub Packages registry (a second registry, signing and credentials for one maintainer). React Native distributes Gradle modules the same way, and the npm lockfile versions it.
- **Identity derived at build time, with an override block.** One `identity.json` feeds Gradle, the web, the API and the CLI; the `android` block lets an app keep the names its installed phones already know.
- **Untrusted uploads are refused.** A release signed with a key nobody trusted would install but open with a URL bar; the upload says so up front, and `trust=true` records the decision.

## 7. Verification

```bash
npx vitest run --root packages/platform-infra src/android-core.test.ts
npm test --workspace=api -- android-app
(cd apps/android && ./gradlew assembleDebug testDebugUnitTest)   # JDK 17+ and the Android SDK; CI runs it in android.yml
```

By hand:

1. Install the debug APK, enter the server address, and see the web app open; once the signing key is trusted, `curl -s <server>/.well-known/assetlinks.json` lists the package and the URL bar disappears (channel e).
2. Publish a newer release and see the update banner inside the app (channels a and c).
3. In a capability: pair, approve in the Custom Tab already signed in, and see the device on the web (channel d).

## References

- [Trusted Web Activity overview](https://developer.chrome.com/docs/android/trusted-web-activity), [Digital Asset Links](https://developers.google.com/digital-asset-links/v1/getting-started), [Custom Tabs](https://developer.chrome.com/docs/android/custom-tabs), [android-browser-helper](https://github.com/GoogleChrome/android-browser-helper)
- [RFC 8628, OAuth 2.0 Device Authorization Grant](https://datatracker.ietf.org/doc/html/rfc8628), [RFC 8252, OAuth 2.0 for Native Apps](https://datatracker.ietf.org/doc/html/rfc8252)
- Internal: [DEVICE-AUTH.md](../DEVICE-AUTH.md), [personal-access-tokens.md](../personal-access-tokens.md), [browser-notifications.md](browser-notifications.md), [storage-providers.md](storage-providers.md), [doctor.md](doctor.md), [RENAMING.md](../RENAMING.md), [platform-packages.md](platform-packages.md)

## History

- EvoPath built the pattern for Health Connect sync (its epic #276); MemoriaHub built the same pattern for media sync. Both wrote a spec of this name.
- #746 (PP-9.4) merged the shared parts into the platform packages and this spec.
