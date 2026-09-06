import { Module } from '@nestjs/common';

import { ExampleEchoHandler } from './handlers/example-echo.handler';
import { JobClaimService } from './job-claim.service';
import { JobHandlerRegistry } from './job-handler.registry';
import { JobTerminalService } from './job-terminal.service';
import { JobsService } from './jobs.service';
import { ProviderThrottleService } from './provider-throttle.service';

// =============================================================================
// JobsModule (issues #259, #260 and #261, epic #254)
// =============================================================================
//
// STILL NOTHING THAT RUNS ON ITS OWN. #259 shipped the queue's extension
// point — the handler contract, the registry that collects handlers, and one
// worked example. #260 added the two halves of moving a row through the
// table: `JobsService` (enqueue, with dedup decided by the partial unique
// index) and `JobClaimService` (the atomic `FOR UPDATE SKIP LOCKED` claim).
// #261 adds the other end of that movement — `JobTerminalService`, the one
// component that decides what happens to a row once it stops running, plus
// the `ProviderThrottleService` cooldown gate it trips on a provider rate
// limit. Still nothing polls, and no timer exists here yet: the thing that
// calls `claim()` on a tick and `completeSucceeded`/`completeFailed`
// afterwards is the in-process worker pool (#262). Queue hygiene — lease
// reaper, history purge, temp-file janitor (#263) — lands here too.
//
// `JOB_CLOCK` and `JOB_RANDOM` are DELIBERATELY NOT PROVIDED. Both services
// fall back to the real clock and `Math.random` when the optional token
// resolves to nothing, so an application always runs on real time and real
// jitter, and only a test that constructs a service directly can substitute
// either. Providing them here would create a seam a fork could fill by
// accident.
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
// `PrismaService` is not imported here: `PrismaModule` is `@Global()`.
// `EventEmitter2` is likewise global — `EventEmitterModule.forRoot()` in
// `app.module.ts` — so the settled event needs no import either.
// =============================================================================

@Module({
  providers: [
    JobHandlerRegistry,
    ExampleEchoHandler,
    JobsService,
    JobClaimService,
    ProviderThrottleService,
    JobTerminalService,
  ],
  exports: [
    JobHandlerRegistry,
    ExampleEchoHandler,
    JobsService,
    JobClaimService,
    ProviderThrottleService,
    JobTerminalService,
  ],
})
export class JobsModule {}
