import { Injectable } from '@nestjs/common';

import { computeVerdict, DEFAULT_VERDICT_THRESHOLDS, type DashboardVerdict, type VerdictInput, type VerdictThresholds } from './telemetry-dashboard.verdict';
import { DefaultVerdictPolicy, VERDICT_POLICY, type VerdictPolicy } from './verdict-policy';
import { resolveVerdictThresholds } from '../telemetry.options';

// =============================================================================
// VERDICT_POLICY (issue #703, rung 3)
// =============================================================================
//
// The default policy IS `computeVerdict` (the boundary cases of
// telemetry-dashboard.verdict.spec.ts run through both), it honours the
// thresholds it is given, and an app policy that delegates to it adds a rule
// without touching the platform's.
// =============================================================================

const NOW = new Date('2026-09-27T22:00:00.000Z');

function input(overrides: Partial<VerdictInput> = {}): VerdictInput {
  return {
    now: NOW,
    lastDataAt: new Date(NOW.getTime() - 30_000),
    requests: 1000,
    errors5xx: 0,
    p95Ms: 100,
    errorLogs: 0,
    previousErrorLogs: 0,
    ...overrides,
  };
}

/** One input per rule, at and around its thresholds. */
const CASES: ReadonlyArray<Partial<VerdictInput>> = [
  {},
  { lastDataAt: null },
  { lastDataAt: new Date(NOW.getTime() - 6 * 60_000) },
  { errors5xx: 21 },
  { errors5xx: 60 },
  { p95Ms: 1500 },
  { p95Ms: 4000, slowestRoute: 'GET /api/slow' },
  { errorLogs: 40, previousErrorLogs: 10 },
  { errorLogs: 200, previousErrorLogs: 2, topErrorMessage: 'boom' },
  { unknownRoutes: { bearerRequests: 1, bearerRoutes: 1, topRoute: 'GET /api/x' } },
  { unknownRoutes: { bearerRequests: 30, bearerRoutes: 4, topRoute: 'GET /api/x' } },
  { disk: { utilizationPct: 90, mountpoint: '/' } },
  { memory: { utilizationPct: 98, host: 'vm1' } },
  { dbConnections: { utilizationPct: 85, instance: 'db:5432' } },
  { oldestPendingJob: { ageSeconds: 45 * 60, jobType: 'export.csv' } },
  { nodes: { stale: 1, noEligibleNodeTypes: ['report.pdf'] } },
  { tls: { daysLeft: 3, url: 'https://app.example.com/' } },
  { uptimeFailures: [{ url: 'http://nginx/api/health/live', allFailed: true, checks: 4 }] },
  { collector: { failed: 20, sent: 80, exporter: 'otlphttp/greptime' } },
  { backupAgeHours: 60 },
];

describe('DefaultVerdictPolicy', () => {
  const policy = new DefaultVerdictPolicy();

  it.each(CASES.map((c, i) => [i, c] as const))('case %i equals computeVerdict', (_i, overrides) => {
    expect(policy.compute(input(overrides), DEFAULT_VERDICT_THRESHOLDS)).toEqual(computeVerdict(input(overrides)));
  });

  it('applies the thresholds it is given, not the defaults', () => {
    const lenient = resolveVerdictThresholds({ noDataMinutes: 30, errorRatePct: { critical: 50 } });
    const quietTenMinutes = input({ lastDataAt: new Date(NOW.getTime() - 10 * 60_000) });

    expect(policy.compute(quietTenMinutes, DEFAULT_VERDICT_THRESHOLDS).level).toBe('no_data');
    expect(policy.compute(quietTenMinutes, lenient).level).toBe('healthy');
    expect(policy.compute(input({ errors5xx: 60 }), DEFAULT_VERDICT_THRESHOLDS).level).toBe('critical');
    expect(policy.compute(input({ errors5xx: 60 }), lenient).level).toBe('degraded');
  });

  it('is bound under a stable, shared token', () => {
    expect(VERDICT_POLICY).toBe(Symbol.for('@marinoscar/platform/telemetry/VERDICT_POLICY'));
  });
});

describe('an app policy that delegates to the default (the documented pattern)', () => {
  @Injectable()
  class CoachVerdictPolicy implements VerdictPolicy {
    constructor(private readonly platform: DefaultVerdictPolicy) {}

    compute(verdictInput: VerdictInput, thresholds: VerdictThresholds): DashboardVerdict {
      const verdict = this.platform.compute(verdictInput, thresholds);
      if (verdict.level === 'no_data') return verdict;
      return { level: verdict.level === 'healthy' ? 'degraded' : verdict.level, reasons: [...verdict.reasons, 'Coach nudges stalled'] };
    }
  }

  it('adds its own rule and keeps every platform reason', () => {
    const policy = new CoachVerdictPolicy(new DefaultVerdictPolicy());

    expect(policy.compute(input(), DEFAULT_VERDICT_THRESHOLDS)).toEqual({ level: 'degraded', reasons: ['Coach nudges stalled'] });
    expect(policy.compute(input({ errors5xx: 60 }), DEFAULT_VERDICT_THRESHOLDS)).toEqual({
      level: 'critical',
      reasons: [...computeVerdict(input({ errors5xx: 60 })).reasons, 'Coach nudges stalled'],
    });
  });
});
