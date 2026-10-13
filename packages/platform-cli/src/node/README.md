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

`JobExecutor`: `type` (the server's job type; permanent once jobs exist), `requiresInput` (the engine streams the input object to `inputPath` first) and `execute(context)` (return the result the server's schema expects, throw to fail). The context carries `job`, `params`, `inputPath`, `input`, `api` (`jobSecret`, `uploadUrl`, `downloadUrl` for the held job), `nodeId`, `claimToken`, `signal`, `log` and `phase` (times a relayed span; the name is a built-in phase or `job.app.<name>`, with bounded attributes). An executor may add `vitals()`: a cheap, synchronous `Record<string, number>` read on every heartbeat and merged (sanitized by `sanitizeExtraVitals`: at most 16 keys shaped `^[a-z][a-z0-9_.]{1,47}$`, finite numbers) into `vitals.extra`.

Supporting exports (experimental): `binaryCapability`, `probeCapabilities`, `evaluateCapabilities`, `runStartupSelfTest` (the self-test the node runs at startup and `node doctor` reuses), `sanitizeExtraVitals`, `isNodeSpanName` and `NODE_APP_SPAN_NAME_PATTERN`, with the types `Capability`, `CapabilityProbe`, `CapabilityGap`, `JobRequirementInput`, `JobTypeRequirements`, `ProbedBinaryOptions`, `SelfTestOptions`, `SelfTestResult`, `NodeSpanName` and `NodeSpanAttributes`.

## Extension-point catalog

The extension ladder and a recipe per extension: [docs/EXTENDING.md](../../../../docs/EXTENDING.md).

| Name | Kind | Signature | When to use | Stability | Example |
|---|---|---|---|---|---|
| `registerNodeExecutor` | registry | `registerNodeExecutor(executor: JobExecutor): void` | Let worker nodes run an app's node-eligible job type | experimental | [example](../../../../apps/cli/src/examples/echo.executor.ts) |
| `registerJobRequirement` | registry | `registerJobRequirement(type: string, requirement: { required: string[]; degradable?: string[] }): void` | Declare what a type needs from the machine (`binaryCapability('ffmpeg')`): the startup self-test refuses to claim the type without a required capability and `node doctor` reports it. Every `binary:` key is also registered as a probed binary | experimental | [example](../../../../apps/cli/src/examples/transcode.executor.ts) |
| `registerProbedBinary` | registry | `registerProbedBinary(name: string, options?: { versionArgs?: string[] }): void` | Add an executable to what the capability probe looks for; with `versionArgs` (`['-version']`) the probe also captures its version banner, shown by `node doctor` and the fleet page | experimental | [example](../../../../apps/cli/src/examples/transcode.executor.ts) |

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

PP-14.19, additive: `registerJobRequirement` and `registerProbedBinary` replace editing `JOB_TYPE_REQUIREMENTS` and `PROBED_BINARIES` in a fork (both objects still exist and are what the registrations fill). The probe gains an optional `versions` map (absent when no binary has `versionArgs`, so a stock node's probe is unchanged), `JobExecutor` gains the optional `vitals()`, and the span name type widens to `job.app.<name>`. Register requirements before the node starts; they are not frozen by `createCli`.

## Troubleshooting

- `Node executor "db.backup.run" duplicates a built-in executor`: a job type has exactly one executor.
- `Cannot run job type "x": required capability "binary:ffmpeg" is missing`: the machine lacks the tool the type's `registerJobRequirement` names. Install it, or drop the type from `--types`. `node doctor` lists the registered tools and their versions.
- A `job.app.*` span or an app vital never shows up: the API did not register the span attributes (`registerNodeSpanAttribute`), or the key is outside `^[a-z][a-z0-9_.]{1,47}$`; the CLI drops what the server would refuse.
- The node never claims the type: the server does not advertise it (no handler with `nodeResultSchema` + `persistNodeResult`), or the node's `--types` excludes it.

## Links

- [Package README](../../README.md)
- [Platform packages spec: worked examples, CLI](../../../../docs/specs/platform-packages.md#cli)
- [Package documentation standard](../../../../docs/PACKAGES.md)
