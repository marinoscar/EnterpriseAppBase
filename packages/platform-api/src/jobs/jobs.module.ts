import { DynamicModule, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { JobsBacklogDoctorCheck } from './doctor/jobs-backlog.doctor-check';
import { JobsWorkerDoctorCheck } from './doctor/jobs-worker.doctor-check';
import { JobHistoryPurgeHandler } from './handlers/job-history-purge.handler';
import { JobAdminController } from './job-admin.controller';
import { JobAdminService } from './job-admin.service';
import { JobClaimService } from './job-claim.service';
import { JobHandlerRegistry } from './job-handler.registry';
import { JobInsightsService } from './job-insights.service';
import { JobLeaseService } from './job-lease.service';
import { JobStuckService } from './job-stuck.service';
import { configureJobTempPrefix } from './job-temp';
import { JobTerminalService } from './job-terminal.service';
import { JobWorker } from './job.worker';
import { JOBS_OPTIONS, jobsConfigOverlay, resolveJobsModuleOptions, type JobsModuleOptions } from './jobs.options';
import { JobsService } from './jobs.service';
import { JobScope } from './job-scope';
import { NodeOffloadService } from './node-offload.service';
import { ProviderThrottleService } from './provider-throttle.service';
import { JobHistoryPurgeTask } from './tasks/job-history-purge.task';
import { JobStuckResetTask } from './tasks/job-stuck-reset.task';
import { TempFileJanitorTask } from './tasks/temp-file-janitor.task';

// =============================================================================
// JobsModule (issues #259 - #265, epic #254)
// =============================================================================
//
// #259 shipped the queue's extension
// point — the handler contract, the registry that collects handlers, and one
// worked example. #260 added the two halves of moving a row through the
// table: `JobsService` (enqueue, with dedup decided by the partial unique
// index) and `JobClaimService` (the atomic `FOR UPDATE SKIP LOCKED` claim).
// #261 adds the other end of that movement — `JobTerminalService`, the one
// component that decides what happens to a row once it stops running, plus
// the `ProviderThrottleService` cooldown gate it trips on a provider rate
// limit. Still nothing polls, and no timer exists here yet: the thing that
// calls `claim()` on a tick and `completeSucceeded`/`completeFailed`
// afterwards is the in-process worker pool — and #262 adds it: `JobWorker`
// is the first provider in this module that runs on its own. #263 adds the
// three timers that keep the queue from degrading on its own — the lease
// reaper, the nightly history purge and the temp-file janitor — plus the
// first job type in this repository that does real work.
//
// ⚠ `JobWorker` STARTS FROM `onApplicationBootstrap`, NOT `onModuleInit`, and
// that is a correctness constraint rather than a style choice: handlers
// self-register from their own `onModuleInit`, and a worker polling in the
// same lifecycle phase would race them. See `job.worker.ts`'s header,
// `job-handler.registry.ts`'s, and docs/specs/job-queue.md, "Registration".
//
// `JOB_CLOCK` and `JOB_RANDOM` are DELIBERATELY NOT PROVIDED. Both services
// fall back to the real clock and `Math.random` when the optional token
// resolves to nothing, so an application always runs on real time and real
// jitter, and only a test that constructs a service directly can substitute
// either. Providing them here would create a seam a fork could fill by
// accident.
//
// #265 adds `JobInsightsService`, the queue's analytical read: throughput
// percentiles over a bounded window, a per-type completion estimate, and
// all-time totals merged out of `JobStatsRollup`. It is a PROVIDER AND NOT AN
// EXPORT, like `JobAdminService` beside it — its only caller is the controller
// in this module, and it holds the one contract in this file that a second
// caller could break by accident: every statement it issues must stay a pure
// `SELECT`, so that reporting on the queue can never lock the queue. See its
// header. It reads the worker concurrency through `resolveWorkerConcurrency`
// exported from `job.worker.ts` rather than by injecting `JobWorker`, for the
// same reason `TempFileJanitorTask` reads the mode through `parseWorkerMode`:
// what it needs is a configuration answer, and anything holding the pool could
// stop it.
//
// -----------------------------------------------------------------------------
// WHAT IS EXPORTED, AND WHY EACH
// -----------------------------------------------------------------------------
//
// `JobHandlerRegistry` is exported because every feature module that owns a
// handler needs to inject it — that is how a handler self-registers, and
// there is no other way in. Unlike `NotificationsModule`'s deliberately
// narrow export list, there is nothing to protect here: the registry holds
// code references, not user data, and a module that can reach it can already
// reach the handler classes it would register.
//
// The worked examples (`example.echo`, server-only, and `example.checksum`,
// node-eligible, #269) are NOT here since #734: they are the reference app's
// (`apps/api/src/examples/jobs/`, registered by its `ExamplesModule`), which
// is where a fork's own handlers live too. That also took the queue's only
// dependency on object storage (`StorageProvidersModule`, for the checksum's
// server-side `process`) out of this slice.
//
// `JobsService` is exported because EVERY feature module that queues work
// needs it — that is step 4 of the extension recipe, and there is no other
// way to create a `jobs` row that honours the dedup contract.
//
// `JobClaimService` is exported for a narrower reason: it has exactly two
// callers in this epic, the in-process worker (#262) and the node control
// plane (#268), and both must use THE SAME claim statement. Exporting it is
// what makes "write your own claim query" the obviously wrong path rather
// than the only available one.
//
// `JobTerminalService` is exported for exactly the reason it exists: its two
// callers — the in-process worker (#262) and the node control plane (#268) —
// MUST reach the same conclusion about a job that stopped running, and they
// can only do that by calling the same code. Exporting it makes "write your
// own terminal update" the obviously wrong path rather than the only
// available one, the same argument `JobClaimService` makes for the claim.
//
// `JobLeaseService` is exported for the same reason `JobClaimService` is, and
// it is the third member of that set (#347): claiming a row, KEEPING it, and
// settling it are the three writes an executor makes, and both executors —
// the in-process worker and the node control plane — must make each of them
// with the same statement. Renewal was the one of the three that had no shared
// implementation, so the in-process worker simply did not do it, and every job
// that ran longer than the stuck threshold was reaped mid-run and executed
// twice. Exporting it makes "write your own lease update" the obviously wrong
// path rather than the only available one.
//
// `ProviderThrottleService` is exported because a fork's handler needs it
// twice: once at `onModuleInit` to map its job type to a provider key, and
// once around the provider call itself to `acquire()` the gate. Neither is
// reachable from `JobTerminalService`.
//
// `JobWorker` is NOT exported, and that is deliberate. Nothing should reach
// it: it has no method a feature module wants, and the two it does have
// (`start`/`stop`) exist for the lifecycle hooks and for tests. A module that
// could inject it could stop the pool, which is not a capability any feature
// should have. Contrast every export above, each of which exists because some
// other module genuinely cannot do its job without it.
//
// The database is the core port `PLATFORM_PRISMA`, bound globally by the
// app's `PlatformHostModule`; it needs no import here.
// `EventEmitter2` is likewise global — `EventEmitterModule.forRoot()` in
// `app.module.ts` — so the settled event needs no import either.
//
// -----------------------------------------------------------------------------
// WHAT #263 ADDS: THREE TIMERS, ONE SERVICE AND THE FIRST REAL HANDLER
// -----------------------------------------------------------------------------
//
// `JobStuckResetTask` (the lease reaper, every ten minutes),
// `JobHistoryPurgeTask` (queues the nightly purge) and `TempFileJanitorTask`
// (sweeps abandoned scratch files, on init and hourly) are registered here
// exactly as `TokenCleanupTask` is in `AuthModule` and `StorageCleanupTask` in
// `StorageModule` — plain providers whose `@Cron` methods `ScheduleModule
// .forRoot()` in `app.module.ts` discovers. None of the three is exported:
// nothing outside this module should be able to trigger a sweep, and the two
// that have anything worth reusing expose it through `JobStuckService`.
//
// `JobStuckService` IS exported, and that is the whole point of it existing
// separately from the task that drives it: the admin "reset stuck jobs"
// control and any later node-plane sweeper must ask the same question and take
// the same two-phase action, which they can only do by calling the same code.
// Its header explains why these primitives may not live in an admin service.
//
// `JobHistoryPurgeHandler` is provided here for the same reason
// `ExampleEchoHandler` is — it belongs to no feature; it belongs to the queue —
// and it self-registers from its own `onModuleInit` like any other handler. It
// is exported so a fork can resolve it in a test without rebuilding this
// module.
//
// The reaper reads `jobs.stuckThresholdMinutes` and the purge reads
// `jobs.history.*`, both through `SystemSettingsService`'s narrow
// `getJobsPolicy()` accessor. `SettingsModule.forRoot()` is global
// (`@marinoscar/platform-api/settings`), so it needs no import here either.
//
// -----------------------------------------------------------------------------
// PACKAGED (#734): ONE `forRoot`, GLOBAL
// -----------------------------------------------------------------------------
//
// `JobsModule.forRoot(options)` is called once per app and is GLOBAL: every
// feature module whose handler self-registers injects `JobHandlerRegistry`
// (and `JobsService`) without importing anything, and so does the nodes
// slice. A module that still lists the configured module in its `imports`
// (the reference app does, for readability) gets the same single instance.
// =============================================================================


const EXPORTED = [
  JobHandlerRegistry,
  NodeOffloadService,
  JobHistoryPurgeHandler,
  JobsService,
  JobClaimService,
  JobLeaseService,
  ProviderThrottleService,
  JobTerminalService,
  JobStuckService,
  JobScope,
] as const;

const INTERNAL = [
  JobAdminService,
  JobInsightsService,
  JobWorker,
  JobStuckResetTask,
  JobHistoryPurgeTask,
  TempFileJanitorTask,
  JobsWorkerDoctorCheck,
  JobsBacklogDoctorCheck,
] as const;

/**
 * The jobs slice: the background queue (enqueue with dedup, the atomic claim,
 * leases, the terminal state machine, provider throttling), the in-process
 * worker pool, the lease reaper, the temp-file janitor, the job-history purge,
 * the `/api/admin/jobs` routes and the `jobs.*` Doctor checks.
 *
 * @stability experimental
 */
@Module({})
export class JobsModule {
  /**
   * The slice for one app. Call once.
   *
   * @param options - see {@link JobsModuleOptions}.
   * @returns the dynamic module (global). It provides and exports
   *   `JobHandlerRegistry`, `JobsService`, `JobClaimService`,
   *   `JobLeaseService`, `JobTerminalService`, `JobStuckService`,
   *   `ProviderThrottleService`, `NodeOffloadService`,
   *   `JobHistoryPurgeHandler` and `JOBS_OPTIONS`.
   * @throws Error when an option is invalid.
   *
   * @example
   * ```ts
   * JobsModule.forRoot({ appName: APP_NAME, imports: [JobsHostModule] });
   * ```
   *
   * @extensionPoint option
   * @stability experimental
   */
  static forRoot(options: JobsModuleOptions = {}): DynamicModule {
    const resolved = resolveJobsModuleOptions(options);
    if (resolved.appName !== undefined) configureJobTempPrefix(resolved.appName);

    // Only when something is overridden: `forRoot({})` reads the app's own
    // global `ConfigService`, exactly as before the move.
    const overlay =
      Object.keys(resolved.overrides).length > 0
        ? [{ provide: ConfigService, useValue: jobsConfigOverlay(resolved.overrides) }]
        : [];

    return {
      module: JobsModule,
      global: true,
      imports: [...resolved.imports],
      controllers: [JobAdminController],
      providers: [{ provide: JOBS_OPTIONS, useValue: resolved }, ...overlay, ...EXPORTED, ...INTERNAL],
      exports: [JOBS_OPTIONS, ...EXPORTED],
    };
  }
}
