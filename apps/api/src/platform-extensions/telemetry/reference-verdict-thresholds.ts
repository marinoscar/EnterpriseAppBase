import type { VerdictThresholdsOverride } from '@marinoscar/platform-api/telemetry';

// =============================================================================
// This app's verdict thresholds: edit here (PP-4.6)
// =============================================================================
//
// Rung 1 of the extension ladder. `TelemetryModule.forRoot({ dashboard: {
// verdictThresholds } })` deep-merges this object over the platform's
// `DEFAULT_VERDICT_THRESHOLDS` and validates the result at boot (a bad value,
// or a degraded bound beyond its critical one, fails startup naming the field).
//
// The reference app keeps the platform values, spelled out so a fork sees every
// knob and edits one number in place. BEHAVIOUR-NEUTRAL: every value equals the
// default (`telemetry-extension-points.integration.spec.ts` pins that), so the
// dashboard's verdict is the platform's until a number below changes. Delete a
// line to fall back to the default; the override is partial by design.
//
// Rules and units: the header of
// packages/platform-api/src/telemetry/dashboard/telemetry-dashboard.verdict.ts.
// =============================================================================

/** The reference app's verdict thresholds; every value equals the platform default. */
export const REFERENCE_VERDICT_THRESHOLDS: VerdictThresholdsOverride = {
  minRequests: 20,
  errorRatePct: { degraded: 2, critical: 5 },
  p95Ms: { degraded: 1000, critical: 3000 },
  errorLogs: { minCurrent: 10, degradedRatio: 3, criticalRatio: 10 },
  noDataMinutes: 5,
  unknownRoutes: { criticalBearerRequests: 20, criticalDistinctRoutes: 3 },
  diskUtilizationPct: { degraded: 85, critical: 95 },
  memoryUtilizationPct: { degraded: 90, critical: 97 },
  dbConnectionsPct: { degraded: 80, critical: 95 },
  oldestPendingJobMinutes: { degraded: 10, critical: 30 },
  tlsDaysLeft: { degraded: 14, critical: 7 },
  uptimeMinChecksForCritical: 2,
  collectorFailedPct: { critical: 10 },
  backupAgeHours: { degraded: 26, critical: 50 },
};
