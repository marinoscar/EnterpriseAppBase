// =============================================================================
// The reference app's jobs and nodes slices, configured once (issue #734)
// =============================================================================
//
// `JobsModule` and `NodesModule` here are the CONFIGURED dynamic modules of
// `@marinoscar/platform-api/jobs` and `/nodes`, built once at import time:
// every app module that imports `JobsModule` imports this one object, so
// there is exactly one queue (the module is also global). The environment
// (`JOBS_*`, `NODE_*_ENABLED`) stays the deployment's configuration: no
// option is passed that it already decides.
// =============================================================================

import { APP_NAME } from '@app/shared';
import { JobsModule as PlatformJobsModule } from '@marinoscar/platform-api/jobs';
import { NodesModule as PlatformNodesModule } from '@marinoscar/platform-api/nodes';

import { JobsHostModule } from './jobs-host.module';

/** The queue: `JobsModule.forRoot()` with the app's name (the temp-file prefix) and its host ports. */
export const JobsModule = PlatformJobsModule.forRoot({ appName: APP_NAME, imports: [JobsHostModule] });

/** The worker-node fleet: `NodesModule.forRoot()` with the app's host ports. */
export const NodesModule = PlatformNodesModule.forRoot({ imports: [JobsHostModule] });
