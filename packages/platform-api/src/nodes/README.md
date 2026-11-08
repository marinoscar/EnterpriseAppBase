# @marinoscar/platform-api/nodes

The worker-node fleet (issue #734, PP-8.2): the `nod_` credential family, the node control plane (`/api/nodes`: register, heartbeat, claim, renew, result, failure, telemetry), the data plane (signed URLs through `NODE_OBJECT_STORE`), the brokered per-job secret, the fleet admin routes (`/api/admin/nodes`), the fleet sweeps and their crons, the fleet gauges, the `nodes.fleet` Doctor check, and opt-in provider-credential delivery to nodes (#1083: `POST /api/nodes/:id/credentials/:purpose`, OFF by default, gated pending a platform rule amendment). It depends on `core`, `doctor`, `otel-core`, `identity`, `settings`, `jobs` and `testing` (`packages/platform-slices.json`), and on nothing of the storage or notifications slices: the data plane reaches object storage through a two-method port, and an offline node is announced as an event.

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
| `tasks.nodeEventsPurge` | `boolean` | on unless `false` (no environment variable) | This process queues `nodes.node_events_purge` daily |
| `nodeEventsRetentionDays` | `number` | `30` | Days `worker_node_events` rows are kept (whole days, 1 to 3650) |
| `tasks.credentialIssuancesPurge` | `boolean` | on unless `false` | This process queues `nodes.credential_issuances_purge` daily (#1083) |
| `credentialIssuancesRetentionDays` | `number` | `30` | Days `node_credential_issuances` rows are kept (whole days, 1 to 3650) |
| `imports` | `Module[]` | `[]` | The modules that bind `NODE_OBJECT_STORE` and `NODE_JOB_INPUTS` |

The fleet policy (staleness, the offline multiplier, retention) is the `nodes` system-settings namespace, read through `@marinoscar/platform-api/settings` (`getNodesPolicy`). The signed-URL lifetime is the app's `storage.signedUrlExpiry` configuration, clamped to the slice's bounds.

## Extension-point catalog

The extension ladder and a recipe per extension: [docs/EXTENDING.md](../../../../docs/EXTENDING.md).

| Name | Kind | Signature | When to use | Stability | Example |
|---|---|---|---|---|---|
| `NodesModule.forRoot` | option | `forRoot(options?: NodesModuleOptions): DynamicModule` | Mount the fleet once, with the app's host ports | experimental | [example](../../../../apps/api/src/platform/jobs/jobs.config.ts) |
| `NODE_OBJECT_STORE` | token | `unique symbol` -> `NodeObjectStore` (`getSignedDownloadUrl`, `getSignedPutUrl`) | Bind the two storage calls the data plane makes (least privilege; no storage import) | experimental | [example](../../../../apps/api/src/platform/jobs/jobs-host.module.ts) |
| `NODE_JOB_INPUTS` | token | `unique symbol` -> `NodeJobInputs` (`resolve(job)`) | Bind how a held job's input object is found (the app's storage subject) | experimental | [example](../../../../apps/api/src/platform/jobs/node-job-inputs.adapter.ts) |
| `registerNodeSpanAttribute` | registry | `registerNodeSpanAttribute(attribute: { key: string; type: 'int' \| 'string'; maxLength?: number }): void` | Let a node executor's own span carry an attribute: emitted as `job.app.<key>`; an unregistered key, or a value of the wrong type, length (default 64, at most 128) or token shape, is dropped from the span. Register at import time | experimental | [example](../../../../apps/api/src/platform-extensions/nodes/transcode.span-attributes.ts) |
| `nodeSpanAttributeRegistry` | registry | `Registry<NodeSpanAttributeDefinition>` | Read the registered attributes (`list()`, `get(key)`); `resolveRelayedAttribute(key, value)` is the pure decision the relay makes | experimental | [example](../../../../apps/api/test/examples/nodes/executor-telemetry.example.spec.ts) |
| `NodeOfflineEvent` | event | `@OnEvent(NODE_OFFLINE_EVENT) (event: NodeOfflineEvent)` | React to a node the fleet sweep marked offline (emitted after the write committed) | stable | [example](../../../../apps/api/test/nodes/node-offline-event.integration.spec.ts) |
| `NodeEventReportedEvent` | event | `@OnEvent(NODE_EVENT_REPORTED) (event: NodeEventReportedEvent)` | React to an event a node reported about itself (power source change, low battery, wake from sleep), emitted per accepted row after the write committed; no I/O in the body | experimental | [example](../../../../apps/api/test/nodes/node-event-reported.integration.spec.ts) |
| `NodeRoute` | hook | `@NodeRoute({ credentials?: ('nod'\|'pat'\|'jwt')[]; nodeParam?: string \| false; permissions?: string[] })` (class or method decorator) | Mount an app route under `/api/nodes/:id/...`: applies `@Auth` (default `nodes:write`), narrows the credential kinds and proves node ownership before the handler runs | experimental | [example](../../../../apps/api/test/examples/nodes/node-route.example.spec.ts) |
| `NodeRouteModule` | component | `imports: [NodeRouteModule]` | Import where a `@NodeRoute()` controller is declared: provides `NodeRouteGuard` and `NodeOwnershipService`, and fails bootstrap on a misplaced node route | experimental | [example](../../../../apps/api/test/examples/nodes/node-route.example.spec.ts) |
| `nodeCredentialCacheConformanceSuite` | registry | `runPlatformConformance({ suites: { nodeCredentialCache: {} } })` after `import '@marinoscar/platform-api/nodes/testing'` | The API half of provider-credential delivery: off by default, server-only fallback, audit without material, rotation and epoch invalidation, the TTL clamp | experimental | [example](../../../../apps/api/test/conformance.spec.ts) |
| `nodesConformanceSuite` | registry | `runPlatformConformance({ suites: { nodes: { rootModule, minPlatformRoutes? } } })` after `import '@marinoscar/platform-api/nodes/testing'` | Fail an app route under `/api/nodes` without `@NodeRoute()`, on a reserved sub-path, or whose guard admits another user's node, a missing node or an unlisted credential kind | experimental | [example](../../../../apps/api/test/conformance.spec.ts) |

Supporting exports (experimental unless noted): `CurrentNode` (the verified node of a `@NodeRoute()` route), `RESERVED_NODE_SUBPATHS` and `reservedNodeSubpathOverlap` (stable), `NodeOwnershipService` and `assertNodeOwnedBy` (stable: 404 missing node, 403 not yours), `NodeRouteGuard`, `findNodeRoutePlacementProblems`, `NodeCredentialModule`, the services (`NodesService`, `NodeCredentialService`, `NodeLifecycleService`, `NodeDataPlaneService`, `NodeSecretBrokerService`, `NodesAdminService`), the two fleet handlers and their type strings, `NODE_OFFLINE_EVENT` (stable), `NODE_TOKEN_PREFIX`, `NODE_OUTPUT_KEY_PREFIX`, `SECRET_CLOCK_SKEW_ALLOWANCE_MS`, `NodeJobInputError`, the port option types (`SignedUrlOptions`, `SignedPutUrlOptions`, structurally the storage slice's), the request DTO classes and the response DTO types, `NODES_APP_METRICS` and the label lists (stable), `NODES_PERMISSIONS` (stable), `OWNER_SELECT` and `CREDENTIAL_OWNER_SELECT`, and the `nodes` settings namespace `NODES_SYSTEM_SETTINGS` with its merge `mergeNodesSettings`.

The app-side proof that its `StorageProvider` satisfies `NodeObjectStore` is a compile-time assertion in [`jobs-host.module.ts`](../../../../apps/api/src/platform/jobs/jobs-host.module.ts); the port contract is `src/nodes/node-object-store.spec.ts`.

## Data

The `jobs` fragment of `@marinoscar/platform-db` holds the slice's tables: `WorkerNode` (`worker_nodes`), `NodeCredential` (`node_credentials`, the token's hash and display prefix only) `JobNodeSecret` (`job_node_secrets`, the issued credential's **handle**, never its material; it has no column able to hold one) and `NodeCredentialIssuance` (`node_credential_issuances`, #1083: node, purpose, a non-secret version, job (`SET NULL`), issue and expiry times; no material column; cascades with the node; purged after 30 days). `Job.claimedByNodeId` links a claimed job to its node (`SET NULL`). Node outputs land under the `node-outputs/` key prefix (`NODE_OUTPUT_KEY_PREFIX`), which the reference app's storage key-prefix list declares.

## Permissions and settings

Declares `nodes:read` and `nodes:write` (`NODES_PERMISSIONS`, system scope, granted to `admin`); every route enforces one with `@Auth`, and the `/api/admin/nodes` routes also require `ROLES.ADMIN`. Owns the `nodes` system-settings namespace: `NODES_SYSTEM_SETTINGS` (the stale and offline windows, the offline retention, the credential-broker switch, off by default; `credentialDelivery`, below; defaults `DEFAULT_NODES_POLICY`; schemas in `@marinoscar/platform-contract/nodes`). `NodesModule.forRoot()` registers it unless the app's manifest already did, so call it before `SettingsModule.forRoot()`. Reads it through `getNamespace('nodes')` (or the deprecated `getNodesPolicy`), plus the `jobs` node-offload switches.

### Provider credential delivery (#1083)

> ⚠ **Gated pending a platform rule amendment.** Delivering an organization's or deployment's provider key to a worker node contradicts AI rules 2 and 3 and queue rule 3 as they stand. The capability ships OFF by default and changes nothing until an administrator enables it; the proposed amendment is in [docs/specs/worker-nodes.md](../../../../docs/specs/worker-nodes.md#provider-credential-delivery). The node-side encrypted cache lands in `@marinoscar/platform-cli` in a later change.

- **Settings** (`nodes.credentialDelivery`): `enabled` (default `false`), `cacheTtlMinutes` (5 to 240, default 60), `purposes` (the allowlist, default `[]`), `epoch` (server-written; a PATCH cannot set it). Read fail closed by `readNodeCredentialDeliveryPolicy`.
- **Declaration**: a job type lists `nodeCredentialPurposes` on its handler; a purpose is registered with `registerNodeCredentialPurpose`. The AI slice registers `ai:<providerId>` for each configured provider (org then deployment key, never BYOK).
- **Claim gate**: `NodeOffloadService.offeredTypes()` withholds a declaring type unless delivery is on and every declared purpose is allowlisted and registered; the server runs it otherwise.
- **Issuance**: `POST /api/nodes/:id/credentials/:purpose` with `{ jobId, claimToken? }`. Refusals, each with `details.reason`: 409 `CREDENTIAL_DELIVERY_DISABLED`, 404 `UNKNOWN_PURPOSE`, 409 (lease), 403 `PURPOSE_NOT_DECLARED`, 429 `CREDENTIAL_RATE_LIMITED` (30 a minute per node, per API process), 424 `CREDENTIAL_UNAVAILABLE`. The response `{ purpose, orgId, material, version, issuedAt, expiresAt, epoch }` is the only place the material exists; a node caches it keyed by `(purpose, orgId)`.
- **Invalidation**: heartbeat and claim responses carry `credentialDelivery: { enabled, epoch, ttlMinutes, purposes, versions }` (versions for the system scope only); `POST /api/admin/nodes/credential-delivery/revoke-all` (`system_settings:write`) advances the epoch.
- **Audit**: a `node_credential_issuances` row and an `audit_events` row `node_credential:issued` (purpose, version, job id), `node_credential:revoke_all` (epoch). No material, ever.

## UI

None in this package. The fleet page and the node credential dialogs are in the reference web app and read `/api/admin/nodes` and `/api/node-credentials`.

## Infra

Nodes run the `@marinoscar/platform-cli` node runner, typically as `infra/compose/worker.compose.yml` containers; see the run-worker-nodes runbook.

## Observability

- **Spans**: node phase spans relayed through `POST /api/nodes/:id/telemetry`, re-emitted as children of the job's enqueuing span, with `job.id`, `job.type`, `job.executor = node`, `node.id`, `node.name` and the job's `org.id` when it has one (never a metric label). The five built-in phases and an executor's own `job.app.<name>` spans are accepted; a span that fails validation is dropped on its own and counted in the response's `dropped` (the batch is not a 400). The attributes relayed are an allowlist: the four built-in integers and whatever the app registered with `registerNodeSpanAttribute`, as `job.app.<key>`.
- **Vitals**: `vitals.extra` is a bounded `key -> number` bag (at most 16 keys, `^[a-z][a-z0-9_.]{1,47}$`, finite numbers within +/-1e15) stored with the snapshot and shown on the fleet page; it never reaches a metric.
- **Metrics**: the fleet gauges (`NODES_APP_METRICS`: `app.nodes.count`, the vitals gauges, `app.nodes.types.no_eligible_node`), declared here and registered by the app.
- **Metrics**: `app.nodes.credentials.issued` (counter, `purpose`; #1083). The node-reported cache metrics arrive with the CLI change.
- **Spans**: `node.credential.issue` (attributes `purpose`, `node.id`, `version`; never material).
- **Doctor**: `nodes.fleet`, `nodes.credential_delivery` (skip when off, warn when on, fail when an allowlisted purpose cannot be delivered).

### App routes on the node plane

`JwtAuthGuard` admits a `nod_` credential on `/api/nodes` and anything under it, by raw URL, and nowhere else. That outer fence is unchanged and stays authoritative; an app controller mounted there narrows it with `@NodeRoute()`:

```ts
@Controller('nodes/:id/reports')
@NodeRoute({ credentials: ['nod'] })
export class ReportsController {
  @Get('latest')
  latest(@CurrentNode() node: WorkerNode) {
    return this.reports.latestFor(node);
  }
}

@Module({ imports: [NodeRouteModule], controllers: [ReportsController] })
export class ReportsModule {}
```

- **Before the handler runs**, `NodeRouteGuard` refuses a credential kind the route did not list (403), then loads the node named by `nodeParam` (default `id`) and answers 404 for a missing node and 403 for another user's node, the packaged control plane's own semantics (`assertNodeOwnedBy`). A node id that is not a uuid is a 400. `@CurrentNode()` is that row.
- **Defaults** are the platform node plane's: `nod`, `pat` and `jwt` admitted, permission `nodes:write`. `credentials: ['nod']` makes a route node-only, so a human's PAT or session is refused; `nodeParam: false` is for a route that names no node.
- **Reserved sub-paths.** The platform owns `register`, `job-types`, `:id`, `:id/events`, `:id/deregister`, `:id/heartbeat`, `:id/claim`, `:id/telemetry`, everything under `:id/credentials/` and `:id/jobs/` and `models/` (`RESERVED_NODE_SUBPATHS`). The method is ignored, so `GET` and `POST` on a reserved path are both refused. `NodeRouteModule` fails application bootstrap when a `@NodeRoute()` route overlaps one or is not under `/api/nodes`. Mount app features under `nodes/:id/<feature>/...`.
- **Conformance.** The `nodes` suite (`@marinoscar/platform-api/nodes/testing`, `runPlatformConformance({ suites: { nodes: { rootModule } } })`) fails an app route under `/api/nodes` that lacks `@NodeRoute()`, one on a reserved path, one whose guard is missing, and, per route, a guard that admits an unlisted credential kind, another user's node or a missing node.
- `NodesService` stays unexported from `NodesModule` (it claims and settles jobs); `NodeOwnershipService` (exported by `NodeRouteModule`) is the read-only ownership check for app code that is not a route.

## Security notes

- A node authenticates with its `nod_` credential (hashed at rest, shown once); every control-plane call is gated by node ownership and, per job, by `assertJobHeldByNode` (the held claim and its token).
- **A node never persists a job-scoped credential.** `POST /api/nodes/:id/jobs/:jobId/secret` is gated by `assertJobHeldByNode`, bounded by the job's lease, revoked when the job settles (`NodeSecretRevoker` on `job.settled`) or by the secret sweep; `job_node_secrets` stores handles only.
- **Provider credential delivery** (#1083, opt-in): an organization or deployment key may be delivered for an allowlisted, declared purpose to a node holding a live lease; a user's key never is. Off by default. Anyone with root on a node host can read a delivered key: bounded by the TTL and revoke-all; real revocation is rotating the key at the provider.
- Relayed span attributes named like a secret (`apiKey`, `material`, `authorization`, `secret`, `password`, `credential`, `bearer`) are refused at registration.
- The data plane decides which object and for how long: a node cannot name a key or a lifetime, and the signed URLs are bearer capabilities a node must not log or persist.

## Conformance suite

The `nodes` suite (`@marinoscar/platform-api/nodes/testing`; see [App routes on the node plane](#app-routes-on-the-node-plane)) runs in the reference app with `{ rootModule: AppModule }`; the app mounts no node route of its own, so it proves the walk sees the packaged routes and the example spec proves a route. Also run in the reference app: `cron-enqueue-only` (the secret sweep, `packages/platform-api/src/nodes/tasks/node-secret-sweep.task.ts`, is one of exactly three exemptions), `on-event-no-io` (the revoker and the app's offline notifier are scanned), the node invariants under `apps/api/test/nodes/` (the lease boundary, the claim contention, the data plane, the job secret), and `apps/api/test/nodes/node-offline-event.integration.spec.ts` (an offline node still notifies, after the write).

## Upgrade notes

New as a package subpath in this version (the code moved from `apps/api/src/nodes/`):

- Import from `@marinoscar/platform-api/nodes`; mount `NodeCredentialModule` and `NodesModule.forRoot({ imports: [<host module>] })`, and bind `NODE_OBJECT_STORE` and `NODE_JOB_INPUTS`.
- The fleet sweep no longer calls `NotificationsService`: it emits `nodes.node.offline`. An app that wants the `nodes.node_offline` notification adds a listener (the reference app's `NodeOfflineNotifier`); the event key and template are unchanged.
- The request schemas moved to `@marinoscar/platform-contract/nodes`; the HTTP contract is unchanged.
- #865: the `nodes` namespace declaration is the slice's (`NODES_SYSTEM_SETTINGS`), and `NodesModule.forRoot()` registers it. An app that copied the reference app's `platform/jobs/nodes.system-settings.ts` deletes its copy and imports the packaged one into its manifest; `forRoot()` must run before `SettingsModule.forRoot()`.

- A span that fails validation is a counted drop (`200 { accepted, dropped }`), no longer a 400 for the whole batch: only a body that is not a bounded `{ spans: [...] }` is refused. `spans[].name` is `job.app.<name>` or a phase (the OpenAPI document shows `anyOf` an enum and a pattern), and `spans[].attributes` accepts bounded app keys (`additionalProperties`). `vitals.extra` is new and optional on the heartbeat and on the fleet response.

- #1083 (additive): `nodes.credentialDelivery` settings (OFF), `node_credential_issuances` (migration `0043_add_node_credential_issuances`), the issuance and revoke-all routes, `credentialDelivery` on heartbeat and claim responses, `node_credential_delivery` in `serverFeatures`, `:id/credentials/*` reserved, and the `nodes.credential_issuances_purge` job type. Nothing changes until an administrator enables delivery.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| An executor's span arrives without its attributes | The attribute is not registered on the API (or its value is not an integer / a short token) | `registerNodeSpanAttribute({ key, type })` at import time; the node drops nothing the server would accept |
| An executor's span is counted in `dropped` | Its name is not `job.app.<name>`, or its job is not held by that node | Name it `job.app.` plus 2 to 48 lower-case characters; relay only for the job the node ran |
| Boot fails: `Nest can't resolve dependencies of NodeDataPlaneService (…, NODE_OBJECT_STORE, …)` | The host module binding the port is not in `forRoot({ imports })` | Bind `NODE_OBJECT_STORE` in a `@Global()` host module and pass it to `imports` |
| Nodes go offline but nobody is told | No `nodes.node.offline` listener in the app | Add one that calls the notifier (dispatch only; no I/O in the listener) |
| A credential request is a 409 `CREDENTIAL_DELIVERY_DISABLED` | Delivery is off (the default) | Enable `nodes.credentialDelivery` and allowlist the purpose, or let the server run the job |
| A declaring job type is never claimed by a node | Delivery off, the purpose not allowlisted, or not registered | Check the `nodes.credential_delivery` Doctor line |
| A node's secret request is a 409 | The job is no longer held by that claim | The node lost the lease; it must stop and not retry the secret |
| `NodesModule.forRoot() registers the system settings namespace(s) "nodes", but SettingsModule.forRoot() already composed ...` | `NodesModule.forRoot()` ran after `SettingsModule.forRoot()`, without the app's manifest registering `nodes` | Call it first, or register `NODES_SYSTEM_SETTINGS` in the app's manifest |

## Links

- [The jobs slice](../jobs/README.md) and [the recipe: add a job type](../jobs/handlers/README.md)
- [The contract: `@marinoscar/platform-contract/nodes`](../../../platform-contract/src/nodes/README.md)
- [Spec: worker nodes](../../../../docs/specs/worker-nodes.md), [runbook: run worker nodes](../../../../docs/runbooks/run-worker-nodes.md)
