# @marinoscar/platform-cli

## 0.1.0-next.4

### Minor Changes

- a9c2216: Add `@marinoscar/platform-cli/android` (#746): the merged `android` command group (`androidCommand`: doctor with a printed `--fix` plan and `--dry-run`, keystore, version, build, publish with `--trust`, release, releases), the optional `androidDeployStep` (opted in with `<PREFIX>DEPLOY_ANDROID=1`) and `androidTuiScreen`. The engine's `ApiClient` accepts a `formData` request body.
- 8bf9606: Move the CLI into `@marinoscar/platform-cli`: `createCli({ identity, version, extraCommands, tuiScreens, deploySteps, nodeExecutors, envSpecFragments })` builds an app's CLI (the `init`, `login`, `api`, `config`, `node` and `deploy` commands, the TUI, the deploy pipeline and the worker engine) with the identity as configuration; add the `/commands`, `/tui`, `/deploy`, `/node`, `/api-client` and `/testing` entry points, the `registerTuiScreen`, `registerDeployStep` and `registerNodeExecutor` registries, the credential-hygiene check and the `cli` conformance suite. platform-infra: point its README examples at the reference app now that the CLI lives in a package.
- 74c4aff: Declare peer dependencies per slice (`packages/platform-slice-peers.json`, checked by `npm run check:slice-peers`) and make every peer that the universal slice does not need optional. `platform-api` now requires only what `core` needs (`@nestjs/common`, `@nestjs/core`, `@nestjs/swagger`, `@opentelemetry/api`, `@prisma/client`, `nestjs-zod`, `reflect-metadata`, `rxjs`, `zod`); `@nestjs/config`, `@nestjs/schedule`, `@nestjs/event-emitter`, `@nestjs/jwt`, `@nestjs/passport`, `passport`, `@nestjs/terminus` and `@prisma/client-runtime-utils` become optional peers an app installs for the slices that use them. `platform-web` requires only `@mui/material`, Emotion, `react` and `react-dom`; `@mui/icons-material`, `react-router-dom` and `zod` become optional. `platform-db` no longer lists `@prisma/client` (its seed takes the app's client structurally) and `prisma` becomes optional; `platform-cli`'s `react` becomes optional. An app that installed every peer needs no change; an app that imports only some slices can now install only their peers. The datatable no longer imports the undeclared transitive `@mui/utils`.
- 1171b1c: Complete the telemetry slice in all five packages. `@marinoscar/platform-api/telemetry/testing` gains the telemetry conformance suite (registered with `runPlatformConformance()` as `suites.telemetry`: metric groups, route permissions, read-only Doctor checks, no secrets in responses, the cron coverage and the boot without a store), the stub host ports, and the five activity and six coach fixture tables; `ConformanceCase.run` may be async and a slice may add a suite key by augmenting `PlatformConformanceSuiteOptions`. Every telemetry slice README now follows the Package documentation standard with a catalog that links a working example in the reference app.

### Patch Changes

- 1d8cbae: Add `@marinoscar/platform-api/host` (#867): `PlatformHostCoreModule.forRoot()` packages the API host core every slice assumed, moved from the reference app: the cross-replica event bus (`EVENT_BUS`, `in-process` or `postgres` by `EVENT_BUS_ADAPTER`, with its `core.event-bus` doctor check), the platform's `AppMetricsService` and app-metric declarations (`registerPlatformHostAppMetrics`), maintenance mode (`MaintenanceModeService`, `/api/admin/maintenance`, the `maintenance` settings namespace `MAINTENANCE_SYSTEM_SETTINGS`, the `maintenance.mode` doctor check and `MaintenanceGuard` as the only `APP_GUARD`), the `{ data }` envelope, the request log line, the exception filter and request ids; plus the OpenAPI document and `/api/docs` (`createOpenApiDocument`, `registerPlatformDocs`), and the `host` conformance suite (`@marinoscar/platform-api/host/testing`). `platform-cli`: a comment now names the packaged envelope interceptor.
- f6e319b: Documentation only: every slice README's Extension-point catalog links the new extension author guide (`docs/EXTENDING.md`); the email README no longer promises that a provider of `SmtpEmailProvider` in the app module replaces the transport (it does not reach the package's consumers; a transport registry is not supported yet); the AI READMEs say that a provider cannot be enabled from an app yet; the platform-db README documents `rlsPolicies` in `platform.lock` with the migration SQL for an app table protected by row-level security.
- 65d4522: Add the host About module and web slice: `@marinoscar/platform-api/host` now owns `GET /api/admin/about` (`AboutModule.forRoot({ apiVersion })`, `AboutService`, `readDeployInfo`, the `versions` support-bundle section; the database probe reads through `PLATFORM_PRISMA`), and `@marinoscar/platform-web/host/headless` and `/host/ui` own the About page, the admin Maintenance page, the public maintenance screen, the maintenance block store and recogniser and the `useAbout`, `useMaintenance` and `useMaintenanceBlock` hooks. The deploy-info fixture the CLI's tests read moved to `packages/platform-api/test/fixtures`.
- 6487697: Finish the identity slice move (#727): the reference app now imports identity only from `@marinoscar/platform-{api,web,contract}/identity`, so the web identity catalog's examples point at the app's real uses (`App.tsx`, and one example per data hook in `apps/web/src/identity/dataHookExamples.tsx`), the identity hook, page, guard and component suites the app kept run in `platform-web`'s own tests (with a `fakeIdentityApi` test helper), and comments naming the app's old identity paths point at the packages. No API change.
- Updated dependencies [b2df59a]
- Updated dependencies [823ec07]
- Updated dependencies [6a7af76]
- Updated dependencies [deeb8b5]
- Updated dependencies [a20f306]
- Updated dependencies [8bf9606]
- Updated dependencies [2be194f]
- Updated dependencies [0b9962b]
- Updated dependencies [606d231]
- Updated dependencies [0426848]
- Updated dependencies [077c0c0]
- Updated dependencies [fc11b22]
- Updated dependencies [685657b]
- Updated dependencies [5d0dd86]
- Updated dependencies [03eeaab]
- Updated dependencies [17d6ed1]
- Updated dependencies [f80189d]
- Updated dependencies [115705f]
- Updated dependencies [b46725d]
- Updated dependencies [f6e319b]
- Updated dependencies [fe73d7a]
- Updated dependencies [e6acb4b]
- Updated dependencies [c6f97da]
- Updated dependencies [6487697]
- Updated dependencies [a1f5999]
- Updated dependencies [e4ad7d5]
- Updated dependencies [94a63a2]
- Updated dependencies [b46d405]
- Updated dependencies [aeace4a]
- Updated dependencies [f994de1]
- Updated dependencies [346e661]
- Updated dependencies [74c4aff]
- Updated dependencies [5e98e3d]
- Updated dependencies [175ddd3]
- Updated dependencies [1171b1c]
- Updated dependencies [39b5300]
  - @marinoscar/platform-contract@0.1.0-next.4
  - @marinoscar/platform-infra@0.1.0-next.4

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
