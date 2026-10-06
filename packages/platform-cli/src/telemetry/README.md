# `@marinoscar/platform-cli/telemetry`

Stub (PP-4.5, #706): the CLI half of the telemetry slice. #707 completes this README.

## Purpose and scope

- **Node span relay.** `JobSpanRecorder` records the phases of one job (download, execute, upload, submit, secret) on a worker node; `NodeSpanRelay` sends them, best-effort, to `POST /api/nodes/:id/telemetry`, which re-emits them as OpenTelemetry spans. `errorTypeOf`, `MAX_SPANS_PER_BATCH` (50), `DEFAULT_MAX_QUEUED_SPANS` (500) and the span types come with it.
- **Env-spec fragment.** `telemetryEnvSpecFragment` annotates the telemetry stack's environment keys for the deploy wizard: the PostgreSQL monitor login, `OTEL_*` and `GREPTIME_*`.

Not in scope: the API side of node telemetry, the explorer and dashboard, the compose files.

## Install and peer dependencies

Part of `@marinoscar/platform-cli`; see the [package README](../../README.md). No runtime dependency: a span is five numbers and a name.

## Quick start

```ts
import { JobSpanRecorder, NodeSpanRelay, type NodeSpanSink } from '@marinoscar/platform-cli/telemetry';

const relay = new NodeSpanRelay({ api: client satisfies NodeSpanSink, nodeId });
const spans = new JobSpanRecorder(job.id);
await spans.phase('job.execute', () => run(job));
relay.enqueue(spans.drain()); // after the job settled; never awaited on its path
```

## Configuration

`NodeSpanRelayOptions`: `api` (anything with an optional `telemetry(nodeId, { spans })` method), `nodeId`, `maxQueuedSpans` (default `DEFAULT_MAX_QUEUED_SPANS`), `onDisabled` (called once when a 404 turns the relay off).

## Extension-point catalog

None yet. This slice exports building blocks, not seams; #707 decides which become extension points.

## Data

None. Telemetry owns no tables.

## Permissions and settings

None on the CLI side. The server authenticates the node's own token.

## UI

None.

## Infra

`telemetryEnvSpecFragment` annotates keys that `infra/compose/.env.example` declares (group `observability`); the GreptimeDB passwords are `hex-32`, secret and generated without a prompt.

## Observability

The relay is the node's only span source. It never talks to a collector.

## Security notes

- Telemetry never delays or fails a job: recording is synchronous and swallows its faults; sending happens off the job's promise.
- No message ever leaves as a span: an errored phase carries `errorType`, a class name plus an HTTP status or errno-style code.
- Integer-only, allowlisted attributes: `bytes`, `attempt`, `exitCode`, `httpStatus`.

## Conformance suite

None yet. `node-span-relay.test.ts` covers batching, the bounded queue, the 404 switch-off and the dropped-batch cases.

## Upgrade notes

None. First release of the slice.

## Troubleshooting

- `telemetry-disabled` once in a worker's log: the server has no telemetry route (an older API); spans are off until the worker restarts.

## Links

- [Worker nodes spec: node span relay](../../../../docs/specs/worker-nodes.md)
- [Platform packages spec: slice anatomy](../../../../docs/specs/platform-packages.md#slice-anatomy-telemetry-as-the-worked-example)
