import { Module } from '@nestjs/common';

import { ExampleEchoHandler } from './handlers/example-echo.handler';
import { JobClaimService } from './job-claim.service';
import { JobHandlerRegistry } from './job-handler.registry';
import { JobsService } from './jobs.service';

// =============================================================================
// JobsModule (issues #259 and #260, epic #254)
// =============================================================================
//
// STILL NOTHING THAT RUNS ON ITS OWN. #259 shipped the queue's extension
// point — the handler contract, the registry that collects handlers, and one
// worked example. #260 adds the two halves of moving a row through the table:
// `JobsService` (enqueue, with dedup decided by the partial unique index) and
// `JobClaimService` (the atomic `FOR UPDATE SKIP LOCKED` claim). Neither
// polls, and no timer exists here yet — the thing that calls `claim()` on a
// tick is the in-process worker pool (#262). The rest of Phase 1 adds its
// pieces here too: the terminal state machine — retry, rate-limit deferral,
// throttle gate, settled event (#261) — and queue hygiene — lease reaper,
// history purge, temp-file janitor (#263).
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
// `PrismaService` is not imported here: `PrismaModule` is `@Global()`.
// =============================================================================

@Module({
  providers: [JobHandlerRegistry, ExampleEchoHandler, JobsService, JobClaimService],
  exports: [JobHandlerRegistry, ExampleEchoHandler, JobsService, JobClaimService],
})
export class JobsModule {}
