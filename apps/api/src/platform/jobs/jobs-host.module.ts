// =============================================================================
// The reference app's bindings of the jobs and nodes slices' host ports
// (issue #734)
// =============================================================================
//
// `@Global()`, passed to `JobsModule.forRoot({ imports })` and
// `NodesModule.forRoot({ imports })` (./jobs.config.ts):
//
//   JOBS_METRICS       -> AppMetricsService   (the `app.jobs.*` instruments)
//   JOBS_EVENT_BUS     -> EVENT_BUS           (the cross-replica wake-up)
//   NODE_OBJECT_STORE  -> STORAGE_PROVIDER    (two calls: signed GET and PUT)
//   NODE_JOB_INPUTS    -> NodeJobInputsAdapter (a held job's input object)
//
// `JOBS_ORG_SCOPE` is not bound: the app tracks no ambient organization, so a
// job enqueued without `orgId` is a system job. The `StorageProvider`
// satisfies `NodeObjectStore` at compile time (below), so the binding cannot
// drift from the port.
// =============================================================================

import { Global, Module } from '@nestjs/common';
import { JOBS_EVENT_BUS, JOBS_METRICS } from '@marinoscar/platform-api/jobs';
import { NODE_JOB_INPUTS, NODE_OBJECT_STORE, type NodeObjectStore } from '@marinoscar/platform-api/nodes';

import { EVENT_BUS } from '../../common/event-bus/event-bus.interface';
import { AppMetricsService } from '../../common/otel/app-metrics.service';
import { STORAGE_PROVIDER, type StorageProvider } from '../../storage/providers/storage-provider.interface';
import { StorageProvidersModule } from '../../storage/providers/storage-providers.module';
import { NodeJobInputsAdapter } from './node-job-inputs.adapter';

/** Compile-time proof that the app's storage provider satisfies the nodes slice's port. */
type AssertAssignable<_From extends _To, _To> = true;
export type StorageProviderIsNodeObjectStore = AssertAssignable<StorageProvider, NodeObjectStore>;

const BINDINGS = [
  { provide: JOBS_METRICS, useExisting: AppMetricsService },
  { provide: JOBS_EVENT_BUS, useExisting: EVENT_BUS },
  { provide: NODE_OBJECT_STORE, useExisting: STORAGE_PROVIDER },
  { provide: NODE_JOB_INPUTS, useClass: NodeJobInputsAdapter },
];

@Global()
@Module({
  imports: [StorageProvidersModule],
  providers: BINDINGS,
  exports: BINDINGS.map((binding) => binding.provide),
})
export class JobsHostModule {}
