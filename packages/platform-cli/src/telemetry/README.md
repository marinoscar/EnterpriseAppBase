# @marinoscar/platform-cli/telemetry

The CLI half of the telemetry slice, in the CLI layer: the worker node's job-phase span relay and the telemetry stack's environment-key metadata for the deploy wizard. It depends on the `core` slice (`packages/platform-slices.json`) for the env-spec fragment type and has no runtime dependency: a span is five numbers and a name.

## Purpose and scope

- **Node span relay.** `JobSpanRecorder` records the phases of one job (`job.download`, `job.execute`, `job.upload`, `job.submit`, `job.secret`) on a worker node; `NodeSpanRelay` sends them, best-effort, to `POST /api/nodes/:id/telemetry`, which re-emits them as OpenTelemetry spans through the API's own tracer. A node therefore never holds a collector address or an exporter credential. `errorTypeOf`, `MAX_SPANS_PER_BATCH` (50), `DEFAULT_MAX_QUEUED_SPANS` (500) and the span types come with it.
- **Env-spec fragment.** `telemetryEnvSpecFragment` annotates the telemetry stack's environment keys for the deploy wizard: the PostgreSQL monitor login, `OTEL_*` and `GREPTIME_*`, all in the `observability` group.

Not in scope: the API side of node telemetry (`@marinoscar/platform-api` and the jobs and nodes slice), the explorer and dashboard (`@marinoscar/platform-web/telemetry`), the compose files and collector configuration (`@marinoscar/platform-infra/telemetry`), and the registries the fragment plugs into (`@marinoscar/platform-cli/core`).

## Install and peer dependencies

Part of `@marinoscar/platform-cli`; import it by its subpath:

```ts
import { NodeSpanRelay, telemetryEnvSpecFragment } from '@marinoscar/platform-cli/telemetry';
```

None beyond the package's own ([package README](../../README.md)): the slice imports no third-party module.

## Quick start

The reference CLI uses both halves. The relay is built where the node engine starts ([`node-engine.ts`](../../../../apps/cli/src/node/node-engine.ts)):

```ts
import { JobSpanRecorder, NodeSpanRelay, type NodeSpanSink } from '@marinoscar/platform-cli/telemetry';

const relay = new NodeSpanRelay({ api: client satisfies NodeSpanSink, nodeId });
const spans = new JobSpanRecorder(job.id);
await spans.phase('job.execute', () => run(job));
relay.enqueue(spans.drain()); // after the job settled; never awaited on its path
```

The fragment is registered in the CLI's one registration file ([`register.ts`](../../../../apps/cli/src/platform-host/register.ts)):

```ts
registerEnvSpecFragment(telemetryEnvSpecFragment);
```

## Configuration

`NodeSpanRelayOptions`, one row each:

| Option | Type | Default | Meaning |
|---|---|---|---|
| `api` | `NodeSpanSink` | required | Anything with an optional `telemetry(nodeId, { spans })` method; a client without it is a relay that is off |
| `nodeId` | `string` | required | The node the spans are relayed for |
| `maxQueuedSpans` | `number` | `DEFAULT_MAX_QUEUED_SPANS` (500) | Spans held while waiting to send; the oldest are dropped first |
| `onDisabled` | `(reason: string) => void` | none | Called once, when a `404` turns the relay off for the process |

`telemetryEnvSpecFragment` takes no options. No environment variable controls the relay; `NodeEngine`'s `relaySpans: false` is the programmatic switch.

## Extension-point catalog

Two seams of this slice. Every row links a working use in the reference CLI. The registries the fragment plugs into belong to the `core` slice; their examples are below the table.

| Name | Kind | Signature | When to use | Stability | Example |
|---|---|---|---|---|---|
| `NodeSpanRelay` | hook | `new NodeSpanRelay(options: NodeSpanRelayOptions)`: `enqueue(spans: NodeSpan[]): void`, `enabled`, `queued` | Relay a long-running job's phase spans from a worker to the API without delaying or failing the job | experimental | [example](../../../../apps/cli/src/node/node-engine.ts) |
| `telemetryEnvSpecFragment` | option | `TelemetryEnvSpecFragment` (`{ id: 'telemetry'; metadata }`) | Annotate the telemetry stack's environment keys (group, secret, generated) for the deploy wizard | experimental | [example](../../../../apps/cli/src/platform-host/register.ts) |

Supporting exports: `JobSpanRecorder`, `NodeSpanRelayOptions`, `NodeSpan`, `NodeSpanAttributes`, `NodeSpanName`, `NodeSpanSink`, `errorTypeOf`, `MAX_SPANS_PER_BATCH`, `DEFAULT_MAX_QUEUED_SPANS`, `TelemetryEnvGroup`, `TelemetryEnvSpecFragment`, `TelemetryEnvVarMetadata`.

### Registries of the `core` slice this slice uses

An app plugs the fragment in with `registerEnvSpecFragment` (an id registered twice, or a key two fragments own, throws naming both owners) and adds its own commands with `registerCliCommand` (a name taken by a built-in or by `help` throws). Both belong to the [core catalog](../core/README.md#extension-point-catalog); the reference examples:

| Registry | Reference example |
|---|---|
| `registerEnvSpecFragment` | [`register.ts`](../../../../apps/cli/src/platform-host/register.ts) registers this slice's fragment |
| `registerCliCommand` | [`hello.command.ts`](../../../../apps/cli/src/platform-host/examples/hello.command.ts): compiled and tested ([`hello.command.test.ts`](../../../../apps/cli/src/platform-host/examples/hello.command.test.ts)) but not registered, so `appctl --help` is unchanged |

```ts
registerCliCommand((program) => program.command('coach-seed').description('Seed coach data').action(seedCoachData));
```

## Data

None. Telemetry owns no tables, and the CLI keeps nothing between runs: the relay's queue lives in memory.

## Permissions and settings

None on the CLI side. The node authenticates with its own `nod_` token; the API gates `POST /api/nodes/:id/telemetry` for it.

## UI

None. The interactive menu and the wizard render the fragment's metadata (group, secret, generated) but this slice adds no screen.

## Infra

`telemetryEnvSpecFragment` annotates keys that `infra/compose/.env.example` declares, all in group `observability`. The three GreptimeDB passwords (writer, reader, admin) are `hex-32`, secret and generated without a prompt (they are embedded in GreptimeDB's `user=password` provider string, so `,`, `=` and `:` must never appear). The PostgreSQL monitor login pair is asked, and a blank answer is accepted (the compose file then falls back to the API's own login). These are deployment defaults only; the connection an administrator saves in the admin UI replaces the reader and admin ones at runtime.

## Observability

The relay is the node's only span source: it never talks to a collector. The server re-emits each phase as a span whose parent is the job's stored trace context, tagged `job.executor: node` and `telemetry.relay: node`. Allowlisted integer attributes are renamed on the way through (`bytes` to `job.phase.bytes`, `attempt` to `job.attempt`, `exitCode` to `process.exit_code`, `httpStatus` to `http.response.status_code`). The relay itself emits one engine event, `telemetry-disabled`, once per process.

## Security notes

- Telemetry never delays or fails a job: recording is synchronous and swallows its faults; sending happens off the job's promise, one request at a time.
- No message ever leaves as a span: an errored phase carries `errorType`, a class name plus an HTTP status or an errno-style code (`ApiError.409`, `Error.ECONNREFUSED`), never `error.message`.
- Attributes are integer-only and allowlisted: `bytes`, `attempt`, `exitCode`, `httpStatus`. Nothing from a job's payload, secret or result can ride along.
- The three generated passwords and the monitor password are marked `secret` in the fragment: the CLI's marker for a value it must not echo.

## Conformance suite

None: this slice has no invariant that a consuming app can break. The relay's contract is pinned by tests in the package (`node-span-relay.test.ts`: `errorType` never carries a message, batches of 50, oldest dropped first, `404` disables once, `400`/`403`/`429`/`500` drop the batch, a hanging relay never holds a job slot) and in the reference CLI (`apps/cli/src/node/node-span-relay.test.ts`, the same cases with the CLI's real `ApiError`; `deploy/env-metadata-equivalence.test.ts` for the fragment). The slice's invariants on the API side run through `runPlatformConformance({ suites: { telemetry } })` ([API README](../../../platform-api/src/telemetry/README.md#conformance-suite)).

## Upgrade notes

1.0: first release; moved from the app with no behaviour change.

| Old app path (`apps/cli/src/`) | Import from `@marinoscar/platform-cli/telemetry` |
|---|---|
| `node/node-span-relay.ts` | `NodeSpanRelay`, `JobSpanRecorder`, `errorTypeOf`, `MAX_SPANS_PER_BATCH`, `DEFAULT_MAX_QUEUED_SPANS` |
| The span types of `node/node-api.ts` | `NodeSpan`, `NodeSpanAttributes`, `NodeSpanName`, `NodeSpanSink` |
| The telemetry keys of `deploy/env-metadata.ts` | `telemetryEnvSpecFragment`, registered by `registerEnvSpecFragment` |

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `telemetry-disabled` once in a worker's log | The server has no telemetry route (an older API); spans stay off until the worker restarts. Upgrade the API. |
| A worker's jobs appear in the traces with no node phases | The relay is off (`relaySpans: false`, or an API client without a `telemetry` method), or the server dropped the batch (`400`, `403`, `429`). See the [worker-nodes spec](../../../../docs/specs/worker-nodes.md). |
| `Env key "X" is defined by env-spec fragment "A" and again by "B"` | Two fragments own one key. Remove the key from the app's map or the fragment it duplicates. |
| `appctl --help` lists a command you did not add | Something called `registerCliCommand` from an imported module; the registry runs it once, after the built-ins. |

Operator problems with the telemetry stack are in the [telemetry runbook](../../../../docs/runbooks/telemetry.md#12-troubleshooting).

## Links

- [Worker nodes spec: node span relay](../../../../docs/specs/worker-nodes.md)
- [Platform packages spec](../../../../docs/specs/platform-packages.md): the slice anatomy, the documentation standard and the extension contract
- [Telemetry spec, packaging](../../../../docs/specs/telemetry.md#12-packaging-and-extension-points)
- [Package README](../../README.md) and [core slice](../core/README.md)
- The same slice in other packages: [API](../../../platform-api/src/telemetry/README.md), [contract](../../../platform-contract/src/telemetry/README.md), [web](../../../platform-web/src/telemetry/README.md), [infra](../../../platform-infra/src/telemetry/README.md)
