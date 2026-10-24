import { metricGroupRegistry } from '@marinoscar/platform-api/telemetry';
import { runPlatformConformance } from '@marinoscar/platform-api/testing';
// Importing the testing entry REGISTERS the `telemetry` suite with the harness.
import '@marinoscar/platform-api/telemetry/testing';

import { API_SOURCE_ROOT, CRON_SOURCE_ROOTS } from '../jobs/cron-source-roots';
// Importing the app's binding runs `TelemetryModule.forRoot`, which registers the
// app's own metric groups (`activity`, then `APP_METRIC_GROUPS`) in the registry
// the suite discovers them from.
import '../../src/platform/telemetry/telemetry.config';

// =============================================================================
// The telemetry slice's conformance suite, run in the reference app (PP-4.6)
// =============================================================================
//
// The invariants of the telemetry slice (docs: packages/platform-api/src/telemetry/README.md,
// "Conformance suite") are checked here against THIS application: every metric
// group it registered (the platform's six and `activity`) is well formed and
// degrades to `skipped`; every route declares exactly its permissions; no Doctor
// check can write; no response carries a stored password; the cron scan roots
// the app's `cron-enqueue-only` suite uses hold the slice's own cron; and the
// module boots with no store.
//
// An app that adopts the package copies these few lines. What stays HERE is the
// app's data: its source roots and cron scan roots. The checks are the
// package's.
//
// Checks 7 (web/API permission parity) and 8 (infra drift) run elsewhere:
// `apps/web/src/__tests__/config/telemetryParity.test.ts` and CI's
// `platform-infra sync --check`.
// =============================================================================

runPlatformConformance({
  sourceRoots: [API_SOURCE_ROOT],
  suites: { telemetry: { cronSourceRoots: CRON_SOURCE_ROOTS } },
});

describe('the telemetry suite sees this application', () => {
  it("discovers the app's own metric group next to the platform's six", () => {
    expect(metricGroupRegistry.ids()).toEqual(['host', 'database', 'queue', 'nodes', 'uptime', 'pipeline', 'activity']);
  });
});
