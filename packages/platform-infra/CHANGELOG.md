# @marinoscar/platform-infra

## 0.1.0-next.4

### Minor Changes

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
