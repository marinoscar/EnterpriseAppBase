import { Module } from '@nestjs/common';

import { SettingsModule } from '../settings/settings.module';
import { ExampleEchoHandler } from './handlers/example-echo.handler';
import { JobHistoryPurgeHandler } from './handlers/job-history-purge.handler';
import { JobAdminController } from './job-admin.controller';
import { JobAdminService } from './job-admin.service';
import { JobInsightsService } from './job-insights.service';
import { JobClaimService } from './job-claim.service';
import { JobHandlerRegistry } from './job-handler.registry';
import { JobStuckService } from './job-stuck.service';
import { JobTerminalService } from './job-terminal.service';
import { JobWorker } from './job.worker';
import { JobsService } from './jobs.service';
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
// `job-handler.registry.ts`'s, and §1.3 of docs/specs/job-queue.md.
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
// `ExampleEchoHandler` is exported so a fork can see the worked example wired
// the same way its own handlers will be, and so tests can resolve it from
// this module rather than reconstructing it. It is provided HERE rather than
// in a feature module only because it belongs to no feature; a real handler
// lives with the feature it serves (see `handlers/README.md`, step 3).
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
// `PrismaService` is not imported here: `PrismaModule` is `@Global()`.
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
// `SettingsModule` IS NOW IMPORTED, and it is the only new module dependency:
// the reaper reads `jobs.stuckThresholdMinutes` and the purge reads
// `jobs.history.*`, both through `SystemSettingsService`'s narrow
// `getJobsPolicy()` accessor. The direction is acyclic — settings depends on
// nothing here — and it mirrors `NotificationsModule`, which imports
// `SettingsModule` for exactly the same kind of read.
// =============================================================================

@Module({
  imports: [SettingsModule],
  controllers: [JobAdminController],
  providers: [
    JobAdminService,
    JobInsightsService,
    JobHandlerRegistry,
    ExampleEchoHandler,
    JobHistoryPurgeHandler,
    JobsService,
    JobClaimService,
    ProviderThrottleService,
    JobTerminalService,
    JobStuckService,
    JobWorker,
    JobStuckResetTask,
    JobHistoryPurgeTask,
    TempFileJanitorTask,
  ],
  exports: [
    JobHandlerRegistry,
    ExampleEchoHandler,
    JobHistoryPurgeHandler,
    JobsService,
    JobClaimService,
    ProviderThrottleService,
    JobTerminalService,
    JobStuckService,
  ],
})
export class JobsModule {}
