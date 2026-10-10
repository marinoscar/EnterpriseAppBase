# `@marinoscar/platform-cli/node`

The worker node's executor contract and registry: how an app gives the worker one more node-eligible job type. CLI layer; part of `@marinoscar/platform-cli`; re-exports the `engine` slice.

## Purpose and scope

A job type a node can run has two halves: the server's handler (`nodeResultSchema` + `persistNodeResult`, in the API) and this package's `JobExecutor`. `registerNodeExecutor(executor)` adds the node half; the engine's default registry (`defaultExecutorRegistry()`) is the platform's executors (`example.checksum`, `db.backup.run`) plus every registered one, and the node advertises and claims exactly those types.

Not in scope: the node daemon, enrollment and lifecycle (the `node` command), and the server half.

## Install and peer dependencies

Ships inside `@marinoscar/platform-cli`:

```ts
import type { JobExecutionContext, JobExecutor } from '@marinoscar/platform-cli/node';
```

None beyond the package's own.

## Quick start

The reference example, [`echo.executor.ts`](../../../../apps/cli/src/examples/echo.executor.ts):

```ts
export class EchoExecutor implements JobExecutor {
  readonly type = 'app.echo';
  readonly requiresInput = false;
  async execute(context: JobExecutionContext) {
    context.log('echo', { jobId: context.job.id });
    return { echoed: context.params, at: new Date().toISOString(), computedBy: 'node' };
  }
}
createCli({ ...APP_CLI_OPTIONS, nodeExecutors: [new EchoExecutor()] });
defaultExecutorRegistry().types(); // ['app.echo', 'db.backup.run', 'example.checksum']
```

## Configuration

`JobExecutor`: `type` (the server's job type; permanent once jobs exist), `requiresInput` (the engine streams the input object to `inputPath` first) and `execute(context)` (return the result the server's schema expects, throw to fail). The context carries `job`, `params`, `inputPath`, `input`, `api` (`jobSecret`, `uploadUrl`, `downloadUrl` for the held job), `nodeId`, `claimToken`, `signal` and `log`.

## Extension-point catalog

The extension ladder and a recipe per extension: [docs/EXTENDING.md](../../../../docs/EXTENDING.md).

| Name | Kind | Signature | When to use | Stability | Example |
|---|---|---|---|---|---|
| `registerNodeExecutor` | registry | `registerNodeExecutor(executor: JobExecutor): void` | Let worker nodes run an app's node-eligible job type | experimental | [example](../../../../apps/cli/src/examples/echo.executor.ts) |

## Data

None. An executor reports its result to the server, which persists it (`persistNodeResult`).

## Permissions and settings

None on the node. Whether a type is offered to nodes at all is the server's decision (its handler, and settings such as `databaseBackup.nodeOffloadEnabled`).

## UI

None. The node dashboard (`node` TUI screen) lists the types the node claims.

## Infra

None of its own. The worker image and its `<NAME>_*` variables are the app's ([package README § Infra](../../README.md#infra)).

## Observability

`context.log` goes through the node logger's redaction; the engine records `job.execute` and other phase spans and relays them ([telemetry](../telemetry/README.md#observability)).

## Security notes

CLAUDE.md queue rule 3: a node never persists a job-scoped credential. Get it with `context.api.jobSecret(context.nodeId, context.job.id, context.claimToken)`, keep it in a local for the job, never write it to disk, never log it, never pass it in argv. Run `checkExecutorCredentialHygiene` ([`/testing`](../testing/README.md)) over every app executor; the `cli` conformance suite does it for you.

## Conformance suite

The `cli` suite's executor case runs the credential-hygiene check over every executor the worker would run ([`/testing`](../testing/README.md#conformance-suite)).

## Upgrade notes

0.x: replaces appending to `defaultExecutors()` in a forked CLI (#715).

## Troubleshooting

- `Node executor "db.backup.run" duplicates a built-in executor`: a job type has exactly one executor.
- The node never claims the type: the server does not advertise it (no handler with `nodeResultSchema` + `persistNodeResult`), or the node's `--types` excludes it.

## Links

- [Package README](../../README.md)
- [Platform packages spec: worked examples, CLI](../../../../docs/specs/platform-packages.md#cli)
- [Package documentation standard](../../../../docs/PACKAGES.md)
