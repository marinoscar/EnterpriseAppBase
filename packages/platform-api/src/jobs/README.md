# @marinoscar/platform-api/jobs

The background job queue (issue #734, PP-8.2): enqueue with active dedup, the one-statement `FOR UPDATE SKIP LOCKED` claim, leases and their renewal, the terminal state machine, provider throttling, the in-process worker pool, the lease reaper, the temp-file janitor, the job-history purge, the retention engine (the shared batched purge, its nightly enqueue-only cron and the `retention` settings namespace), the handler contract and its registry, the job-type label registry, and the `/api/admin/jobs` routes with the `jobs.*` Doctor checks. It depends on `core`, `doctor`, `otel-core`, `identity`, `settings` and `testing` (`packages/platform-slices.json`); the worker-node fleet is the separate `nodes` slice, which depends on this one.

## Purpose and scope

Every long-running activity in an app built on the platform is a job of this queue (CLAUDE.md, "Every Long-Running Activity Is a Queue Job"). The slice owns the queue's machinery and its invariants; an app owns its job **types**, as handlers that register themselves.

- **Enqueue**: `JobsService.enqueue` / `enqueueWithin(tx, …)`; dedup by `buildDedupKey(type, subjectType, subjectId)` over the raw-SQL partial unique index `jobs_active_dedup_uniq_idx`, never a `findFirst` pre-check. A `@Cron` only decides and calls `enqueueHousekeepingJob`.
- **Claim and run**: `JobClaimService` (one statement, shared by the server worker and the node control plane), `JobLeaseService`, `JobTerminalService` (emits `job.settled`), `JobWorker`, `ProviderThrottleService`, `NodeOffloadService`.
- **Recover**: `JobStuckService` and its cron (the lease reaper), the temp-file janitor, the `job.history.purge` handler and task.
- **Retention (#898)**: the one `purgeInBatches` / `runRetentionPolicyPurge` loop every retention handler uses, the `RetentionPurgeRegistry` the handlers declare their policy in, the 01:00 `RetentionPurgeTask` (enqueue-only, one job per enabled policy whose handler is mounted), the `retention` settings namespace (`RETENTION_SYSTEM_SETTINGS`) and `audit.events.purge` (identity cannot import jobs, so the audit-trail purge lives here). The other three purges live with their tables: `notifications.inbox.purge` and `notifications.deliveries.purge` in `@marinoscar/platform-api/notifications`, `ai.runs.purge` in `@marinoscar/platform-api/ai`.
- **Read and repair**: `JobAdminService`, `JobInsightsService` and the `/api/admin/jobs` routes.
- **Tenancy**: every job carries `orgId` (`null` for a system job); `JobScope.run(job, fn)` runs a handler's tenant work under it.

Not here: the worker-node fleet and the node secret broker service (`@marinoscar/platform-api/nodes`); the HTTP shapes (`@marinoscar/platform-contract/jobs`); the jobs, insights and workers pages (still in the reference web app; a follow-up moves them to `@marinoscar/platform-web`); feature handlers (AI, storage, backups, broadcasts: their own slices or the app); per-organization fairness in the claim (later, spec "Red flags").

The recipe for adding a job type is [`handlers/README.md`](handlers/README.md).

## Install and peer dependencies

Ships inside `@marinoscar/platform-api`; import it by its subpath:

```ts
import { JobsModule, JobsService, JobHandlerRegistry, type JobHandler } from '@marinoscar/platform-api/jobs';
```

Peers beyond the package's own: `@nestjs/config`, `@nestjs/event-emitter`, `@nestjs/schedule`, `nestjs-zod` and `zod`, and `@prisma/client-runtime-utils` (the raw-SQL builders of the claim and insights queries; the non-generated runtime the app's own client uses). The slice never imports `@prisma/client`: it reads the `jobs` fragment's models through the structural `JobsPrisma` bound to core's `PLATFORM_PRISMA`.

## Quick start

The reference app configures the slice once and imports the result wherever a module needs the queue ([`jobs.config.ts`](../../../../apps/api/src/platform/jobs/jobs.config.ts)):

```ts
import { JobsModule as PlatformJobsModule } from '@marinoscar/platform-api/jobs';

export const JobsModule = PlatformJobsModule.forRoot({ appName: APP_NAME, imports: [JobsHostModule] });
```

`JobsHostModule` ([`jobs-host.module.ts`](../../../../apps/api/src/platform/jobs/jobs-host.module.ts)) binds the host ports; the app spreads `jobsConfiguration()` into its configuration so the `JOBS_*` keys resolve. A handler is a provider that calls `registry.register(this)` from `onModuleInit` ([`example-echo.handler.ts`](../../../../apps/api/src/examples/jobs/example-echo.handler.ts)).

## Configuration

`JobsModule.forRoot(options)`. Every default comes from the deployment's environment, whose variable names are unchanged; `infra/compose/.env.example` documents them.

| Option | Type | Default | Meaning |
|---|---|---|---|
| `worker.mode` | `'all' \| 'system' \| 'off'` | `JOBS_WORKER_MODE` (`all`) | Which types this process claims: every type, server-only types (plus `JOBS_SYSTEM_MODE_EXTRA_TYPES`), or none |
| `worker.concurrency` | `number` | `JOBS_WORKER_CONCURRENCY` (2) | Jobs this process runs at once |
| `worker.pollMs` | `number` | `JOBS_POLL_MS` (5000) | Idle poll interval (the `jobs.enqueued` bus message wakes it sooner) |
| `worker.jobTimeoutMs` | `number` | `JOBS_JOB_TIMEOUT_MS` (600000) | Per-attempt timeout of a type without a `profile` |
| `retry.maxAttempts` | `number` | `JOBS_MAX_ATTEMPTS` (3) | Attempts before a job fails for good (a type's `profile` overrides) |
| `retry.baseMs` | `number` | `JOBS_RETRY_BASE_MS` (2000) | First retry delay; doubles per attempt |
| `retry.maxMs` | `number` | `JOBS_RETRY_MAX_MS` (60000) | The retry delay's ceiling |
| `appName` | `string` | `'app-job-'` prefix | The application's name, for the temp-file prefix (two apps on one host must not share one) |
| `imports` | `Module[]` | `[]` | The modules that bind `JOBS_METRICS`, `JOBS_EVENT_BUS`, `JOBS_ORG_SCOPE` |

Environment-only (no option): `JOBS_RATELIMIT_MAX_HITS` (10), `JOBS_RATELIMIT_BASE_MS` (30000), `JOBS_RATELIMIT_MAX_MS` (900000), `JOBS_REAPER_ENABLED` (true unless `false`), `JOBS_SYSTEM_MODE_EXTRA_TYPES` (empty). Runtime policy (the stuck threshold, the history retention, node offload) is read through `@marinoscar/platform-api/settings` (`getJobsPolicy`), never an environment variable.

## Extension-point catalog

The extension ladder and a recipe per extension: [docs/EXTENDING.md](../../../../docs/EXTENDING.md).

| Name | Kind | Signature | When to use | Stability | Example |
|---|---|---|---|---|---|
| `JobsModule.forRoot` | option | `forRoot(options?: JobsModuleOptions): DynamicModule` | Mount the queue once, with the app's host ports | experimental | [example](../../../../apps/api/src/platform/jobs/jobs.config.ts) |
| `JobHandler` | hook | `{ type; process(job); label?; profile?; nodeResultSchema?; persistNodeResult?; nodeSecretBroker?; nodeOffloadEnabled?; deriveOutputKey?; canDelete? }` | Implement one job type (server-only: neither node member; node-eligible: both) | stable | [example](../../../../apps/api/src/examples/jobs/example-checksum.handler.ts) |
| `JobHandlerRegistry.register` | registry | `register(handler: JobHandler): void` | Self-register a handler from its `onModuleInit`; a duplicate type warns and the last wins | stable | [example](../../../../apps/api/src/examples/jobs/example-echo.handler.ts) |
| `registerJobTypeLabel` | registry | `registerJobTypeLabel(type: string, label: string): void` | Label a type whose handler is not loaded in this process | experimental | [example](../../../../apps/api/src/examples/jobs/job-type-labels.example.ts) |
| `JobSecretBroker` | hook | `{ kind; usable(); issue(job, until); revoke(handle) }` | A node-eligible type needs a per-job credential (`handler.nodeSecretBroker`) | experimental | [example](../../../../apps/api/test/conformance.spec.ts) |
| `enqueueHousekeepingJob` | hook | `enqueueHousekeepingJob(options: HousekeepingEnqueueOptions): Promise<Job \| null>` | The body of a `@Cron`: decide, then enqueue one system job unless one is in flight | stable | [example](../../../../apps/api/src/platform/telemetry/telemetry-jobs.adapter.ts) |
| `RetentionPurgeRegistry` | registry | `register(entry: { policy: RetentionPolicyKey; type: string; what: string }): void` | A purge handler declares which `retention.*` policy it enforces, from `onModuleInit`; the 01:00 cron enqueues the enabled ones | experimental | [example](../../../../apps/api/test/retention/retention-handlers.integration.spec.ts) |
| `purgeInBatches` | hook | `purgeInBatches(options: BatchedPurgeOptions): Promise<BatchedPurgeResult>` | Delete rows in bounded batches, oldest first, by the exact ids read, with a safety stop | experimental | [example](../../../../apps/api/test/retention/retention-purge.db.spec.ts) |
| `runRetentionPolicyPurge` | hook | `runRetentionPolicyPurge(options: RetentionPolicyPurgeOptions): Promise<BatchedPurgeResult \| null>` | The body of a retention handler: a logged no-op while the policy is off, otherwise `purgeInBatches` and one summary line | experimental | [example](../../../../apps/api/test/retention/retention-purge.db.spec.ts) |
| `JobScope.run` | hook | `run<R, TTx>(job, fn: (tx: TTx) => Promise<R>, options?): Promise<R>` | A handler reads or writes org (RLS) tables as the job's organization | experimental | [example](../../../../apps/api/test/jobs/job-org-id.db.spec.ts) |
| `JobSettledEvent` | event | `@OnEvent(JOB_SETTLED_EVENT) (event: JobSettledEvent)` | React to a job reaching a terminal state (dispatch or one bounded row, never I/O) | stable | [example](../../../../apps/api/test/conformance.spec.ts) |
| `JOBS_METRICS` | token | `unique symbol` -> `JobsMetrics` | Bind the app's `app.jobs.*` instruments (no method takes an organization) | experimental | [example](../../../../apps/api/src/platform/jobs/jobs-host.module.ts) |
| `JOBS_EVENT_BUS` | token | `unique symbol` -> `JobsEventBus` | Bind the cross-replica bus the `jobs.enqueued` wake-up rides | experimental | [example](../../../../apps/api/src/platform/jobs/jobs-host.module.ts) |
| `JOBS_ORG_SCOPE` | token | `unique symbol` -> `JobsOrgScope` | Fill an omitted `orgId` from the app's ambient organization | experimental | [example](../../../../apps/api/src/examples/jobs/ambient-org-scope.example.ts) |
| `onEventNoIoSuite` | registry | `ConformanceSuite<OnEventNoIoOptions>` | Call the listener suite's `check()` directly in a test, or read its id (`on-event-no-io`) | experimental | [example](../../../../apps/api/test/conformance.spec.ts) |
| `OnEventNoIoOptions` | option | `{ minListenerFiles; minListenerBodies?; mustScan?; extraIoMarkers? }` | Give the `on-event-no-io` suite the listener files the app must see and its vacuity minimum | experimental | [example](../../../../apps/api/test/conformance.spec.ts) |

### The optional members of `JobHandler`

Presence is the declaration; there is no flag for any of them.

- `label`: the type's display phrase in the admin list, the insights and the fleet's job types. Unlike `type`, it may change.
- `profile`: exactly `{ maxRuntimeMs, maxAttempts }`. The lease, the renewal interval and the reaper's patience are derived from `maxRuntimeMs`; never add `leaseMs` or `heartbeatMs`.
- `nodeResultSchema` + `persistNodeResult`: both present makes the type node-eligible (`JobHandlerRegistry.serverOnlyTypes()` derives it). An `ai.*` type carries neither, permanently.
- `nodeSecretBroker`: the type needs a per-job credential, issued through `POST /api/nodes/:id/jobs/:jobId/secret`, held in node memory only, revoked on settle.
- `nodeOffloadEnabled`: a deployment's runtime switch (a system setting read at claim time) for offering an eligible type to nodes.
- `deriveOutputKey`: where a node's output upload lands; default `node-outputs/<jobId>/<uuid>`.
- `canDelete`: veto an admin delete of a non-terminal row whose deletion would strand other state.

Supporting exports (experimental unless noted): the services (`JobsService`, `JobClaimService`, `JobLeaseService`, `JobTerminalService`, `JobStuckService`, `ProviderThrottleService`, `NodeOffloadService`, `JobWorker`, `JobAdminService`, `JobInsightsService`, `JobScope`), `JobHistoryPurgeHandler`, the structural data types (`Job`, `JobsPrisma`, `JobStatus`, `JobReason`, `NodeStatus` and the `Jobs*` query types; stable where tagged), `buildDedupKey`, `ACTIVE_DEDUP_INDEX_NAME`, `isActiveDedupConflict`, the execution-profile resolvers, `RateLimitError` and the rate-limit classification, the temp-file helpers, the trace-context helpers (`captureJobTraceContext`, `jobParentContext`, `jobOrgSpanAttributes`), `jobTypeLabel` (stable) and `jobTypeLabels`, `JOB_SETTLED_EVENT` (stable), `JOBS_ENQUEUED_CHANNEL`, `jobsConfiguration`, the policies `DEFAULT_JOBS_POLICY` / `DEFAULT_NODES_POLICY`, the `jobs` settings namespace `JOBS_SYSTEM_SETTINGS` and its merge `mergeJobsSettings`, and `JOBS_PERMISSIONS` (stable).

## Data

The `jobs` fragment of `@marinoscar/platform-db` owns `Job` (`jobs`), `JobStatsRollup` (`job_stats_rollup`), `WorkerNode`, `NodeCredential` and `JobNodeSecret` (the last three are the nodes slice's tables). Migrations: `0008_add_jobs` onward in the base history; #734 adds `0030_add_jobs_org_id` and `0031_add_jobs_org_id_status_index`.

- **`jobs.org_id`**: nullable UUID, FK `organizations(id)` `ON DELETE SET NULL`, index `jobs_org_id_status_idx (org_id, status)` built `CONCURRENTLY` in a migration of its own. `NULL` is a deployment-wide (system) job: housekeeping, fleet sweeps, backups. Deleting an organization keeps its job history; offboarding (#743) cancels the organization's pending jobs explicitly before deleting it.
- **No row-level security on `jobs`**, deliberately. The claim is one cross-organization statement (`FOR UPDATE SKIP LOCKED` over the whole queue), and per-org RLS would need the bypass connection for every claim, renewal and settle. Isolation is enforced at the API: the admin routes are system routes (`jobs:read` / `jobs:write`). A handler that touches tenant tables uses `JobScope.run`.
- **Raw-SQL indexes** (intentional drift, listed in `packages/platform-db/raw-sql-indexes.json`): `jobs_active_dedup_uniq_idx` (one active row per dedup key), `jobs_attempts_gt1_idx`, `jobs_succeeded_duration_idx`. Never replace them with `@@unique` or a `findFirst`.
- **The dedup key is unchanged** by `org_id`: an org-scoped job with no natural subject uses `subjectType: 'organization', subjectId: orgId`.
- Public to an app: every `jobs` column but `claim_token`; `Job.type` strings are permanent once rows of them exist.

## Permissions and settings

Declares `jobs:read` and `jobs:write` (`JOBS_PERMISSIONS`, system scope, granted to `admin` by the seed); every `/api/admin/jobs` route enforces one of them with `@Auth`. Owns the `jobs` system-settings namespace: `JOBS_SYSTEM_SETTINGS` (the history retention, the purge switch, the stuck threshold; defaults `DEFAULT_JOBS_POLICY`; schemas in `@marinoscar/platform-contract/jobs`) and, since #898, the `retention` namespace: `RETENTION_SYSTEM_SETTINGS` (one `{ enabled, days }` per table: `notifications`, `notificationDeliveries`, `auditEvents` (off by default), `aiRuns`; schemas in `@marinoscar/platform-contract/jobs`; the leaf-by-leaf merge `mergeRetentionSettings`). `JobsModule.forRoot()` registers both unless the app's manifest already did (the reference app lists it in [`system-settings.manifest.ts`](../../../../apps/api/src/settings/registry/system-settings.manifest.ts) to pin the key order), so call `forRoot()` before `SettingsModule.forRoot()`. Reads it through `@marinoscar/platform-api/settings` (`getNamespace('jobs')`, or the deprecated `getJobsPolicy`), plus `nodes.jobSecretBrokerEnabled` for node offload.

## UI

None in this package. The jobs, insights and workers pages are in the reference web app (`apps/web/src/pages/Admin/`) and read `GET /api/admin/jobs*`; a follow-up moves them to `@marinoscar/platform-web/jobs`.

## Infra

None. The worker runs in the API process (`JOBS_WORKER_MODE`); remote executors are worker nodes (`infra/compose/worker.compose.yml`, the nodes slice).

## Observability

- **Spans**: `job.process <type>` (CONSUMER) per attempt, a child of the span that enqueued it (the stored `traceparent`); node phases are relayed by the nodes slice. A job's organization is the span attribute `org.id`, on the span active at enqueue and on every job span; a system job has none.
- **Metrics**: `app.jobs.enqueued`, `app.jobs.claimed`, `app.jobs.settled`, `app.jobs.duration`, `app.jobs.reaped` (by `job_type`, `executor`, `outcome`), recorded through `JOBS_METRICS`. **Never `org.id`**: the port has no parameter for it (cardinality; spec "Tenancy and access model"), proven by `apps/api/src/common/otel/app-metrics.service.spec.ts`.
- **Doctor**: `jobs.worker` and `jobs.backlog`.

## Security notes

- Every route declares `@Auth` with `jobs:read` / `jobs:write`; the list publishes no `payload` and no `claimToken`.
- A node never persists a job-scoped credential: a handler declares the need with `nodeSecretBroker`, and the nodes slice issues it per job, bounded by the lease; `job_node_secrets` stores the handle only.
- AI job types are server-only, permanently: a user's or the organization's key is never brokered to a node.
- `JobScope.run` sets `app.org_id` transaction-locally (`set_config(…, true)`), never a session `SET`; it refuses a system job rather than falling back to a bypass.

## Conformance suite

The invariants run in the reference app over the app's and this package's source roots, from one entry, [`apps/api/test/conformance.spec.ts`](../../../../apps/api/test/conformance.spec.ts), through `runPlatformConformance()`:

| Suite id (option key) | Registered by | Enforces | Options |
|---|---|---|---|
| `cron-enqueue-only` (`cronEnqueueOnly`) | `@marinoscar/platform-api/testing` | Every `@Cron` enqueues; exactly three exemptions, pinned to their roots: `packages/platform-api/src/jobs/tasks/job-stuck-reset.task.ts`, `packages/platform-api/src/jobs/tasks/temp-file-janitor.task.ts`, `packages/platform-api/src/nodes/tasks/node-secret-sweep.task.ts`. A fourth exemption needs the spec and the app's `EXEMPT` list. | `exempt`, `minCronFiles` |
| `on-event-no-io` (`onEventNoIo`) | `@marinoscar/platform-api/jobs/testing` | No event-listener body does storage I/O (a direct storage-provider call, `.download(`, `.upload(`). Bounded single-row writes in a listener are outside the rule. | `minListenerFiles`, `minListenerBodies?`, `mustScan?`, `extraIoMarkers?` |
| `ai-jobs-server-only` (`aiJobsServerOnly`) | `@marinoscar/platform-api/ai/testing` | Every `ai.*` job type is server-only, derived from `serverOnlyTypes()` (see the [AI README](../ai/README.md#conformance-suite)). | `fixture` |

How an app runs the listener suite:

```ts
import '@marinoscar/platform-api/jobs/testing'; // registers the suite
runPlatformConformance({
  sourceRoots: CRON_SOURCE_ROOTS, // the app's sources and every packaged slice's, so their listeners are scanned
  suites: { onEventNoIo: { minListenerFiles: 5, mustScan: ['ops/node-secret-revoker.ts'] } },
});
```

`test/jobs/testing/on-event-no-io.spec.ts` proves the suite fails on a planted storage download, an upload and an app marker. Also pinned in the reference app:

- Job-type snapshot (`apps/api/test/jobs/job-type-snapshot.spec.ts`): "job type strings are permanent", and every label unchanged in `GET /api/admin/jobs`.
- The claim is unchanged by `org_id` (`apps/api/test/jobs/job-claim.db.spec.ts`), and `jobs.org_id`, the organization-subject dedup and `JobScope.run` under RLS (`apps/api/test/jobs/job-org-id.db.spec.ts`).

## Upgrade notes

New as a package subpath in this version (the code moved from `apps/api/src/jobs/`):

- Import from `@marinoscar/platform-api/jobs` instead of `../jobs/...`; mount `JobsModule.forRoot({ imports: [<host module>] })` and bind the ports.
- `JOB_TYPE_LABELS` is gone: give each handler a `readonly label`, or call `registerJobTypeLabel`.
- `jobs.org_id` arrives with migrations `0030` and `0031` (`npm run db:sync`, then `prisma:migrate`). Existing rows are system jobs (`NULL`).
- `GET /api/admin/jobs` gains an optional `orgId` filter and an `orgId` field (additive).
- The cron-enqueue-only exemption paths changed; an app's own exemption list must name the new paths with their `root`.
- #898: the retention engine moved here from the reference app's `common/retention/` (and the duplicate `ai/runtime/batched-purge.ts` is gone). `JobsModule.forRoot()` now provides the 01:00 `RetentionPurgeTask`, `RetentionPurgeRegistry` and `AuditEventsPurgeHandler`, and registers the `retention` namespace (`RETENTION_SYSTEM_SETTINGS`) unless the manifest lists it. An app deletes its `RetentionModule` and its copies of the batched purge, the cron, the namespace file and the two notification handlers; a purge handler of its own declares its policy with `RetentionPurgeRegistry.register`. Job type strings, the schedule and the OpenAPI document are unchanged.
- #865: the `jobs` namespace declaration is the slice's (`JOBS_SYSTEM_SETTINGS`), and `JobsModule.forRoot()` registers it. An app that copied the reference app's `platform/jobs/jobs.system-settings.ts` deletes its copy and imports the packaged one into its manifest (or drops it from the manifest, accepting that `jobs` is then appended after the manifest's keys); `forRoot()` must run before `SettingsModule.forRoot()`.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `JobScope.run(): job … is a system job` | The handler's job was enqueued with `orgId: null` (or none, with no ambient scope) | Enqueue it with the organization's `orgId`, or use the system client for deployment-wide work |
| Two organizations' jobs collapse onto one row | Same type and subject; the organization is not part of the dedup key | Use `subjectType: 'organization', subjectId: orgId` for a subject-less org job |
| A type shows its dotted key in the admin list | No `label` on its handler (or the handler is not loaded here) | Add `readonly label`, or `registerJobTypeLabel(type, label)` |
| `job-type-snapshot.spec` fails with "Job type strings are permanent" | A registered type disappeared | Restore the type string; rows of it outlive the handler |
| `JobsModule.forRoot() registers the system settings namespace(s) "jobs", but SettingsModule.forRoot() already composed ...` | `JobsModule.forRoot()` ran after `SettingsModule.forRoot()`, without the app's manifest registering `jobs` | Call `JobsModule.forRoot()` first, or register `JOBS_SYSTEM_SETTINGS` in the app's manifest |
| The nightly purge logs that its policy is missing | The `jobs` namespace is not registered (a version before #865, or the registries froze before `JobsModule.forRoot()`) | Upgrade, or register `JOBS_SYSTEM_SETTINGS` in the manifest |

## Links

- [The recipe: add a job type](handlers/README.md)
- [The nodes slice](../nodes/README.md)
- [The contract: `@marinoscar/platform-contract/jobs`](../../../platform-contract/src/jobs/README.md)
- [Spec: job queue](../../../../docs/specs/job-queue.md), [spec: worker nodes](../../../../docs/specs/worker-nodes.md)
- [Platform packages spec](../../../../docs/specs/platform-packages.md)
