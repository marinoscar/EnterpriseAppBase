# @marinoscar/platform-api/nodes

The worker-node fleet (issue #734, PP-8.2): the `nod_` credential family, the node control plane (`/api/nodes`: register, heartbeat, claim, renew, result, failure, telemetry), the data plane (signed URLs through `NODE_OBJECT_STORE`), the brokered per-job secret, the fleet admin routes (`/api/admin/nodes`), the fleet sweeps and their crons, the fleet gauges and the `nodes.fleet` Doctor check. It depends on `core`, `doctor`, `otel-core`, `identity`, `settings`, `jobs` and `testing` (`packages/platform-slices.json`), and on nothing of the storage or notifications slices: the data plane reaches object storage through a two-method port, and an offline node is announced as an event.

## Purpose and scope

A worker node is a remote executor of node-eligible job types (a handler with `nodeResultSchema` + `persistNodeResult`). It claims through the same one-statement claim the server worker uses, holds a lease, moves bytes through short-lived signed URLs, and posts a result the server validates and persists. It never holds storage credentials and never persists a job-scoped credential.

- `NodeCredentialModule` (`@Global`): the `nod_` token family and its guard dependency, kept separate so `JwtAuthGuard` stays out of a cycle with the queue.
- `NodesModule.forRoot()`: the control plane, the data plane, the secret broker service, the admin routes, `nodes.fleet.sweep` and `nodes.fleet.prune`, and the three crons (stale-offline and offline-prune enqueue; the secret sweep is a permanent cron exemption).

Not here: the queue (`@marinoscar/platform-api/jobs`); the node runner (`@marinoscar/platform-cli`); the request shapes (`@marinoscar/platform-contract/nodes`); the fleet page (still in the reference web app); the offline notification itself (an app listener, below).

## Install and peer dependencies

Ships inside `@marinoscar/platform-api`; import it by its subpath:

```ts
import { NodesModule, NodeCredentialModule, NODE_OBJECT_STORE } from '@marinoscar/platform-api/nodes';
```

None beyond the jobs slice's: `@nestjs/config`, `@nestjs/event-emitter`, `@nestjs/schedule`, `nestjs-zod` and `zod`.

## Quick start

The reference app mounts the fleet next to the queue ([`jobs.config.ts`](../../../../apps/api/src/platform/jobs/jobs.config.ts)) and binds the two ports to its own services ([`jobs-host.module.ts`](../../../../apps/api/src/platform/jobs/jobs-host.module.ts)):

```ts
export const NodesModule = PlatformNodesModule.forRoot({ imports: [JobsHostModule] });

// JobsHostModule
{ provide: NODE_OBJECT_STORE, useExisting: STORAGE_PROVIDER },
{ provide: NODE_JOB_INPUTS, useClass: NodeJobInputsAdapter },
```

`app.module.ts` imports `NodeCredentialModule` once, and `NodesModule` after `JobsModule`.

## Configuration

`NodesModule.forRoot(options)`; defaults from the deployment's environment (names unchanged).

| Option | Type | Default | Meaning |
|---|---|---|---|
| `tasks.staleOffline` | `boolean` | `NODE_STALE_OFFLINE_ENABLED` (on unless `false`) | This process queues `nodes.fleet.sweep` every ten minutes |
| `tasks.offlinePrune` | `boolean` | `NODE_OFFLINE_PRUNE_ENABLED` (on unless `false`) | This process queues `nodes.fleet.prune` daily |
| `tasks.secretSweep` | `boolean` | `NODE_SECRET_SWEEP_ENABLED` (on unless `false`) | This process runs the brokered-secret sweep |
| `imports` | `Module[]` | `[]` | The modules that bind `NODE_OBJECT_STORE` and `NODE_JOB_INPUTS` |

The fleet policy (staleness, the offline multiplier, retention) is the `nodes` system-settings namespace, read through `@marinoscar/platform-api/settings` (`getNodesPolicy`). The signed-URL lifetime is the app's `storage.signedUrlExpiry` configuration, clamped to the slice's bounds.

## Extension-point catalog

| Name | Kind | Signature | When to use | Stability | Example |
|---|---|---|---|---|---|
| `NodesModule.forRoot` | option | `forRoot(options?: NodesModuleOptions): DynamicModule` | Mount the fleet once, with the app's host ports | experimental | [example](../../../../apps/api/src/platform/jobs/jobs.config.ts) |
| `NODE_OBJECT_STORE` | token | `unique symbol` -> `NodeObjectStore` (`getSignedDownloadUrl`, `getSignedPutUrl`) | Bind the two storage calls the data plane makes (least privilege; no storage import) | experimental | [example](../../../../apps/api/src/platform/jobs/jobs-host.module.ts) |
| `NODE_JOB_INPUTS` | token | `unique symbol` -> `NodeJobInputs` (`resolve(job)`) | Bind how a held job's input object is found (the app's storage subject) | experimental | [example](../../../../apps/api/src/platform/jobs/node-job-inputs.adapter.ts) |
| `NodeOfflineEvent` | event | `@OnEvent(NODE_OFFLINE_EVENT) (event: NodeOfflineEvent)` | React to a node the fleet sweep marked offline (emitted after the write committed) | stable | [example](../../../../apps/api/src/notifications/ops/node-offline-notifier.ts) |

Supporting exports (experimental unless noted): `NodeCredentialModule`, the services (`NodesService`, `NodeCredentialService`, `NodeLifecycleService`, `NodeDataPlaneService`, `NodeSecretBrokerService`, `NodesAdminService`), the two fleet handlers and their type strings, `NODE_OFFLINE_EVENT` (stable), `NODE_TOKEN_PREFIX`, `NODE_OUTPUT_KEY_PREFIX`, `SECRET_CLOCK_SKEW_ALLOWANCE_MS`, `NodeJobInputError`, the port option types (`SignedUrlOptions`, `SignedPutUrlOptions`, structurally the storage slice's), the request DTO classes and the response DTO types, `NODES_APP_METRICS` and the label lists (stable), `NODES_PERMISSIONS` (stable), `OWNER_SELECT` and `CREDENTIAL_OWNER_SELECT`.

The app-side proof that its `StorageProvider` satisfies `NodeObjectStore` is a compile-time assertion in [`jobs-host.module.ts`](../../../../apps/api/src/platform/jobs/jobs-host.module.ts); the port contract is `src/nodes/node-object-store.spec.ts`.

## Data

The `jobs` fragment of `@marinoscar/platform-db` holds the slice's tables: `WorkerNode` (`worker_nodes`), `NodeCredential` (`node_credentials`, the token's hash and display prefix only) and `JobNodeSecret` (`job_node_secrets`, the issued credential's **handle**, never its material; it has no column able to hold one). `Job.claimedByNodeId` links a claimed job to its node (`SET NULL`). Node outputs land under the `node-outputs/` key prefix (`NODE_OUTPUT_KEY_PREFIX`), which the reference app's storage key-prefix list declares.

## Permissions and settings

Declares `nodes:read` and `nodes:write` (`NODES_PERMISSIONS`, system scope, granted to `admin`); every route enforces one with `@Auth`, and the `/api/admin/nodes` routes also require `ROLES.ADMIN`. Reads the `nodes` system-settings namespace (`getNodesPolicy`) and the `jobs` node-offload switches.

## UI

None in this package. The fleet page and the node credential dialogs are in the reference web app and read `/api/admin/nodes` and `/api/node-credentials`.

## Infra

Nodes run the `@marinoscar/platform-cli` node runner, typically as `infra/compose/worker.compose.yml` containers; see the run-worker-nodes runbook.

## Observability

- **Spans**: node phase spans relayed through `POST /api/nodes/:id/telemetry`, re-emitted as children of the job's enqueuing span, with `job.id`, `job.type`, `job.executor = node`, `node.id`, `node.name` and the job's `org.id` when it has one (never a metric label).
- **Metrics**: the fleet gauges (`NODES_APP_METRICS`: `app.nodes.count`, the vitals gauges, `app.nodes.types.no_eligible_node`), declared here and registered by the app.
- **Doctor**: `nodes.fleet`.

## Security notes

- A node authenticates with its `nod_` credential (hashed at rest, shown once); every control-plane call is gated by node ownership and, per job, by `assertJobHeldByNode` (the held claim and its token).
- **A node never persists a job-scoped credential.** `POST /api/nodes/:id/jobs/:jobId/secret` is gated by `assertJobHeldByNode`, bounded by the job's lease, revoked when the job settles (`NodeSecretRevoker` on `job.settled`) or by the secret sweep; `job_node_secrets` stores handles only.
- The data plane decides which object and for how long: a node cannot name a key or a lifetime, and the signed URLs are bearer capabilities a node must not log or persist.

## Conformance suite

Run in the reference app: `cron-enqueue-only` (the secret sweep, `packages/platform-api/src/nodes/tasks/node-secret-sweep.task.ts`, is one of exactly three exemptions), `on-event-no-io` (the revoker and the app's offline notifier are scanned), the node invariants under `apps/api/test/nodes/` (the lease boundary, the claim contention, the data plane, the job secret), and `apps/api/test/nodes/node-offline-event.integration.spec.ts` (an offline node still notifies, after the write).

## Upgrade notes

New as a package subpath in this version (the code moved from `apps/api/src/nodes/`):

- Import from `@marinoscar/platform-api/nodes`; mount `NodeCredentialModule` and `NodesModule.forRoot({ imports: [<host module>] })`, and bind `NODE_OBJECT_STORE` and `NODE_JOB_INPUTS`.
- The fleet sweep no longer calls `NotificationsService`: it emits `nodes.node.offline`. An app that wants the `nodes.node_offline` notification adds a listener (the reference app's `NodeOfflineNotifier`); the event key and template are unchanged.
- The request schemas moved to `@marinoscar/platform-contract/nodes`; the HTTP contract is unchanged.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Boot fails: `Nest can't resolve dependencies of NodeDataPlaneService (…, NODE_OBJECT_STORE, …)` | The host module binding the port is not in `forRoot({ imports })` | Bind `NODE_OBJECT_STORE` in a `@Global()` host module and pass it to `imports` |
| Nodes go offline but nobody is told | No `nodes.node.offline` listener in the app | Add one that calls the notifier (dispatch only; no I/O in the listener) |
| A node's secret request is a 409 | The job is no longer held by that claim | The node lost the lease; it must stop and not retry the secret |

## Links

- [The jobs slice](../jobs/README.md) and [the recipe: add a job type](../jobs/handlers/README.md)
- [The contract: `@marinoscar/platform-contract/nodes`](../../../platform-contract/src/nodes/README.md)
- [Spec: worker nodes](../../../../docs/specs/worker-nodes.md), [runbook: run worker nodes](../../../../docs/runbooks/run-worker-nodes.md)
