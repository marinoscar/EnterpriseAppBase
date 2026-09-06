// =============================================================================
// NodesModule — the control plane, deliberately NOT the credential module
// (issue #268, epic #254)
// =============================================================================
//
// This is the heavy half of `src/nodes/`. `NodeCredentialModule` beside it is
// `@Global`, imports `PrismaModule` and nothing else, and exists to give
// `JwtAuthGuard` one small service; this one imports `JobsModule` and is
// imported by nobody. That split was designed in #267 and its reasoning is
// worth re-stating from this side, because THIS is the module whose weight it
// was protecting the guard from:
//
//   `JwtAuthGuard` runs on nearly every authenticated route in the
//   application. If node credentials lived here, the guard would depend on a
//   module that depends on `JobsModule`, whose own controller uses `@Auth()`,
//   whose guard depends on this module — a cycle Nest reports at boot, and
//   one that gets "fixed" under time pressure with `forwardRef`, making the
//   cycle invisible rather than absent. Same directory, so the relationship
//   is obvious; different modules, so the graph stays acyclic.
//
// -----------------------------------------------------------------------------
// ONE IMPORT, AND IT IS THE POINT OF THE WHOLE ISSUE
// -----------------------------------------------------------------------------
//
// `JobsModule` is imported for exactly three of its exports:
//
//   - `JobClaimService` — so the node plane takes rows with THE SAME
//     `FOR UPDATE SKIP LOCKED` statement the in-process worker uses. That
//     shared statement is the only reason a node and the server can poll
//     concurrently without ever receiving the same row.
//   - `JobTerminalService` — so a node-reported outcome reaches the same
//     conclusions (attempt budget, rate-limit deferral, settled event,
//     backoff) that an in-process handler's would.
//   - `JobHandlerRegistry` — so "which types can a node run" is derived from
//     the handlers themselves rather than from a list somebody maintains.
//
// The direction is one-way: nothing in `JobsModule` imports this module, and
// nothing should. The queue does not need to know that nodes exist — a node
// is one more claimer of rows, which is precisely what `ClaimOptions`
// carrying `nodeId` and `executor` encodes.
//
// NOT `@Global`, and NOT EXPORTING `NodesService`. Its only caller is the
// controller in this module. A feature module that could inject it could
// claim jobs on a node's behalf or settle a job outside the terminal
// chokepoint, and neither is a capability any feature should have — the same
// argument `JobsModule` makes for not exporting `JobWorker`.
//
// `PrismaModule` is not imported here: it is `@Global()`. `ConfigService`
// likewise, via `ConfigModule.forRoot({ isGlobal: true })`.
// =============================================================================

import { Module } from '@nestjs/common';

import { JobsModule } from '../jobs/jobs.module';
import { NodesController } from './nodes.controller';
import { NodesService } from './nodes.service';

@Module({
  imports: [JobsModule],
  controllers: [NodesController],
  providers: [NodesService],
})
export class NodesModule {}
