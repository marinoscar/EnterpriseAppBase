import type { JobReasonDefinition, RetentionPolicyDefinition } from '@marinoscar/platform-api/jobs';
import type { NodeSpanAttributeDefinition } from '@marinoscar/platform-api/nodes';

// =============================================================================
// This app's jobs and nodes registrations (PP-14.19)
// =============================================================================
//
// Upstream keeps all three arrays EMPTY FOREVER; a fork fills them in and never
// edits a platform file. Pure data: the consumers register them AT IMPORT TIME,
// before the application bootstraps (the registries freeze after that).
//
//   APP_JOB_REASONS           extra `jobs.reason` ids (`registerJobReason`),
//                             accepted by `JobsService.enqueue` and labelled in
//                             the admin job list. Registered by
//                             `platform/jobs/jobs.config.ts`.
//   APP_RETENTION_POLICIES    extra tables in the nightly retention
//                             (`registerRetentionPolicy`): the `retention`
//                             namespace gains the key, with its schema, default
//                             and merge. Registered by the system settings
//                             manifest BEFORE it registers the `retention`
//                             namespace (the namespace is composed once, from
//                             the policies present then). The purge handler is
//                             a normal `JobHandler` in the app's own module.
//   APP_NODE_SPAN_ATTRIBUTES  attributes a node's executor spans may carry
//                             (`registerNodeSpanAttribute`), emitted as
//                             `job.app.<key>`. Registered by
//                             `platform/jobs/jobs.config.ts`.
//
// Worked examples (NOT wired here, so the served settings and defaults stay the
// platform's): `platform-extensions/jobs/` and `platform-extensions/nodes/`,
// proved by `test/examples/jobs/` and `test/examples/nodes/`. To use one, add it:
//
//   export const APP_JOB_REASONS: readonly JobReasonDefinition[] = [IMPORT_JOB_REASON];
//   export const APP_RETENTION_POLICIES: readonly RetentionPolicyDefinition[] = [IMPORT_ROWS_RETENTION];
//
// After adding a retention policy, run `npm run catalog:settings --workspace=api`
// and commit the regenerated defaults catalog. Recipes: docs/EXTENDING.md,
// packages/platform-api/src/jobs/README.md.
// =============================================================================

/** This app's own job reasons. Upstream keeps this array empty. */
export const APP_JOB_REASONS: readonly JobReasonDefinition[] = [];

/** This app's own retention policies. Upstream keeps this array empty. */
export const APP_RETENTION_POLICIES: readonly RetentionPolicyDefinition[] = [];

/** This app's own relayed node span attributes. Upstream keeps this array empty. */
export const APP_NODE_SPAN_ATTRIBUTES: readonly NodeSpanAttributeDefinition[] = [];
