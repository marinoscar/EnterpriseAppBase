import { Module } from '@nestjs/common';

import { ExampleEchoHandler } from './handlers/example-echo.handler';
import { JobHandlerRegistry } from './job-handler.registry';

// =============================================================================
// JobsModule (issue #259, epic #254)
// =============================================================================
//
// DELIBERATELY MINIMAL. #259 ships the queue's extension point — the handler
// contract, the registry that collects handlers, and one worked example — and
// nothing that runs. The rest of Phase 1 adds its pieces here: enqueue with
// index-backed dedup and the atomic `SKIP LOCKED` claim (#260), the terminal
// state machine — retry, rate-limit deferral, throttle gate, settled event
// (#261), the in-process worker pool with worker modes and per-job timeouts
// (#262), and queue hygiene — lease reaper, history purge, temp-file janitor
// (#263).
//
// -----------------------------------------------------------------------------
// WHAT IS EXPORTED, AND WHY BOTH
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
// =============================================================================

@Module({
  providers: [JobHandlerRegistry, ExampleEchoHandler],
  exports: [JobHandlerRegistry, ExampleEchoHandler],
})
export class JobsModule {}
