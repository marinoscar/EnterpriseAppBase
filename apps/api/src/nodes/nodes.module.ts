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
// TWO IMPORTS, AND THE FIRST IS THE POINT OF THE WHOLE ISSUE
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
// -----------------------------------------------------------------------------
// `StorageProvidersModule`, AND WHY IT IS NOT `StorageModule` (#269)
// -----------------------------------------------------------------------------
//
// The data plane needs exactly one thing out of storage: `STORAGE_PROVIDER`,
// so it can mint a signed URL. `StorageProvidersModule` provides that and
// nothing else — no controller, no `ObjectsService`, no processing pipeline,
// no event emitter subscriptions.
//
// REJECTED: importing `StorageModule`. It would bring `ObjectsController` and
// `ObjectsService` into this graph for a capability we do not want, and worse,
// it would put `ObjectsService.getDownloadUrl` within reach — the method that
// applies a PER-USER OWNERSHIP CHECK. A node is a trusted internal executor,
// not a user acting on their own file, and the owner a `nod_` credential
// resolves to has no relationship to whoever uploaded the object a job is
// about; routing a node through that check would `403` every cross-user job.
// `node-data-plane.service.ts`'s header states the full argument. Not
// importing the module is what keeps the wrong method out of reach.
//
// `NodeDataPlaneService` is a provider and not an export, exactly like
// `NodesService`: its only caller is the controller in this module, and a
// feature module that could inject it could mint storage capabilities against
// any job it could name.
//
// NOT `@Global`, and NOT EXPORTING `NodesService`. Its only caller is the
// controller in this module. A feature module that could inject it could
// claim jobs on a node's behalf or settle a job outside the terminal
// chokepoint, and neither is a capability any feature should have — the same
// argument `JobsModule` makes for not exporting `JobWorker`.
//
// -----------------------------------------------------------------------------
// `SettingsModule`, THE TWO CRONS AND THE ADMIN PLANE (#270)
// -----------------------------------------------------------------------------
//
// `SettingsModule` is imported for exactly one thing: `SystemSettingsService`'s
// narrow `getNodesPolicy()` accessor, behind which `NodeLifecycleService` reads
// the stale window, the offline multiplier and the offline retention. The
// direction is acyclic — settings depends on nothing here — and it mirrors
// `JobsModule`, which imports it for `getJobsPolicy()` for the identical
// reason.
//
// `NodeStaleOfflineTask` and `NodeOfflinePruneTask` are registered here as
// plain providers, exactly as `JobStuckResetTask` is in `JobsModule` and
// `StorageCleanupTask` is in `StorageModule`; `ScheduleModule.forRoot()` in
// `app.module.ts` is what makes their `@Cron` methods fire. Neither is
// exported: nothing outside this module should be able to trigger a sweep.
// ⚠ THE PAIR IS ORDERED, NOT INDEPENDENT — the prune selects `offline` rows,
// which only the sweep produces for a node that crashed. Their headers carry
// the argument; do not register one without the other.
//
// `NodesAdminController` is mounted here rather than in a module of its own so
// that the two node planes are configured, tested and reviewed together, and
// so the `nod_` allowlist argument above stays visible from both. It is a
// SEPARATE controller on a SEPARATE prefix (`admin/nodes`) precisely because
// everything under `NodesController` is reachable by a worker token, and
// nothing on the admin plane may be. `NodesAdminService` is a provider and not
// an export, like every other service here: it performs no ownership check at
// all, and a feature module that could inject it could read or delete any
// node in the deployment.
//
// `PrismaModule` is not imported here: it is `@Global()`. `ConfigService`
// likewise, via `ConfigModule.forRoot({ isGlobal: true })`.
// =============================================================================

import { Module } from '@nestjs/common';

import { JobsModule } from '../jobs/jobs.module';
import { SettingsModule } from '../settings/settings.module';
import { StorageProvidersModule } from '../storage/providers/storage-providers.module';
import { NodeDataPlaneService } from './node-data-plane.service';
import { NodeLifecycleService } from './node-lifecycle.service';
import { NodesAdminController } from './nodes-admin.controller';
import { NodesAdminService } from './nodes-admin.service';
import { NodesController } from './nodes.controller';
import { NodesService } from './nodes.service';
import { NodeOfflinePruneTask } from './tasks/node-offline-prune.task';
import { NodeStaleOfflineTask } from './tasks/node-stale-offline.task';

@Module({
  imports: [JobsModule, SettingsModule, StorageProvidersModule],
  controllers: [NodesController, NodesAdminController],
  providers: [
    NodesService,
    NodeDataPlaneService,
    NodesAdminService,
    NodeLifecycleService,
    NodeStaleOfflineTask,
    NodeOfflinePruneTask,
  ],
})
export class NodesModule {}
