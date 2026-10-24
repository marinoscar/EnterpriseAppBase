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
// job enqueued without `orgId` is a system job. `nodeObjectStoreBinding`
// (`@marinoscar/platform-api/storage`, #736) carries the compile-time proof
// that the `StorageProvider` satisfies `NodeObjectStore`.
// =============================================================================

import { Global, Module } from '@nestjs/common';
import { JOBS_EVENT_BUS, JOBS_METRICS } from '@marinoscar/platform-api/jobs';
import { NODE_JOB_INPUTS } from '@marinoscar/platform-api/nodes';

import { AppMetricsService, EVENT_BUS } from '@marinoscar/platform-api/host';
import { StorageProvidersModule, nodeObjectStoreBinding } from '@marinoscar/platform-api/storage';
import { NodeJobInputsAdapter } from './node-job-inputs.adapter';

const BINDINGS = [
  { provide: JOBS_METRICS, useExisting: AppMetricsService },
  { provide: JOBS_EVENT_BUS, useExisting: EVENT_BUS },
  // The storage slice's ready-made binding (#736): signed GET and PUT through STORAGE_PROVIDER.
  nodeObjectStoreBinding,
  { provide: NODE_JOB_INPUTS, useClass: NodeJobInputsAdapter },
];

@Global()
@Module({
  imports: [StorageProvidersModule],
  providers: BINDINGS,
  exports: BINDINGS.map((binding) => binding.provide),
})
export class JobsHostModule {}
