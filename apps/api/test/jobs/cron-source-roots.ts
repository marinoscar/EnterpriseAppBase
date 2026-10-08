// =============================================================================
// Where the cron-enqueue-only rule looks (issues #353, #694, #703, #734)
// =============================================================================
//
// The API's own sources, plus every platform slice whose `@Cron` tasks run in
// this API and whose source lives in this repository. A slice that moves out
// of `apps/api/src` (the telemetry slice did, #703: its
// `TelemetryRetentionTask`), or ships a cron of its own (the sharing slice's
// `GrantsPruneTask`, #729), is still this application's cron, so the rule
// must still see it. The jobs and nodes slices moved out too (#734), with the
// three permanent exemptions. Shared by `cron-enqueue-only.spec.ts`,
// `on-event-no-io.spec.ts` and the proof that the roots are scanned
// (`cron-source-roots.spec.ts`).
// =============================================================================

import { join } from 'node:path';

const REPO = join(__dirname, '..', '..', '..', '..');

/** The API's own source root. */
export const API_SOURCE_ROOT = join(REPO, 'apps', 'api', 'src');

/** The packaged telemetry slice's source root. */
export const TELEMETRY_SLICE_SOURCE_ROOT = join(REPO, 'packages', 'platform-api', 'src', 'telemetry');

/** The packaged sharing slice's source root (#729: `GrantsPruneTask`). */
export const SHARING_SLICE_SOURCE_ROOT = join(REPO, 'packages', 'platform-api', 'src', 'sharing');

/** The packaged jobs slice's source root (#734: the queue's crons, two of the three exemptions). */
export const JOBS_SLICE_SOURCE_ROOT = join(REPO, 'packages', 'platform-api', 'src', 'jobs');

/** The packaged nodes slice's source root (#734: the fleet crons and the secret sweep). */
export const NODES_SLICE_SOURCE_ROOT = join(REPO, 'packages', 'platform-api', 'src', 'nodes');

/** The packaged storage slice's source root (#736: the stale-upload cleanup cron). */
export const STORAGE_SLICE_SOURCE_ROOT = join(REPO, 'packages', 'platform-api', 'src', 'storage');

/** Every root the rule scans. */
export const CRON_SOURCE_ROOTS: readonly string[] = [
  API_SOURCE_ROOT,
  TELEMETRY_SLICE_SOURCE_ROOT,
  SHARING_SLICE_SOURCE_ROOT,
  JOBS_SLICE_SOURCE_ROOT,
  NODES_SLICE_SOURCE_ROOT,
  STORAGE_SLICE_SOURCE_ROOT,
];
