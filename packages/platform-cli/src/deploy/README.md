# `@marinoscar/platform-cli/deploy`

The deploy pipelines' extension surface: the step registry, the built-in step ids, a dry-run plan, `DeployHooks` (the only I/O seam), the fixed live-server literals and the env template helpers. CLI layer; part of `@marinoscar/platform-cli`; re-exports the `engine` slice.

## Purpose and scope

`deploy install` and `deploy update` are lists of steps. An app inserts its own with `registerDeployStep({ pipeline, id, after | before | replaces, step })` right after, right before or in place of a named step, or skips a built-in with `replaces` and `skipWhen`; `--resume`, the journal, `DeployHooks` and the TUI's progress view treat it like any other. `planDeploySteps(pipeline)` lists a pipeline without running it. `registerDeployCheck` adds a prerequisite check to `doctor` and the install and update preflight. `registerProxyStreamPath` (or `createCli({ proxy: { streamPaths } })`) makes the VPS host proxy stream an app route unbuffered, and `registerEdgeConfigFile` adds a single-file nginx mount to the stale-inode check of `deploy update`.

Built-in step ids (a stable surface; renaming one is a breaking change, adding one is not; the update pipeline gained `database-role` in #980, and both pipelines gained `stack-ports` in #1024). The install pipeline's `environment` step also provisions the application database role (`ensureApplicationRole`, see [the runbook](../../../../docs/runbooks/deploy-to-vps.md#21-the-database-login-a-dedicated-role)), so an app step placed `after: 'environment'` sees `.env` already holding the role's generated login, and a step never sees the administrative login it was created with.

- `install` (`INSTALL_STEP_IDS`): `preflight`, `checkout`, `environment`, `validate-environment`, `stack-ports`, `ensure-database`, `version`, `build`, `migrate`, `seed`, `start`, `health`, `deploy-info`, `proxy-bootstrap`, `publish`, `renewal`, `verify`, `publish-version`.
- `update` (`UPDATE_STEP_IDS`): `preflight`, `fetch`, `environment-drift`, `stack-ports`, `database-role`, `ensure-database`, `version`, `maintenance-on`, `build`, `migrate`, `seed`, `restart`, `maintenance-off`, `edge-config`, `health`, `deploy-info`, `publish`, `renewal`, `verify`, `publish-version`.

Not in scope: the compose file list (`@marinoscar/platform-infra`'s `composeFilesForMode`) and the built-in steps' internals.

## Install and peer dependencies

Ships inside `@marinoscar/platform-cli`:

```ts
import { planDeploySteps, registerDeployStep, type DeployStepRegistration } from '@marinoscar/platform-cli/deploy';
```

None beyond the package's own.

## Quick start

The reference example, [`announce.deploy-step.ts`](../../../../apps/cli/src/examples/announce.deploy-step.ts):

```ts
export const announceInstall: DeployStepRegistration = {
  pipeline: 'install',
  id: 'announce',
  after: 'verify',
  step: {
    title: 'Announce the deployment',
    skip: (context) => (context.commitSha === undefined ? 'no commit recorded' : undefined),
    async run(context) {
      const { stdout } = await context.exec(['git', 'log', '-1', '--format=%s'], { cwd: context.checkoutPath });
      context.log(`Deployed ${context.commitSha ?? ''}: ${stdout.trim()}`);
    },
  },
};
createCli({ ...APP_CLI_OPTIONS, deploySteps: [announceInstall] });
planDeploySteps('install'); // [..., 'verify', 'announce', 'publish-version']
```

## Configuration

`DeployStepRegistration`: `pipeline` (`install` or `update`), `id` (unique in the pipeline, lowercase `[a-z0-9-]`, recorded for `--resume`), exactly one anchor (`after`, `before` or `replaces`: a built-in id or an earlier app step of the pipeline; two steps after one target keep registration order), `skipWhen` (with `replaces`: skip the replaced step when it returns true; with no `step`, a conditional skip of the built-in) and `step` (`title`, optional `skip`, `run`). Replacing or skipping a built-in is the app's responsibility, because later built-ins read what earlier ones prepared.

The step's `DeployStepContext`: `pipeline`, `deployRoot`, `checkoutPath` (`<deployRoot>/repo`), `commitSha`, `hooks`, `env` and `answers` (read-only `DeployStepValues`: `has`, `get`, `keys`; a secret key, annotated or named like one, is present but `get` returns `undefined`), `log(line)`, `progress(message)` and `exec(argv, { cwd, timeoutMs, allowExitCodes })`, which runs a command journaled and redacted like a built-in step's and throws on an unexpected exit code.

`registerDeployCheck(check)`: a `DeployCheck` (`id`, `title`, `severity`, optional `requires`, `run(context)`); the doctor contract applies (never throws, a `fail` has a `remedy`, read-only). `run` gets a `DeployCheckContext`: `deployRoot`, `bindPort`, `composeProject?`, `proxyRoot`, `domain`, `skipProxy` and an `env` view that withholds secrets, like a step's. `composeProject` is the deployment's compose project (the recorded one, confirmed against Docker before `update`, `status` and `doctor` when none is recorded; `compose` only when nothing says otherwise; absent before any state exists): use it, not `basename(deployRoot)`, to recognise the deployment's own containers, and fall back to the folder name only when it is absent. `registerProxyStreamPath(path | { path, timeoutSeconds })`: validated (leading `/`, letters, digits and `. _ ~ / : @ + , = -`); `renderVhost` adds an unbuffered location per path with the platform's SSE directives and a one-hour default timeout. `registerEdgeConfigFile({ checkout, container })`: relative checkout path, plain absolute container path.

## Extension-point catalog

The extension ladder and a recipe per extension: [docs/EXTENDING.md](../../../../docs/EXTENDING.md).

| Name | Kind | Signature | When to use | Stability | Example |
|---|---|---|---|---|---|
| `registerDeployStep` | registry | `registerDeployStep(registration: DeployStepRegistration): void` | Do one more thing in `deploy install` or `update` (EvoPath's Android APK release), before or in place of a built-in step, or skip one, without forking the pipeline | experimental | [example](../../../../apps/cli/src/examples/announce.deploy-step.ts), [placement](../../../../apps/cli/src/examples/coach.deploy-step-placement.ts) |
| `registerDeployCheck` | registry | `registerDeployCheck(check: DeployCheck): void` | Add an app prerequisite to `doctor` and the install and update preflight; `required` blocks a deploy | experimental | [example](../../../../apps/cli/src/examples/coach.deploy-check.ts) |
| `registerProxyStreamPath` | registry | `registerProxyStreamPath(entry: string \| ProxyStreamPathRegistration): void` | Stream an app SSE route unbuffered through the VPS host proxy instead of buffering and cutting it at 60 s | experimental | [example](../../../../apps/cli/src/examples/coach.proxy-stream.ts) |
| `registerEdgeConfigFile` | registry | `registerEdgeConfigFile(file: EdgeConfigFile): void` | Add the app's own single-file nginx bind mount to the stale-inode check `deploy update` runs | experimental | [example](../../../../apps/cli/src/examples/coach.edge-config.ts) |

Also exported: `detectComposeProject` and `isPathUnder` (experimental: ask Docker which compose project owns the containers started from inside a deployment folder, deciding by the strongest evidence with `{ bindPort }` as the first, and test by path segment whether a path is that folder or below it; an app check can use them instead of carrying its own copy), `listDeployCheckIds`, `edgeConfigFiles`, `listRegisteredProxyStreamPaths`, `metadataFor` and `effectiveGroups` (for app tests), `INSTALL_STEP_IDS` and `UPDATE_STEP_IDS` (stable), `planDeploySteps`, `listRegisteredDeploySteps`, `DeployHooks`, `DEPLOY_STATE_FILENAME` and `PROXY_MANAGED_SENTINEL` (stable, fixed), `parseEnvExample`, `composeEnvSpecs`, `commentedAssignments` and `PLATFORM_DOCUMENTED_OPTIONAL_KEYS`, and the types `ComposeProjectDetection` (a `found` carries the `basis`, `ComposeProjectBasis`, that decided it), `ComposeContainer` and `ComposePortBinding` (a container now carries its `bindings`, the host address and protocol of each published port) and `ComposeProjectCommandRunner` (the command seam, structurally the engine's `runCommand`; all experimental).

**Compose project reconciliation.** Before `deploy update`, `status` and `doctor` (and the TUI doctor), and on `install --resume` / `--reinstall`, the engine confirms the compose project against Docker when the state records none or the legacy `compose`. A deploy folder can hold containers of two projects (the live stack and leftovers of the legacy `compose`), so the project is picked by the strongest evidence among the containers started inside the deploy root: the one that publishes the bind port (running first), then the only one with a running container, then the only one. It is recorded in `.appctl-deploy.json` (the previous file is kept once as `.appctl-deploy.json.bak`, mode `0600`). Nothing decisive keeps the record and prints a warning naming the projects and the state file. A recorded non-legacy project is never overwritten; a warning is printed when another project holds the bind port. A failed `install` no longer writes the assumed `compose` as a record. `uninstall` and `deploy about` are deliberately not reconciled. This is what lets `bind-port-free` recognise the deployment's own `<app>-nginx-1`.

**Bind port owner.** The required built-in check `bind-port-owner` (the `update` and `install` preflight and `doctor`) fails when any container, in any state, publishes the bind port under a compose project other than the one the run passes to `-p`, before anything is built; its remedy names the `composeProject` fix in the state file and the command that removes the leftovers. A stopped leftover of the deploy folder only warns when a running container of the run's own project holds the port. The recommended `stray-compose-stack` warns, in `doctor` only, about containers of another project started from the deploy root. Neither removes anything. An app check that only compared the port holder's project can be dropped.

**Stack ports.** `bind-port-owner` looks at one port, but `up -d` recreates web, api and nginx before it reaches a service whose OTHER host port is taken (greptimedb's `127.0.0.1:14003`, which every app's telemetry stack defaults to), and the site stays down. The required built-in check `stack-ports-free` (the `update` and `install` preflight and `doctor`) renders the stack with `docker compose config --format json` under the run's own project, files and `.env`, and fails before anything is built when a published host port is held by a container of another project in any state, or by a process outside Docker. The failure names the port, the service, the holder and the fix: the `.env` variable that sets the port (derived from the compose files, such as `GREPTIME_BIND_PG_PORT`), or, for a leftover of the deploy folder, the `composeProject` fix and the command that removes it. A stopped container of another stack only warns while the run's own container holds the port; the main bind port's container question stays with `bind-port-owner`. Because the preflight sees the checkout and `.env` before `fetch`, `environment-drift` and (on install) the environment step change them, both pipelines also run the `stack-ports` step with the final files, before the first step that can touch a container; that step is not skipped by `--skip-doctor`, `--force` or `--resume`. A stack that cannot be rendered fails the step with compose's error. The check changes nothing and skips when Docker cannot be asked.

## Data

None in a database. On the server: the deploy state file `<deployRoot>/.appctl-deploy.json` (its name is fixed), the run journals under `<deployRoot>/logs/` and the deploy-info document the API's About page reads.

## Permissions and settings

None. A deploy runs as the operator on the server; it holds no API permission.

## UI

None in the web app. `DeployHooks` feeds both the CLI's line renderer and the TUI's deploy screen.

## Infra

The wizard's questions come from `infra/compose/.env.example`, composed by `platform-infra sync` from the platform base, each slice's and the app's `app.env.example` fragment, in that order (`composeEnvSpecs` is the same composition over the fragments' text). ⚠ A commented `# KEY=value` line is a declaration; only the platform base documents optional keys (`PLATFORM_DOCUMENTED_OPTIONAL_KEYS`).

## Observability

Every run writes `<name>-<command>-<timestamp>.log` (human, redacted) and `.jsonl` (structured) under `<deployRoot>/logs/`; an app step's lines and commands are in both.

## Security notes

- `DeployHooks` is the only I/O seam: a step never writes to `process.stdout`.
- Every message and output line of an app step is redacted with the run's secrets before it reaches the journal or the hooks.
- `DEPLOY_STATE_FILENAME` and `PROXY_MANAGED_SENTINEL` stay `appctl` whatever the identity: live servers parse them.

## Conformance suite

The env template rule runs in the `cli` suite ([`/testing`](../testing/README.md#conformance-suite)); `registry.test.ts` in the package pins the built-in ids against the real pipelines.

## Upgrade notes

0.x: replaces editing `install.ts` / `update.ts` in a forked CLI (#715).

## Troubleshooting

- `runs after "x", which is not a step of the install pipeline`: use an id from the lists above (`fetch` is update-only, `checkout` install-only).
- `is already a step of the update pipeline`: the id is taken by a built-in or an earlier app step.

## Links

- [Package README](../../README.md)
- [Platform packages spec: worked examples, CLI](../../../../docs/specs/platform-packages.md#cli)
- [Package documentation standard](../../../../docs/PACKAGES.md)
