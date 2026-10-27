# @marinoscar/platform-cli

## 0.1.0-next.19

### Patch Changes

- Updated dependencies [2cbffde]
  - @marinoscar/platform-contract@0.1.0-next.19
  - @marinoscar/platform-infra@0.1.0-next.19

## 0.1.0-next.18

### Patch Changes

- bca937b: Example names in doc comments, README examples and schema examples are replaced with invented placeholders (Org Kappa, Org Sigma, Org Theta and similar) instead of well-known fictional brands. No behaviour change.
- Updated dependencies [1687d34]
- Updated dependencies [bca937b]
  - @marinoscar/platform-contract@0.1.0-next.18
  - @marinoscar/platform-infra@0.1.0-next.18

## 0.1.0-next.17

### Patch Changes

- 331eee4: The CLI can tell the operator a newer version exists. `createCli({ updateNotice: { latestVersion, upgradeHint, intervalMs?, timeoutMs? } })` (type `UpdateNoticeOptions`, experimental) checks when the CLI starts and, when the newest version is semver-greater than the running one, writes one line to stderr after the command's output: `<cli> <latest> is available (you have <current>). Update: <upgradeHint>`. Operators ran an old app CLI on servers without knowing a newer one had fixed the failure in front of them.

  Unset means off: an app that does not pass the option makes no request and is unchanged. The check starts in parallel with the command and is never awaited before it; at the end the CLI waits only for what remains of `timeoutMs` (default 1500 ms from the start). At most one network check per `intervalMs` (default 24 hours), cached in `~/.<cli>/update-check.json` (`{ checkedAt, latest }`, written atomically with mode 0600; a missing or corrupt file is a new check; a failed check is recorded with the last known version, so an offline server does not retry on every command). Failure, timeout, a throwing or hanging `latestVersion` and any version that is not strict semver 2.0.0 (prereleases ordered by the spec) are silent, and the exit code and stdout never change. The interactive menu shows the line once, when it exits.

  Never shown: when `CI` is set, when stderr is not a terminal, for `--json`, `--version`/`-v`, `--help`/`-h` and `help`, for the worker daemon `node start`, or when `<PREFIX>_NO_UPDATE_CHECK=1` is set (`APPCTL_NO_UPDATE_CHECK`, the prefix from the CLI identity). `createCli` validates the option (a `latestVersion` function, a non-empty single-line `upgradeHint`, a non-negative `intervalMs`, a positive `timeoutMs`) and throws a `UsageError` otherwise. `RunOptions` gains `updateCheck` (environment, home directory, stderr and clock) as a test seam.

  New helper `githubRawManifest({ repo, ref = 'main', path, timeoutMs = 1500, fetch? })` builds a `latestVersion` that reads `version` from `https://raw.githubusercontent.com/<repo>/<ref>/<path>`: HTTPS only, no credentials, no redirects, the body capped at 256 KiB, only a valid semver `version` accepted, everything else `undefined`; `repo` must be `owner/name` and `ref` / `path` plain relative paths (a `UsageError` when it is built). `latestVersion` receives an `AbortSignal` that `createCli` aborts at the deadline. Docs: the CLI README (options table, a section and the extension-point catalog), `docs/EXTENDING.md` and the reference app's example `coach.update-notice.ts` (not wired).

  - @marinoscar/platform-contract@0.1.0-next.17
  - @marinoscar/platform-infra@0.1.0-next.17

## 0.1.0-next.16

### Patch Changes

- bdf831e: An app now chooses which manifests the deploy `version` step writes: `createCli({ deploy: { versionedManifests } })` (type `CreateCliDeployOptions`). The list was closed (`apps/api`, `apps/web`, `apps/cli`, `packages/shared`), so an app whose CLI keeps its own version had it overwritten by every release; a production `chore(release): 1.2.3` moved such a CLI from 1.10.7 to 1.2.3. Default: the same four, so an app that does not set the option is unchanged.

  The first listed manifest is the version source: `currentVersion` reads it (so the suggested patch bump and the forward-only check follow it), `writeVersion` writes only the listed manifests, and the `package-lock.json` workspace update touches only the listed workspaces, textually and in the same single commit as before. A manifest left out and its lockfile entry are byte for byte untouched, and the step's journal line now names the files it wrote (`wrote 1.2.3 to apps/api/package.json, ..., package-lock.json and committed`) instead of a count. The list is validated when the CLI is built: at least one entry, repository-relative POSIX paths ending in `package.json` under a directory, no `..`, no duplicates, no root manifest; `createCli` throws a `UsageError` otherwise. `runVersionStep` also takes an optional `manifests` for a caller that holds its own list. Docs: the CLI README, the deploy README, `docs/specs/vps-deploy.md`, `docs/EXTENDING.md` and a new runbook section, "An app whose CLI keeps its own version".

  - @marinoscar/platform-contract@0.1.0-next.16
  - @marinoscar/platform-infra@0.1.0-next.16

## 0.1.0-next.15

### Patch Changes

- 7d883b4: `deploy install` and `deploy update` pick free host ports for the published-port variables they write, instead of every app on a server sharing `APP_BIND_PORT=3535` and `GREPTIME_BIND_PG_PORT=14003`. The second app on a host used to be stopped by `stack-ports-free` (#1024) and the operator had to hand-edit `.env`.

  A port is free when no container in any state is configured to publish it on an overlapping address and protocol (the source `stack-ports-free` uses), nothing listens on it (the loopback bind probe of `bind-port-free`), and no other variable of the same run has it. The search starts at the template default and walks upward (200 tries, never above 65535), so a lone app keeps the familiar numbers and prints nothing extra; a pick that moved is printed and journaled with its holder, such as `GREPTIME_BIND_PG_PORT=14013 (14003 is held by evopath-greptimedb-1)`. When Docker cannot be asked the search is probe-only. The variables are derived from the compose files in the checkout (the same raw scan that names the variable in a `stack-ports-free` remedy, now also run in the other direction), so an app overlay that publishes a new port is covered with no list to keep.

  An existing value is never moved. `install` decides every published-port variable the `.env` and the answers do not already carry; over an existing `.env` (`--reinstall`, `--resume`) that means only the missing keys. `update` decides only the keys `environment-drift` is adding (the telemetry ports on a deployment created before they existed); a key already in `.env` keeps its value, and `stack-ports-free` still reports a clash on it with the fix. `APP_BIND_PORT` follows `--port` when it is passed (and still fails the preflight when taken); without `--port` a fresh install picks it from 3535, and the `.env`, the state's `bindPort`, `deploy-info`, the vhost, the health probe and the final summary all use the chosen value. A deployment whose `.env` already has `APP_BIND_PORT` keeps it when `--port` is not passed.

  `stack-ports-free` no longer fails the preflight of a run that may still write the `.env` (`CheckContext.environmentPending`) on a port whose variable the existing `.env` does not set: it passes with a note and the `stack-ports` step judges the final file, before any container is touched. This is what lets the update of a deployment from before the telemetry stack reach the step that gives the key a free port. A key the `.env` has, `doctor`, and the `stack-ports` step still fail.

  `InstallOptions` gains `bindPortIsDefault` (the command sets it from commander's value source when `--port` was not passed; the install TUI sets it for a new deployment left on the default port) and `portFree`, a test seam for the listener probe that `InstallOptions` and `UpdateOptions` both take.

  - @marinoscar/platform-contract@0.1.0-next.15
  - @marinoscar/platform-infra@0.1.0-next.15

## 0.1.0-next.14

### Patch Changes

- e19b705: `deploy update` no longer recreates a running stack into a host-port clash. Telemetry is always on, and `vps.telemetry.compose.yml` publishes a second host port, `127.0.0.1:${GREPTIME_BIND_PG_PORT:-14003}`, that every app on the host shares by default. `docker compose up -d` recreated web, api and nginx and only then failed on `Bind for 127.0.0.1:14003 failed: port is already allocated`, leaving the site down; `bind-port-owner` and `bind-port-free` only looked at the bind port.

  New required check `stack-ports-free` (the `update` and `install` preflight, and `doctor`). It renders the stack with `docker compose config --format json` under the run's own project, files and `.env`, and fails before anything is built when any published host port is held by a container of another compose project in any state, or by a process outside Docker. The failure names the port, the service, the holder and the fix: the `.env` key that sets the port (derived from the compose files, such as `GREPTIME_BIND_PG_PORT`, with the path of the `.env`), or, for a leftover started from the deploy folder, the `composeProject` fix and the exact `docker ps -aq ... | xargs -r docker rm -f` command. Containers of the run's own project are fine, a stopped container of another stack only warns while the run's own container holds the port, and the bind port's container question stays with `bind-port-owner`. A stack that cannot be rendered fails with compose's error; Docker unreachable skips. Nothing is removed or changed.

  New `stack-ports` step in both pipelines (`INSTALL_STEP_IDS`, `UPDATE_STEP_IDS`): the preflight sees the checkout and `.env` before the run changes them, so the question is asked again with the final files, in `update` after `environment-drift` and before `database-role` (the first step that can recreate a container), in `install` after `validate-environment`. It is not skipped by `--skip-doctor`, `--force` or `--resume`. `install` does not choose a free `GREPTIME_BIND_PG_PORT` (it does not choose `APP_BIND_PORT` either); a second app on the host now fails with the variable to set in the `.env`.

  `ComposeContainer` gains `bindings` (the host address and protocol of each published port) and `publishesPort` takes an optional address and protocol to match. `CheckContext` gains `groups` and `environmentPending`.

  - @marinoscar/platform-contract@0.1.0-next.14
  - @marinoscar/platform-infra@0.1.0-next.14

## 0.1.0-next.13

### Patch Changes

- 1da0964: `deploy update` no longer starts a second stack when the deploy folder holds containers of two compose projects. A folder with the live stack under an app-named project (for example `kvox-nginx-1` on the bind port) and leftover containers of the legacy `compose` project was read as ambiguous and kept `compose`, so `docker compose -p compose up -d` built a parallel stack that died on `Bind for 127.0.0.1:3535 failed: port is already allocated`. The project is now picked by the strongest evidence among the containers started from the deploy folder: the project whose container publishes the bind port (running containers first), then the only project with a running container, then the only project, and is recorded in `.appctl-deploy.json` when the state has none or the legacy `compose`. When nothing separates the projects the record is kept and a warning names the projects and the state file; a recorded project is never overwritten, but a warning is printed when another project holds the bind port. `install --resume` and `--reinstall` reconcile the same way before their first compose or check call. `detectComposeProject` takes an optional `{ bindPort }` and a `found` result carries the `basis` that decided it (`bind-port`, `running` or `only`).

  New required check `bind-port-owner` (the `update` and `install` preflight, and `doctor`): any container in any state that publishes the bind port under a compose project other than the one the run would use fails the run before anything is built, naming both projects, the `composeProject` fix in the state file and the exact `docker ps -aq ... | xargs -r docker rm -f` command for leftovers; a port promised to an unrelated container points to `--port`. New recommended check `stray-compose-stack` warns in `doctor` about containers of another project started from the deploy folder, with the same removal command. A stopped leftover of the deploy folder is only a warning (printed during `update`, with the removal command) when a running container of the run's own project holds the port; a running foreign container, or a stopped one with no live own holder, still fails. Neither check removes anything. The `update` preflight failure now prints each failed check's remedy, as `install` does. Apps that carry their own copy of a "port promised to another project" check can drop it.

  - @marinoscar/platform-contract@0.1.0-next.13
  - @marinoscar/platform-infra@0.1.0-next.13

## 0.1.0-next.12

### Patch Changes

- d4de0e7: `deploy update`, `status` and `doctor` (and the TUI doctor) now ask Docker which compose project a deployment's containers run under when the state records none, or only the legacy `compose`, and record it. A deployment installed with an app-named project (`myapp-nginx-1`) was read as `compose`: the app's port check refused its own nginx, and every `docker compose -p compose` call would have started a second stack on the bind port. The project is the `com.docker.compose.project` label of containers whose `com.docker.compose.project.working_dir` is inside the deploy root. A recorded non-legacy project is never overwritten and Docker is not asked; the previous state file is kept once as `.appctl-deploy.json.bak`; an ambiguous answer writes nothing and warns; Docker being unavailable changes nothing. A failed `install` attempt no longer writes the assumed `compose` into the state as if it were a record. New on `@marinoscar/platform-cli/deploy`: `detectComposeProject`, `isPathUnder` and the types `ComposeProjectDetection` and `ComposeProjectCommandRunner`, so an app's own check can use the same ground truth instead of carrying a copy.
  - @marinoscar/platform-contract@0.1.0-next.12
  - @marinoscar/platform-infra@0.1.0-next.12

## 0.1.0-next.11

### Patch Changes

- f8b2aeb: Deploy checks now know the deployment's compose project: `CheckContext` and the narrow `DeployCheckContext` handed to `registerDeployCheck` carry `composeProject` (the recorded project, `compose` for a deployment installed before it was recorded). `bind-port-free` recognises its own containers by that project instead of the folder name, so a legacy-project deployment is no longer refused by its own `compose-nginx-1` during `update` or `doctor`.
  - @marinoscar/platform-contract@0.1.0-next.11
  - @marinoscar/platform-infra@0.1.0-next.11

## 0.1.0-next.10

### Patch Changes

- aa70c0f: `deploy update` no longer treats a deployment as up to date just because the checkout did not move. `fetch` moves the checkout before build, migrate and restart, so after a failed run the next plain `update` found "nothing to do", skipped the environment drift heal, the build, the migration and the maintenance-off, and exited 0. The state now records `deployedHead` (the checkout HEAD when the last install or update SUCCEEDED, an optional field, so older state files read as before) and an update is a no-op only when the checkout did not move AND is still at that revision; an unchanged remote after a successful run stays a cheap no-op, including after a version bump that was pushed or rolled back. The rollback hint printed on failure names the last successfully deployed revision instead of the broken one, and `previousSha` and the history entry record it too.

  A compose `required variable X is missing a value` refusal (update, install, uninstall and `deploy status`) now carries a plain-language hint: the CLI predates the revision or the `.env` lacks the key, and the exact recovery commands. A new test pins that every `${VAR:?}` in the shipped compose files is generated or recorded by the CLI.

  A deployment whose CLI is older than this fix still needs that CLI updated first; it cannot be healed from the application side.

  - @marinoscar/platform-contract@0.1.0-next.10
  - @marinoscar/platform-infra@0.1.0-next.10

## 0.1.0-next.9

### Patch Changes

- @marinoscar/platform-contract@0.1.0-next.9
- @marinoscar/platform-infra@0.1.0-next.9

## 0.1.0-next.8

### Patch Changes

- @marinoscar/platform-contract@0.1.0-next.8
- @marinoscar/platform-infra@0.1.0-next.8

## 0.1.0-next.7

### Patch Changes

- @marinoscar/platform-contract@0.1.0-next.7
- @marinoscar/platform-infra@0.1.0-next.7

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
