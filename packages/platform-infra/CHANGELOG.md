# @marinoscar/platform-infra

## 0.1.0-next.40

## 0.1.0-next.39

## 0.1.0-next.38

## 0.1.0-next.37

## 0.1.0-next.36

## 0.1.0-next.35

### Minor Changes

- cbf4877: OAuth server: resource-server helpers (PP-15.6). Protected resource metadata (RFC 9728) at `GET /api/oauth/.well-known/protected-resource[/<resource path>]` (`resource` is `APP_URL` plus the path, one authorization server; the bare path answers when exactly one resource is registered). `buildBearerChallenge` builds the `WWW-Authenticate: Bearer resource_metadata="..."` value with quoting and no line breaks. `JwtAuthGuard` adds that challenge to every `401` on a protected resource's routes (no credential, a bad session or PAT, an invalid or expired `oat_` token; `error="invalid_token"` only when a credential was presented); routes outside every resource and a disabled server keep their `401` exactly. `InsufficientScopeException` and `assertOAuthScopes(principal, resourceId, scopes)` answer `403` with `error="insufficient_scope"` and the granted scopes together with the missing ones; `PermissionsGuard` maps a denial of an `oauth` principal to it when the user holds the permission and a scope of the resource grants it, else a plain `403`. New in `@marinoscar/platform-api/core`: `withResponseHeaders` / `responseHeadersOf` (an exception can ask the error filter for response headers). New in `@marinoscar/platform-api/host`: `buildCorsOptions(raw, { openPaths })` (prefixes that answer any origin without credentials, through the plugin's per-request delegate; every other route keeps the policy), and `OAUTH_PUBLIC_CORS_PATHS` in `@marinoscar/platform-api/identity` for the token, register and revoke endpoints and the metadata documents. Pass it from `main.ts` when `CORS_ORIGIN` lists an allowlist. `@marinoscar/platform-infra` ships `nginx/platform/oauth-server.conf` (`/.well-known/oauth-authorization-server` and `/.well-known/oauth-protected-resource[/<path>]` to the API, `/.well-known/openid-configuration` and other unknown `/.well-known/oauth-*` paths as a JSON `404`, never the SPA); an app opts in with `include /etc/nginx/platform/oauth-server.conf;` in `infra/nginx/app.d/locations/oauth-server.conf`. Run `platform-infra sync` after upgrading.
- cbf4877: OAuth server gap closure (epic #1178). API: `GET /api/admin/oauth/refused-hosts` (`oauth_clients:read`) returns `[{ host, count, lastSeenAt }]` aggregated from the `oauth:client.refused` audit rows of the last 30 days, newest first, at most 100 hosts; `GET /api/admin/oauth/policy` (`oauth_clients:read`) returns `{ suggestedHosts }`, the app's `IdentityModule.forRoot({ oauthServer: { defaultAllowedClientHosts } })`. Both are served by the new `OAuthAdminHintsController`. The consent read (`GET /api/oauth/requests/:id`) adds `client.isNewToDeployment`: `true` when the client was first seen under 24 hours ago or no OTHER user holds an active grant with it (one indexed lookup, only for a client older than a day). Contract: `OAuthRefusedHost`, `OAuthPolicy` (and their schemas), `OAuthConsentRequest.client.isNewToDeployment` (required), `OAUTH_APPLICATION_TYPES`. Web: `createOAuthServerApi` gains `getPolicy()`, `/identity/headless` gains `useOAuthPolicy`, and `OAuthClientsPage` uses the API's suggested hosts when its `suggestedHosts` prop is absent (the prop still wins; a `404` from either route keeps the page working); the consent page shows its first-time notice from `isNewToDeployment` (the client-side 24-hour guess and `isNewClient` are gone). Infra: `csp.conf` and `csp.dev.conf` add `$frame_deny`, `$x_frame_options` and `$csp_header`; `platform/security-headers.conf` now sends `X-Frame-Options $x_frame_options` and `Content-Security-Policy $csp_header`, so `/oauth/consent` and `/oauth/error` answer `X-Frame-Options: DENY` and `frame-ancestors 'none'` with the rest of the policy (the app's `app.d/csp/` additions included) unchanged, and every other path is byte-for-byte as before. Run `platform-infra sync` after upgrading. TSDoc: exported OAuth symbols are documented and tagged so TypeDoc is warning-free.

## 0.1.0-next.34

## 0.1.0-next.33

## 0.1.0-next.32

## 0.1.0-next.31

## 0.1.0-next.30

## 0.1.0-next.29

## 0.1.0-next.28

## 0.1.0-next.27

## 0.1.0-next.26

## 0.1.0-next.25

## 0.1.0-next.24

## 0.1.0-next.23

## 0.1.0-next.22

## 0.1.0-next.21

## 0.1.0-next.20

## 0.1.0-next.19

## 0.1.0-next.18

### Patch Changes

- bca937b: Example names in doc comments, README examples and schema examples are replaced with invented placeholders (Org Kappa, Org Sigma, Org Theta and similar) instead of well-known fictional brands. No behaviour change.

## 0.1.0-next.17

## 0.1.0-next.16

## 0.1.0-next.15

## 0.1.0-next.14

## 0.1.0-next.13

## 0.1.0-next.12

## 0.1.0-next.11

## 0.1.0-next.10

## 0.1.0-next.9

## 0.1.0-next.8

## 0.1.0-next.7

## 0.1.0-next.6

## 0.1.0-next.5

## 0.1.0-next.4

### Minor Changes

- fa3f5b9: Open the CLI and infra seams an app needs without editing a package (PP-14.22, #940).

  Proxy (a production bug): an app SSE route worked through the app's own nginx but was buffered and cut at 60 s by the shared VPS host proxy, which knew only the platform's three streaming paths. `createCli({ proxy: { streamPaths } })` and `registerProxyStreamPath(path | { path, timeoutSeconds })` make `renderVhost` add one unbuffered, long-lived location per path with the directives of the platform's SSE locations (`ProxyTarget` gains `streamPaths` and `extraLocations`). Paths are validated before they reach the shared nginx config (a leading `/`, letters, digits and `. _ ~ / : @ + , = -`; a newline, `;`, quote, brace, `$`, `#` or space throws). A vhost for an app that declares none is byte-identical.

  CLI: `registerEnvGroup` (the three platform groups register through it; `ENV_GROUPS` stays as the built-in list and `EnvGroup` widens to `string`), `registerEnvGenerator` (`GenerateKind` widens to `string`; a generator is a function whose value is checked against a safe character set, never a command) and `annotateEnvKey` (the app wins for `fixed` and `help` on a platform key; a secret cannot be fixed); `registerDeployCheck` (`allChecks()` is the built-ins plus the app's; `ALL_CHECKS` is unchanged); `registerDeployStep` takes exactly one of `after`, `before` and `replaces` plus `skipWhen`, and `DeployStepContext` gains read-only `env` and `answers` that withhold secret keys; `registerEdgeConfigFile`; `registerTuiScreenSection` for the node and deploy screens; `registerCliConformanceSuite` and a `deployRegistrations` suite. `createCli` gains `envGroups`, `envGenerators`, `envAnnotations`, `deployChecks`, `edgeConfigFiles`, `tuiSections` and `proxy`.

  Migration notes for `@marinoscar/platform-cli`: in `runPlatformConformance`, `cli: false` now throws; pass `cli: { skip: 'reason' }` (an empty reason also throws). `DeployStepRegistration.step` and `.after` are optional (a registration reading `.step` needs a check; the registrations the package builds keep `step` defined). A hand-built `DeployStepContext` in a test needs `env` and `answers`: use `testDeployStepContext` from `/testing`.

  Infra: the default CSP is composed from `$csp_*_extra` maps that include `app.d/csp/*.conf` (sources for `connect-src`, `img-src`, `media-src`, `font-src`, `style-src`, and whole extra directives); with no file the header is byte-identical, there is no `script-src` hook, and the `/api/docs` policy is not extended. `sync` creates `app.d/csp/` and two inert example files. `composeFilesForMode('test')` and `app.test.*` overlays, `registerComposeMode`, and `runInfraConformance({ appRoot })` at `@marinoscar/platform-infra/testing` (sync check, `docker compose config` per mode with the app's overlays, `nginx -t` over `app.d`; a missing tool is a passing case named with the reason). Run `npm run platform:infra:sync` to refresh `csp.conf` and `csp.dev.conf`.

- a1f5999: Ship the Android companion's infra: the `platform/android-app.conf` nginx snippet (`/.well-known/assetlinks.json`, the unbuffered APK upload and download routes), and `android/platform-core`, a Kotlin Android library module distributed as files (TWA launcher, server configuration, device-flow pairing, encrypted token store, API client, app updates, notification-permission rules, and `identity.gradle.kts` deriving the Android identity from `identity.json`). An app includes it from `settings.gradle.kts` with `include(":platform-core")`.
- e4ad7d5: `platform-infra sync` ships executable scripts: a generated file marked `executable` keeps its `#!` shebang on line 1 (the header goes after it), is written with mode 0755 and listed under its fragment's `executable` key in `infra/platform-infra.lock.json`, and `sync --check` fails when it loses its executable bit. The compose fragment now ships `postgres-init/10-application-role.sh`, the init script `devdb.compose.yml` and `test.compose.yml` mount to create the ordinary (NOSUPERUSER NOBYPASSRLS) role the API runs as.
- 94a63a2: Ship the base, dev, devdb, prod, vps, worker, worker.build and test compose fragments, nginx.conf with its app include points and the security-headers and SSE snippets, and the env templates; render the app identity into them on `platform-infra sync` (`--identity`), and order each mode's compose files with the app's `app.*.compose.yml` overlays last (`composeFilesForMode`, `appComposeOverlays`).
- 1171b1c: Complete the telemetry slice in all five packages. `@marinoscar/platform-api/telemetry/testing` gains the telemetry conformance suite (registered with `runPlatformConformance()` as `suites.telemetry`: metric groups, route permissions, read-only Doctor checks, no secrets in responses, the cron coverage and the boot without a store), the stub host ports, and the five activity and six coach fixture tables; `ConformanceCase.run` may be async and a slice may add a suite key by augmenting `PlatformConformanceSuiteOptions`. Every telemetry slice README now follows the Package documentation standard with a catalog that links a working example in the reference app.

### Patch Changes

- 8bf9606: Move the CLI into `@marinoscar/platform-cli`: `createCli({ identity, version, extraCommands, tuiScreens, deploySteps, nodeExecutors, envSpecFragments })` builds an app's CLI (the `init`, `login`, `api`, `config`, `node` and `deploy` commands, the TUI, the deploy pipeline and the worker engine) with the identity as configuration; add the `/commands`, `/tui`, `/deploy`, `/node`, `/api-client` and `/testing` entry points, the `registerTuiScreen`, `registerDeployStep` and `registerNodeExecutor` registries, the credential-hygiene check and the `cli` conformance suite. platform-infra: point its README examples at the reference app now that the CLI lives in a package.
- f6e319b: Documentation only: every slice README's Extension-point catalog links the new extension author guide (`docs/EXTENDING.md`); the email README no longer promises that a provider of `SmtpEmailProvider` in the app module replaces the transport (it does not reach the package's consumers; a transport registry is not supported yet); the AI READMEs say that a provider cannot be enabled from an app yet; the platform-db README documents `rlsPolicies` in `platform.lock` with the migration SQL for an app table protected by row-level security.
- b46d405: Name the disposable GreptimeDB test container after the app (`greptime-@@PLATFORM_TEST_CONTAINER@@`) instead of a fixed `my-app-greptime-test`, so an app renders no other app's identity, and point the fragments' comments at the CLI's packaged sources (`packages/platform-cli/src/engine/...`).

## 0.1.0-next.3

## 0.1.0-next.2

## 0.1.0-next.1

## 0.1.0-next.0

### Minor Changes

- a66fef1: First pre-release of the platform packages: the six-package scaffold (build formats, boundary lint, pack check, TSDoc and generated API reference, single-instance peer dependencies) plus the first slices.

  - `@marinoscar/platform-api/core`: the typed registry primitive (`defineRegistry`, `Registry`, `RegistryError`, `RegistryFreezeService`, `withTemporaryEntries`).
  - `@marinoscar/platform-api/testing`: the conformance harness (`runPlatformConformance`, `conformanceSuites`) with the `cron-enqueue-only` suite.
  - `@marinoscar/platform-cli/core`: the CLI command and env-spec fragment registries.
  - `@marinoscar/platform-cli/telemetry`: the node span relay and the telemetry env-spec fragment.
  - `@marinoscar/platform-infra`: `infraFile()`, the `platform-infra` command (`sync` materialises fragments into an app) and the `telemetry` slice (collector and GreptimeDB compose fragments, collector config and overlay, typed manifest).
  - `@marinoscar/platform-contract`, `@marinoscar/platform-web` and `@marinoscar/platform-db` ship their package scaffold only; their slices follow in later releases.
