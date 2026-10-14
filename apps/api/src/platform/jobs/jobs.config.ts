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
//
// The app's namespace manifests FIRST (#865): each `forRoot()` below registers
// its slice's settings namespace (`jobs`, `nodes`) unless the manifest already
// did, and the manifest lists both in its pinned key order. Loading it first
// keeps that order whichever of this file and `settings.config.ts` loads first.
// =============================================================================

import '../../settings/registry';

import { APP_NAME } from '@app/shared';
import { JobsModule as PlatformJobsModule, registerJobReason } from '@marinoscar/platform-api/jobs';
import { NodesModule as PlatformNodesModule, registerNodeSpanAttribute } from '@marinoscar/platform-api/nodes';

import { APP_JOB_REASONS, APP_NODE_SPAN_ATTRIBUTES } from '../../app-registrations/jobs';
import { JobsHostModule } from './jobs-host.module';

// The app's own job reasons and relayed span attributes (PP-14.19): registered
// at import time, before the application bootstraps. (Its retention policies
// are registered by the settings manifest, which composes the `retention`
// namespace from them.) Upstream's arrays are empty.
for (const reason of APP_JOB_REASONS) registerJobReason(reason);
for (const attribute of APP_NODE_SPAN_ATTRIBUTES) registerNodeSpanAttribute(attribute);

/** The queue: `JobsModule.forRoot()` with the app's name (the temp-file prefix) and its host ports. */
export const JobsModule = PlatformJobsModule.forRoot({ appName: APP_NAME, imports: [JobsHostModule] });

/** The worker-node fleet: `NodesModule.forRoot()` with the app's host ports. */
export const NodesModule = PlatformNodesModule.forRoot({ imports: [JobsHostModule] });
