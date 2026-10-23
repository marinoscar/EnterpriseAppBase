# `@marinoscar/platform-cli/deploy`

The deploy pipelines' extension surface: the step registry, the built-in step ids, a dry-run plan, `DeployHooks` (the only I/O seam), the fixed live-server literals and the env template helpers. CLI layer; part of `@marinoscar/platform-cli`; re-exports the `engine` slice.

## Purpose and scope

`deploy install` and `deploy update` are lists of steps. An app inserts its own with `registerDeployStep({ pipeline, id, after | before | replaces, step })` right after, right before or in place of a named step, or skips a built-in with `replaces` and `skipWhen`; `--resume`, the journal, `DeployHooks` and the TUI's progress view treat it like any other. `planDeploySteps(pipeline)` lists a pipeline without running it. `registerDeployCheck` adds a prerequisite check to `doctor` and the install and update preflight. `registerProxyStreamPath` (or `createCli({ proxy: { streamPaths } })`) makes the VPS host proxy stream an app route unbuffered, and `registerEdgeConfigFile` adds a single-file nginx mount to the stale-inode check of `deploy update`.

Built-in step ids (a stable surface; renaming one is a breaking change, adding one is not; the update pipeline gained `database-role` in #980). The install pipeline's `environment` step also provisions the application database role (`ensureApplicationRole`, see [the runbook](../../../../docs/runbooks/deploy-to-vps.md#21-the-database-login-a-dedicated-role)), so an app step placed `after: 'environment'` sees `.env` already holding the role's generated login, and a step never sees the administrative login it was created with.

- `install` (`INSTALL_STEP_IDS`): `preflight`, `checkout`, `environment`, `validate-environment`, `ensure-database`, `version`, `build`, `migrate`, `seed`, `start`, `health`, `deploy-info`, `proxy-bootstrap`, `publish`, `renewal`, `verify`, `publish-version`.
- `update` (`UPDATE_STEP_IDS`): `preflight`, `fetch`, `environment-drift`, `database-role`, `ensure-database`, `version`, `maintenance-on`, `build`, `migrate`, `seed`, `restart`, `maintenance-off`, `edge-config`, `health`, `deploy-info`, `publish`, `renewal`, `verify`, `publish-version`.

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

`registerDeployCheck(check)`: a `DeployCheck` (`id`, `title`, `severity`, optional `requires`, `run(context)`); the doctor contract applies (never throws, a `fail` has a `remedy`, read-only). `run` gets a `DeployCheckContext`: `deployRoot`, `bindPort`, `composeProject?`, `proxyRoot`, `domain`, `skipProxy` and an `env` view that withholds secrets, like a step's. `composeProject` is the deployment's compose project (`compose` for a legacy install, absent before any state exists): use it, not `basename(deployRoot)`, to recognise the deployment's own containers, and fall back to the folder name only when it is absent. `registerProxyStreamPath(path | { path, timeoutSeconds })`: validated (leading `/`, letters, digits and `. _ ~ / : @ + , = -`); `renderVhost` adds an unbuffered location per path with the platform's SSE directives and a one-hour default timeout. `registerEdgeConfigFile({ checkout, container })`: relative checkout path, plain absolute container path.

## Extension-point catalog

The extension ladder and a recipe per extension: [docs/EXTENDING.md](../../../../docs/EXTENDING.md).

| Name | Kind | Signature | When to use | Stability | Example |
|---|---|---|---|---|---|
| `registerDeployStep` | registry | `registerDeployStep(registration: DeployStepRegistration): void` | Do one more thing in `deploy install` or `update` (EvoPath's Android APK release), before or in place of a built-in step, or skip one, without forking the pipeline | experimental | [example](../../../../apps/cli/src/examples/announce.deploy-step.ts), [placement](../../../../apps/cli/src/examples/coach.deploy-step-placement.ts) |
| `registerDeployCheck` | registry | `registerDeployCheck(check: DeployCheck): void` | Add an app prerequisite to `doctor` and the install and update preflight; `required` blocks a deploy | experimental | [example](../../../../apps/cli/src/examples/coach.deploy-check.ts) |
| `registerProxyStreamPath` | registry | `registerProxyStreamPath(entry: string \| ProxyStreamPathRegistration): void` | Stream an app SSE route unbuffered through the VPS host proxy instead of buffering and cutting it at 60 s | experimental | [example](../../../../apps/cli/src/examples/coach.proxy-stream.ts) |
| `registerEdgeConfigFile` | registry | `registerEdgeConfigFile(file: EdgeConfigFile): void` | Add the app's own single-file nginx bind mount to the stale-inode check `deploy update` runs | experimental | [example](../../../../apps/cli/src/examples/coach.edge-config.ts) |

Also exported: `listDeployCheckIds`, `edgeConfigFiles`, `listRegisteredProxyStreamPaths`, `metadataFor` and `effectiveGroups` (for app tests), `INSTALL_STEP_IDS` and `UPDATE_STEP_IDS` (stable), `planDeploySteps`, `listRegisteredDeploySteps`, `DeployHooks`, `DEPLOY_STATE_FILENAME` and `PROXY_MANAGED_SENTINEL` (stable, fixed), `parseEnvExample`, `composeEnvSpecs`, `commentedAssignments` and `PLATFORM_DOCUMENTED_OPTIONAL_KEYS`.

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
