# @marinoscar/platform-cli

The platform's command-line client, as a package an app composes rather than forks: the `init`, `login`, `api`, `config`, `node` and `deploy` commands, the ink TUI, the VPS deploy pipeline and the worker-node engine, built by one `createCli({ identity, version, ... })` call that the app's `src/cli.ts` makes. CLI layer; ESM with `sideEffects: false`; runs on Node 20 or later. Consumed by every app's own CLI binary (the reference app's is `appctl`, in `apps/cli`).

## Purpose and scope

`createCli` builds an app's CLI from its identity and the registries. The identity (executable name, display name, repository) is configuration: the config directory (`~/.<name>`), the env prefix (`<NAME>_`), the systemd unit (`<name>-node.service`) and every help text follow it, read at call time. Two strings never follow it, because live servers already have them: the deploy state file `.appctl-deploy.json` and the proxy sentinel `# Managed by appctl deploy`.

An app extends the CLI through five registries instead of editing it: commands and env-spec fragments ([`/core`](src/core/README.md)), TUI screens ([`/tui`](src/tui/README.md)), deploy steps ([`/deploy`](src/deploy/README.md)) and node executors ([`/node`](src/node/README.md)).

The package does not own the app's binary name (npm reads the `bin` key before any code runs, so the app's `package.json` carries it), its product identity (`@app/shared` stays in the app; the identity arrives through `createCli`), or app-specific commands.

Subpath exports, each with its own README:

| Subpath | Contents | README |
|---|---|---|
| `@marinoscar/platform-cli` | `createCli`, `run`, the identity accessors, `EXIT` and `formatError` | this file |
| `/core` | `registerCliCommand`, `registerEnvSpecFragment` and the env-key metadata helpers | [core](src/core/README.md) |
| `/commands` | The six built-in command registrars and the error model | [commands](src/commands/README.md) |
| `/tui` | `registerTuiScreen` and the built-in screen order | [tui](src/tui/README.md) |
| `/deploy` | `registerDeployStep`, the built-in step ids, `planDeploySteps`, `DeployHooks`, the env template helpers | [deploy](src/deploy/README.md) |
| `/node` | `JobExecutor`, `ExecutorRegistry`, `registerNodeExecutor` | [node](src/node/README.md) |
| `/api-client` | `ApiClient`, `resolveApiBaseUrl` and the API errors | [api-client](src/api-client/README.md) |
| `/telemetry` | The worker's span relay and the telemetry env-spec fragment | [telemetry](src/telemetry/README.md) |
| `/testing` | Identity and registry reset, the credential-hygiene check, `runPlatformConformance` | [testing](src/testing/README.md) |

The implementation lives in one internal slice (`src/engine/`), which is not a subpath export: the entry points above re-export the parts they publish, and nothing may import a file inside it.

## Install and peer dependencies

```bash
npm install @marinoscar/platform-cli react
```

`commander`, `ink`, `ink-select-input`, `ink-spinner`, `ink-text-input` and `@marinoscar/platform-infra` are regular dependencies. The single-instance library the app must install itself (React 19 keeps one hooks dispatcher per copy, and ink renders through it):

| Package | Range |
|---|---|
| `react` | `^19.2.8` (optional peer in the manifest, needed by the `engine` slice and so by every entry that renders or runs it; `ink` brings it in anyway) |

An app that writes its own TUI screen also depends on `ink` (`^7.1.1`), at the same version the package resolves.

## Quick start

The reference app's whole entry point ([`apps/cli/src/cli.ts`](../../apps/cli/src/cli.ts)), with its options in [`apps/cli/src/app.ts`](../../apps/cli/src/app.ts):

```ts
#!/usr/bin/env node
import { createCli, EXIT, exitCodeFor, formatError } from '@marinoscar/platform-cli';

import { APP_CLI_OPTIONS } from './app.js'; // { identity: CLI_IDENTITY, version: CLI_VERSION, extraCommands: [] }

async function main(): Promise<void> {
  let cli: ReturnType<typeof createCli>;
  try {
    cli = createCli(APP_CLI_OPTIONS);
  } catch (error) {
    process.stderr.write(`${formatError(error)}\n`);
    process.exitCode = exitCodeFor(error);
    return;
  }
  // Set exitCode and return; never process.exit(), which truncates piped output.
  process.exitCode = await cli.run(process.argv.slice(2));
}
process.on('unhandledRejection', (reason) => {
  process.stderr.write(`${formatError(reason)}\n`);
  process.exitCode = EXIT.FAILURE;
});
void main();
```

`run` keeps the CLI's semantics: no arguments opens the TUI in a real terminal and is a usage error (help on stderr, `EXIT.USAGE`) anywhere else; `--help` and `--version` exit 0; `--version` prints `<app version> (platform <this package's version>)`.

## Configuration

`createCli(options)`:

| Option | Type | Default | Meaning |
|---|---|---|---|
| `identity` | `CliIdentity` | required | `name` (lowercase `[a-z0-9-]`, e.g. `appctl`), `displayName` (`Acme CLI`), `repoSlug` (`owner/repo`); optional `productName` (the systemd unit's Description; defaults to `displayName`), `configDirName` (defaults to `.<name>`), `envPrefix` (defaults to `toEnvPrefix(name)`, `APPCTL_`). Set once per process; a different second identity throws. |
| `version` | `string` | required | The app's own version (its `package.json`). |
| `extraCommands` | `CliCommandRegistration[]` | `[]` | Commands after the built-ins, in order. Same as `registerCliCommand`. |
| `tuiScreens` | `TuiScreenRegistration[]` | `[]` | Screens in the TUI menu. Same as `registerTuiScreen`. |
| `deploySteps` | `DeployStepRegistration[]` | `[]` | Steps inserted into `deploy install` / `update`. Same as `registerDeployStep`. |
| `nodeExecutors` | `JobExecutor[]` | `[]` | Executors for the app's node-eligible job types. Same as `registerNodeExecutor`. |
| `envSpecFragments` | `EnvSpecFragment[]` | `[]` | Metadata for the app's `.env.example` keys. Same as `registerEnvSpecFragment`. |

The options and the `register*` functions feed the same registries: string ids, a duplicate-id error, a deterministic order (built-ins first, then registration order), and frozen when `createCli` returns, so a late registration throws instead of going missing. A broken composition (a taken command name, TUI route, deploy step id or executor type; a step after an unknown step; an env key with two owners) throws at `createCli`.

## Extension-point catalog

| Name | Kind | Signature | When to use | Stability | Example |
|---|---|---|---|---|---|
| `CreateCliOptions` | option | `createCli(options: CreateCliOptions): CliInstance` | Build the app's CLI: its identity and version, plus its commands, TUI screens, deploy steps, node executors and env-spec fragments | experimental | [example](../../apps/cli/src/app.ts) |

The registries are catalogued by the entry point that exports them, each with a compiled, tested example in the reference app:

| Registry | Entry point | Example |
|---|---|---|
| `registerCliCommand` | [`/core`](src/core/README.md#extension-point-catalog) | [`hello.command.ts`](../../apps/cli/src/examples/hello.command.ts) |
| `registerEnvSpecFragment` | [`/core`](src/core/README.md#extension-point-catalog) | the platform's `telemetry` fragment |
| `registerTuiScreen` | [`/tui`](src/tui/README.md#extension-point-catalog) | [`about.tui.ts`](../../apps/cli/src/examples/about.tui.ts) |
| `registerDeployStep` | [`/deploy`](src/deploy/README.md#extension-point-catalog) | [`announce.deploy-step.ts`](../../apps/cli/src/examples/announce.deploy-step.ts) |
| `registerNodeExecutor` | [`/node`](src/node/README.md#extension-point-catalog) | [`echo.executor.ts`](../../apps/cli/src/examples/echo.executor.ts) |
| `runPlatformConformance` | [`/testing`](src/testing/README.md#extension-point-catalog) | [`conformance.test.ts`](../../apps/cli/src/conformance.test.ts) |

The built-in deploy step ids, the env-spec fragment contract and the `/testing` helpers are listed in the [deploy](src/deploy/README.md#extension-point-catalog), [core](src/core/README.md#purpose-and-scope) and [testing](src/testing/README.md#extension-point-catalog) READMEs.

## Data

None. The CLI holds no data model; it calls the API. On the user's machine it writes `~/.<name>/config.json` (server URL and token) and, for a worker, its state directory; on a server, the deploy state file and journals under the deployment root.

## Permissions and settings

None of its own. Every command acts with the permissions of the token `login` stored; the API enforces them.

## UI

None in the web app. In a terminal: the ink TUI (`menu`, `login`, `invoke`, `status`, `node`, `deploy`, `logout`, plus the app's registered screens), opened only by a bare invocation in a real terminal (`<NAME>_NO_TUI` disables it).

## Infra

The deploy wizard and `init` read `infra/compose/.env.example`, which `platform-infra sync` composes from the env template fragments in this order: the platform base (`@marinoscar/platform-infra/env/base.env.example`), each enabled slice's, then the app's own `infra/compose/app.env.example`. Env-spec fragments (`/core`) annotate those keys and never add one. ⚠ A commented `# KEY=value` line in any fragment is read as a declared variable; the conformance suite fails on one. The worker image is the app's (`apps/cli/Dockerfile`), built from the app CLI with this package in its `deps` stage; its `<NAME>_*` variables are `workerEnv()`.

## Observability

A worker relays each job's phase spans to the API through the [telemetry](src/telemetry/README.md#observability) slice. The node writes a JSON log (`node logs`), and every deploy run writes a redacted human journal and a JSONL journal under `<deployRoot>/logs/`. Nothing goes to an OpenTelemetry exporter from the CLI itself.

## Security notes

- **Token storage.** `login` stores the token in `~/.<name>/config.json`, created with mode `0600` in a `0700` directory; `config` prints only a masked hint. The env variables `<NAME>_SERVER_URL` and `<NAME>_TOKEN` override the file per field.
- **The node credential rule (CLAUDE.md queue rule 3).** A job-scoped credential comes from `api.jobSecret(...)`, lives in memory for the job, and is never written to the config file or the state directory, never logged and never put in argv. `checkExecutorCredentialHygiene` (`/testing`) is the check, and the `cli` conformance suite runs it over every executor the worker would run, the app's included.
- **Fixed live-server literals.** `.appctl-deploy.json` and `# Managed by appctl deploy` are not derived from the identity: a renamed CLI must still read the state file and recognise the vhosts an earlier deploy wrote. Do not change them.
- Deploy steps report through `DeployHooks` only; an app step's command output reaches the hooks redacted by the run's journal.

## Conformance suite

`runPlatformConformance({ suites: { cli } })` from [`/testing`](src/testing/README.md#conformance-suite): every env template fragment declares no commented `# KEY=value` line (beyond `PLATFORM_DOCUMENTED_OPTIONAL_KEYS` in the platform base), and every executor the worker would run passes the credential-hygiene check on a fake job holding a credential. The reference app runs it in [`apps/cli/src/conformance.test.ts`](../../apps/cli/src/conformance.test.ts).

## Upgrade notes

0.x: the CLI moved here from `apps/cli/src` (#715) with no change to any command's flags, output, exit codes or file formats (the `--help` of every command is pinned by `apps/cli/src/help-snapshot.test.ts`). What changes for an app that forked the CLI:

| Before (forked `apps/cli/src`) | After |
|---|---|
| `CLI_NAME`, `ENV_PREFIX`, `envVar`, `CONFIG_DIR_NAME` module constants | `createCli({ identity })`, then `cliName()`, `envPrefix()`, `envVar()`, `configDirName()` |
| `buildProgram()` with a fixed command list | `extraCommands` / `registerCliCommand` |
| `type Route` and `menu.tsx` edits | `tuiScreens` / `registerTuiScreen` |
| A step added to `install.ts` | `deploySteps` / `registerDeployStep` after a built-in step id |
| An executor added to `defaultExecutors()` | `nodeExecutors` / `registerNodeExecutor` |
| `CLI_VERSION` (the CLI package's) | `createCli({ version })`; `--version` also prints the platform's |

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `No CLI identity is set` | A module ran before `createCli` | Build the CLI first; in tests use `useTestCliIdentity` or `createCli` after `resetCliForTests()` |
| `The CLI identity is already set` | `createCli` (or `setCliIdentity`) ran twice with different identities | One identity per process; tests reset with `resetCliForTests()` |
| `... was registered after createCli built the CLI` | A `register*` call after `createCli` | Register before `createCli`, or pass the entry in its options |
| `Deploy step "x" runs after "y", which is not a step of the install pipeline` | `after` names no built-in or earlier app step | Use an id from `INSTALL_STEP_IDS` / `UPDATE_STEP_IDS` |
| `Node executor "t" duplicates a built-in executor` | The app registers `db.backup.run` or `example.checksum` | A job type has one executor; choose an app type |

## Links

- [Platform packages spec: worked examples, CLI](../../docs/specs/platform-packages.md#cli)
- [Package documentation standard and checks](../../docs/PACKAGES.md)
- [Reference CLI README: Extending the CLI from an app](../../apps/cli/README.md#extending-the-cli-from-an-app)
- [VPS deploy spec](../../docs/specs/vps-deploy.md) and [worker nodes spec](../../docs/specs/worker-nodes.md)
- TypeDoc API reference: `npm run docs:packages`, then `packages/platform-cli/docs-api/index.html`
- Slice READMEs: [core](src/core/README.md), [commands](src/commands/README.md), [tui](src/tui/README.md), [deploy](src/deploy/README.md), [node](src/node/README.md), [api-client](src/api-client/README.md), [telemetry](src/telemetry/README.md), [testing](src/testing/README.md)
