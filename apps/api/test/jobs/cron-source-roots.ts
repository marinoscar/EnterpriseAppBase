// =============================================================================
// Where the cron-enqueue-only rule looks (issues #353, #694, #703)
// =============================================================================
//
// The API's own sources, plus every platform slice whose `@Cron` tasks run in
// this API and whose source lives in this repository. A slice that moves out
// of `apps/api/src` (the telemetry slice did, #703: its
// `TelemetryRetentionTask`), or ships a cron of its own (the sharing slice's
// `GrantsPruneTask`, #729), is still this application's cron, so the rule
// must still see it. Shared by `cron-enqueue-only.spec.ts` and the proof that
// the roots are scanned (`cron-source-roots.spec.ts`).
// =============================================================================

import { join } from 'node:path';

const REPO = join(__dirname, '..', '..', '..', '..');

/** The API's own source root. */
export const API_SOURCE_ROOT = join(REPO, 'apps', 'api', 'src');

/** The packaged telemetry slice's source root. */
export const TELEMETRY_SLICE_SOURCE_ROOT = join(REPO, 'packages', 'platform-api', 'src', 'telemetry');

/** The packaged sharing slice's source root (#729: `GrantsPruneTask`). */
export const SHARING_SLICE_SOURCE_ROOT = join(REPO, 'packages', 'platform-api', 'src', 'sharing');

/** Every root the rule scans. */
export const CRON_SOURCE_ROOTS: readonly string[] = [API_SOURCE_ROOT, TELEMETRY_SLICE_SOURCE_ROOT, SHARING_SLICE_SOURCE_ROOT];
