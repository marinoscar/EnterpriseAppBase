# @marinoscar/platform-cli

## 0.1.0-next.6

### Patch Changes

- @marinoscar/platform-contract@0.1.0-next.6
- @marinoscar/platform-infra@0.1.0-next.6

## 0.1.0-next.5

### Patch Changes

- 522ed14: Test-only change: the deploy-checks registry test (`gives every non-passing check a remedy, across the whole registry`) now allows 30 s instead of vitest's default 5 s, because `database-reachable` makes a real TCP connection with its own 5 s timeout that the check context cannot fake, and a loaded CI runner could hit the limit. No runtime change; the six packages move together (fixed group) and this version is also the first release through trusted publishing.
  - @marinoscar/platform-contract@0.1.0-next.5
  - @marinoscar/platform-infra@0.1.0-next.5

## 0.1.0-next.4

### Minor Changes

- a9c2216: Add `@marinoscar/platform-cli/android` (#746): the merged `android` command group (`androidCommand`: doctor with a printed `--fix` plan and `--dry-run`, keystore, version, build, publish with `--trust`, release, releases), the optional `androidDeployStep` (opted in with `<PREFIX>DEPLOY_ANDROID=1`) and `androidTuiScreen`. The engine's `ApiClient` accepts a `formData` request body.
- 8bf9606: Move the CLI into `@marinoscar/platform-cli`: `createCli({ identity, version, extraCommands, tuiScreens, deploySteps, nodeExecutors, envSpecFragments })` builds an app's CLI (the `init`, `login`, `api`, `config`, `node` and `deploy` commands, the TUI, the deploy pipeline and the worker engine) with the identity as configuration; add the `/commands`, `/tui`, `/deploy`, `/node`, `/api-client` and `/testing` entry points, the `registerTuiScreen`, `registerDeployStep` and `registerNodeExecutor` registries, the credential-hygiene check and the `cli` conformance suite. platform-infra: point its README examples at the reference app now that the CLI lives in a package.
- 3080222: `deploy install` provisions a dedicated, least-privilege application database role instead of running the API as the operator's login (#980). Row-level security is skipped for a superuser or a `BYPASSRLS` role, so an API that connected as the administrator the operator typed served every organization's rows to every other. Install's `environment` step now calls `ensureApplicationRole` (`engine/deploy/app-role.ts`, the one implementation, shared with update): a privileged login is used once, in memory, to create `<app>_app` (`LOGIN NOSUPERUSER NOBYPASSRLS CREATEDB CREATEROLE`, `createrole_self_grant = 'inherit, set'`) with a generated 32-byte password sent as a SCRAM-SHA-256 verifier on `psql`'s stdin (new `runPsqlScript`; `runCommand` gains `input`), and only the role is written to `.env` (0600). An existing database is re-owned with `ALTER ... OWNER TO` in one transaction (never `REASSIGN OWNED BY`), after a backup recommendation and consent. New required check `database-role-ordinary` gates `validate-environment`, the `ensure-database` re-verify and `deploy doctor`. New flags on `install` and `update`: `--app-db-user`, `--admin-user` (password only from `<PREFIX>DB_ADMIN_PASSWORD` or the answers key `DB_ADMIN_PASSWORD`, never a flag), `--skip-role-provisioning`, `--allow-superuser` (recorded in the deploy state as `allowSuperuser` with the `allowSuperuserLogin` it applies to), `--rotate-app-password`, `--provision-app-role`, `--transfer-ownership`, `--allow-reduced-role`, `--show-credentials`; the answers keys `DB_ADMIN_USER`, `DB_ADMIN_PASSWORD` and `APP_DB_USER` are removed from the answers and never reach `.env`. `deploy update` gains a `database-role` step (added to `UPDATE_STEP_IDS` between `environment-drift` and `ensure-database`) that warns on a superuser `POSTGRES_USER` and, with consent, migrates the deployment onto a dedicated role and restarts the API. An existing role is never taken over: if it exists and the recorded credentials do not open it, install refuses unless `--rotate-app-password` (or an interactive yes naming the role); the password is set last, after `.env` holds it, and `.env` is put back if the server refuses it. Behaviour change: an install whose entered login is privileged and that gives no consent (a non-interactive run without `--provision-app-role`, `--skip-role-provisioning` or `--allow-superuser`) now stops instead of deploying as the superuser. `.env.example` and the environment variable set are unchanged.
- fa3f5b9: Open the CLI and infra seams an app needs without editing a package (PP-14.22, #940).

  Proxy (a production bug): an app SSE route worked through the app's own nginx but was buffered and cut at 60 s by the shared VPS host proxy, which knew only the platform's three streaming paths. `createCli({ proxy: { streamPaths } })` and `registerProxyStreamPath(path | { path, timeoutSeconds })` make `renderVhost` add one unbuffered, long-lived location per path with the directives of the platform's SSE locations (`ProxyTarget` gains `streamPaths` and `extraLocations`). Paths are validated before they reach the shared nginx config (a leading `/`, letters, digits and `. _ ~ / : @ + , = -`; a newline, `;`, quote, brace, `$`, `#` or space throws). A vhost for an app that declares none is byte-identical.

  CLI: `registerEnvGroup` (the three platform groups register through it; `ENV_GROUPS` stays as the built-in list and `EnvGroup` widens to `string`), `registerEnvGenerator` (`GenerateKind` widens to `string`; a generator is a function whose value is checked against a safe character set, never a command) and `annotateEnvKey` (the app wins for `fixed` and `help` on a platform key; a secret cannot be fixed); `registerDeployCheck` (`allChecks()` is the built-ins plus the app's; `ALL_CHECKS` is unchanged); `registerDeployStep` takes exactly one of `after`, `before` and `replaces` plus `skipWhen`, and `DeployStepContext` gains read-only `env` and `answers` that withhold secret keys; `registerEdgeConfigFile`; `registerTuiScreenSection` for the node and deploy screens; `registerCliConformanceSuite` and a `deployRegistrations` suite. `createCli` gains `envGroups`, `envGenerators`, `envAnnotations`, `deployChecks`, `edgeConfigFiles`, `tuiSections` and `proxy`.

  Migration notes for `@marinoscar/platform-cli`: in `runPlatformConformance`, `cli: false` now throws; pass `cli: { skip: 'reason' }` (an empty reason also throws). `DeployStepRegistration.step` and `.after` are optional (a registration reading `.step` needs a check; the registrations the package builds keep `step` defined). A hand-built `DeployStepContext` in a test needs `env` and `answers`: use `testDeployStepContext` from `/testing`.

  Infra: the default CSP is composed from `$csp_*_extra` maps that include `app.d/csp/*.conf` (sources for `connect-src`, `img-src`, `media-src`, `font-src`, `style-src`, and whole extra directives); with no file the header is byte-identical, there is no `script-src` hook, and the `/api/docs` policy is not extended. `sync` creates `app.d/csp/` and two inert example files. `composeFilesForMode('test')` and `app.test.*` overlays, `registerComposeMode`, and `runInfraConformance({ appRoot })` at `@marinoscar/platform-infra/testing` (sync check, `docker compose config` per mode with the app's overlays, `nginx -t` over `app.d`; a missing tool is a passing case named with the reason). Run `npm run platform:infra:sync` to refresh `csp.conf` and `csp.dev.conf`.

- 8a0f3b9: Open the jobs and nodes vocabularies to an app (PP-14.19). Jobs: `registerRetentionPolicy` puts an app table on the nightly retention (the `retention` settings namespace is composed from the registry: schemas, defaults, merge and policy-by-policy read-compat; the platform's four keep their order and defaults, and the enqueue-only `RetentionPurgeTask` enqueues one purge per enabled policy whose handler is mounted); `registerJobReason` opens `jobs.reason`, with `reasonLabel` on the admin job row. Migration `0034_open_job_reason` turns `jobs.reason` from the `JobReason` enum into `TEXT`, keeping every stored value (apply it with `npm run db:sync`, then `prisma:migrate`; the table is rewritten under a short lock); `JobReason` becomes `BuiltinJobReason | (string & {})` and the contract's `reason` a pattern (`jobReasonSchema`), so the OpenAPI document shows a pattern where it showed an enum. Nodes: a heartbeat may carry `vitals.extra` (at most 16 numeric keys), `registerNodeVital` words them in the vitals dialog, which also lists the node's reported capabilities; relayed spans may be named `job.app.<name>` with attributes registered through `registerNodeSpanAttribute` (emitted as `job.app.<key>`), and a span that fails validation is now dropped and counted instead of failing its whole batch with a 400. CLI: `registerJobRequirement` and `registerProbedBinary` (with `versionArgs`) are exported from `@marinoscar/platform-cli/node` and used by the startup self-test and `node doctor`; `JobExecutor.vitals()` feeds `vitals.extra`. Back-compat: with only the built-ins nothing served changes; `JOB_REASONS` and `RETENTION_POLICY_KEYS` remain as deprecated aliases of `BUILTIN_JOB_REASONS` and `BUILTIN_RETENTION_POLICY_KEYS`. Upgrade the API before the nodes: an API that predates `vitals.extra` answers a heartbeat that carries it with a 400, and the CLI then stops sending vitals for the process.
- 74c4aff: Declare peer dependencies per slice (`packages/platform-slice-peers.json`, checked by `npm run check:slice-peers`) and make every peer that the universal slice does not need optional. `platform-api` now requires only what `core` needs (`@nestjs/common`, `@nestjs/core`, `@nestjs/swagger`, `@opentelemetry/api`, `@prisma/client`, `nestjs-zod`, `reflect-metadata`, `rxjs`, `zod`); `@nestjs/config`, `@nestjs/schedule`, `@nestjs/event-emitter`, `@nestjs/jwt`, `@nestjs/passport`, `passport`, `@nestjs/terminus` and `@prisma/client-runtime-utils` become optional peers an app installs for the slices that use them. `platform-web` requires only `@mui/material`, Emotion, `react` and `react-dom`; `@mui/icons-material`, `react-router-dom` and `zod` become optional. `platform-db` no longer lists `@prisma/client` (its seed takes the app's client structurally) and `prisma` becomes optional; `platform-cli`'s `react` becomes optional. An app that installed every peer needs no change; an app that imports only some slices can now install only their peers. The datatable no longer imports the undeclared transitive `@mui/utils`.
- 1171b1c: Complete the telemetry slice in all five packages. `@marinoscar/platform-api/telemetry/testing` gains the telemetry conformance suite (registered with `runPlatformConformance()` as `suites.telemetry`: metric groups, route permissions, read-only Doctor checks, no secrets in responses, the cron coverage and the boot without a store), the stub host ports, and the five activity and six coach fixture tables; `ConformanceCase.run` may be async and a slice may add a suite key by augmenting `PlatformConformanceSuiteOptions`. Every telemetry slice README now follows the Package documentation standard with a catalog that links a working example in the reference app.

### Patch Changes

- 1d8cbae: Add `@marinoscar/platform-api/host` (#867): `PlatformHostCoreModule.forRoot()` packages the API host core every slice assumed, moved from the reference app: the cross-replica event bus (`EVENT_BUS`, `in-process` or `postgres` by `EVENT_BUS_ADAPTER`, with its `core.event-bus` doctor check), the platform's `AppMetricsService` and app-metric declarations (`registerPlatformHostAppMetrics`), maintenance mode (`MaintenanceModeService`, `/api/admin/maintenance`, the `maintenance` settings namespace `MAINTENANCE_SYSTEM_SETTINGS`, the `maintenance.mode` doctor check and `MaintenanceGuard` as the only `APP_GUARD`), the `{ data }` envelope, the request log line, the exception filter and request ids; plus the OpenAPI document and `/api/docs` (`createOpenApiDocument`, `registerPlatformDocs`), and the `host` conformance suite (`@marinoscar/platform-api/host/testing`). `platform-cli`: a comment now names the packaged envelope interceptor.
- f6e319b: Documentation only: every slice README's Extension-point catalog links the new extension author guide (`docs/EXTENDING.md`); the email README no longer promises that a provider of `SmtpEmailProvider` in the app module replaces the transport (it does not reach the package's consumers; a transport registry is not supported yet); the AI READMEs say that a provider cannot be enabled from an app yet; the platform-db README documents `rlsPolicies` in `platform.lock` with the migration SQL for an app table protected by row-level security.
- 65d4522: Add the host About module and web slice: `@marinoscar/platform-api/host` now owns `GET /api/admin/about` (`AboutModule.forRoot({ apiVersion })`, `AboutService`, `readDeployInfo`, the `versions` support-bundle section; the database probe reads through `PLATFORM_PRISMA`), and `@marinoscar/platform-web/host/headless` and `/host/ui` own the About page, the admin Maintenance page, the public maintenance screen, the maintenance block store and recogniser and the `useAbout`, `useMaintenance` and `useMaintenanceBlock` hooks. The deploy-info fixture the CLI's tests read moved to `packages/platform-api/test/fixtures`.
- 6487697: Finish the identity slice move (#727): the reference app now imports identity only from `@marinoscar/platform-{api,web,contract}/identity`, so the web identity catalog's examples point at the app's real uses (`App.tsx`, and one example per data hook in `apps/web/src/identity/dataHookExamples.tsx`), the identity hook, page, guard and component suites the app kept run in `platform-web`'s own tests (with a `fakeIdentityApi` test helper), and comments naming the app's old identity paths point at the packages. No API change.
- Updated dependencies [a426fd8]
- Updated dependencies [b2df59a]
- Updated dependencies [823ec07]
- Updated dependencies [6a7af76]
- Updated dependencies [deeb8b5]
- Updated dependencies [a20f306]
- Updated dependencies [8bf9606]
- Updated dependencies [fa3f5b9]
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
- Updated dependencies [d1d1258]
- Updated dependencies [b46725d]
- Updated dependencies [f6e319b]
- Updated dependencies [fe73d7a]
- Updated dependencies [e6acb4b]
- Updated dependencies [2c4bf2c]
- Updated dependencies [c6f97da]
- Updated dependencies [6487697]
- Updated dependencies [a1f5999]
- Updated dependencies [e4ad7d5]
- Updated dependencies [94a63a2]
- Updated dependencies [b46d405]
- Updated dependencies [8a0f3b9]
- Updated dependencies [aeace4a]
- Updated dependencies [fce5417]
- Updated dependencies [48b275d]
- Updated dependencies [fe61ffe]
- Updated dependencies [b480c02]
- Updated dependencies [f994de1]
- Updated dependencies [346e661]
- Updated dependencies [9f4c147]
- Updated dependencies [d35900e]
- Updated dependencies [74c4aff]
- Updated dependencies [5e98e3d]
- Updated dependencies [5425626]
- Updated dependencies [175ddd3]
- Updated dependencies [1171b1c]
- Updated dependencies [2732024]
- Updated dependencies [39b5300]
- Updated dependencies [8246e10]
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
