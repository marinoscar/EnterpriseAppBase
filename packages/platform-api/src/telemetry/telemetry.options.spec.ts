import { definePlatformHost } from '../core/index';
import { DEFAULT_VERDICT_THRESHOLDS } from './dashboard/telemetry-dashboard.verdict';
import { METRIC_FRESH_MS } from './metrics/metric-group';
import {
  defaultTelemetryActorId,
  resolveMetricFreshMs,
  resolveTelemetryModuleOptions,
  resolveVerdictThresholds,
} from './telemetry.options';

// =============================================================================
// TelemetryModule.forRoot options (issue #703, rung 1)
// =============================================================================

const host = definePlatformHost({
  access: { requirePermissions: () => () => undefined, requireAuthenticated: () => () => undefined },
});

describe('resolveVerdictThresholds', () => {
  it('returns the defaults, frozen, when nothing is overridden', () => {
    const resolved = resolveVerdictThresholds(undefined);

    expect(resolved).toEqual(DEFAULT_VERDICT_THRESHOLDS);
    expect(Object.isFrozen(resolved)).toBe(true);
    expect(Object.isFrozen(resolved.errorRatePct)).toBe(true);
    expect(resolveVerdictThresholds({})).toEqual(DEFAULT_VERDICT_THRESHOLDS);
  });

  it('deep-merges an override: a nested field keeps its siblings', () => {
    const resolved = resolveVerdictThresholds({ noDataMinutes: 15, errorRatePct: { critical: 10 }, errorLogs: { minCurrent: 50 } });

    expect(resolved.noDataMinutes).toBe(15);
    expect(resolved.errorRatePct).toEqual({ degraded: DEFAULT_VERDICT_THRESHOLDS.errorRatePct.degraded, critical: 10 });
    expect(resolved.errorLogs).toEqual({ ...DEFAULT_VERDICT_THRESHOLDS.errorLogs, minCurrent: 50 });
    expect(resolved.p95Ms).toEqual(DEFAULT_VERDICT_THRESHOLDS.p95Ms);
  });

  it('never mutates the defaults', () => {
    resolveVerdictThresholds({ p95Ms: { degraded: 1, critical: 2 } });

    expect(DEFAULT_VERDICT_THRESHOLDS.p95Ms).toEqual({ degraded: 1000, critical: 3000 });
  });

  it.each([
    [{ noDataMinutes: 0 }, /noDataMinutes/],
    [{ noDataMinutes: -1 }, /noDataMinutes/],
    [{ errorRatePct: { degraded: Number.NaN } }, /errorRatePct\.degraded/],
    [{ minRequests: 1.5 }, /minRequests/],
    [{ unknownRoutes: { criticalBearerRequests: 0 } }, /unknownRoutes\.criticalBearerRequests/],
    [{ nope: 1 }, /nope|Unrecognized/],
    [{ p95Ms: { degraded: 1, critical: 2, warn: 3 } }, /p95Ms/],
  ])('fails boot with a message naming the bad field: %j', (override, message) => {
    expect(() => resolveVerdictThresholds(override as never)).toThrow(/TelemetryModule\.forRoot: `dashboard\.verdictThresholds` is invalid/);
    expect(() => resolveVerdictThresholds(override as never)).toThrow(message);
  });

  it('refuses a degraded bound beyond its critical one', () => {
    expect(() => resolveVerdictThresholds({ diskUtilizationPct: { degraded: 99 } })).toThrow(
      /diskUtilizationPct.*degraded \(99\) must not exceed critical \(95\)/,
    );
    expect(() => resolveVerdictThresholds({ tlsDaysLeft: { critical: 30 } })).toThrow(/tlsDaysLeft.*fewer days left is worse/);
    expect(() => resolveVerdictThresholds({ errorLogs: { degradedRatio: 20 } })).toThrow(/errorLogs.*degradedRatio/);
  });
});

describe('resolveTelemetryModuleOptions', () => {
  it('requires a host and the port imports', () => {
    expect(() => resolveTelemetryModuleOptions({ imports: [] } as never)).toThrow(/`host` is required/);
    expect(() => resolveTelemetryModuleOptions({ host } as never)).toThrow(/`imports` must list/);
    expect(() => resolveTelemetryModuleOptions(undefined as never)).toThrow(/options are required/);
  });

  it('applies the defaults', () => {
    const resolved = resolveTelemetryModuleOptions({ host, imports: [] });

    expect(resolved.metricGroups).toEqual([]);
    expect(resolved.actorId).toBe(defaultTelemetryActorId);
    expect(resolved.verdictThresholds).toEqual(DEFAULT_VERDICT_THRESHOLDS);
    expect(resolved.verdictPolicy).toBeUndefined();
    expect(resolved.metricFreshMs).toBe(METRIC_FRESH_MS);
    expect(Object.isFrozen(resolved)).toBe(true);
  });

  it('carries the metrics freshness window', () => {
    expect(resolveTelemetryModuleOptions({ host, imports: [], metrics: { freshMs: 300_000 } }).metricFreshMs).toBe(300_000);
    expect(resolveTelemetryModuleOptions({ host, imports: [], metrics: {} }).metricFreshMs).toBe(METRIC_FRESH_MS);
  });

  it('carries the thresholds override and the policy binding', () => {
    class AppPolicy {
      compute() {
        return { level: 'healthy' as const, reasons: [] };
      }
    }
    const resolved = resolveTelemetryModuleOptions({
      host,
      imports: [],
      dashboard: { verdictThresholds: { noDataMinutes: 9 }, verdictPolicy: { useClass: AppPolicy } },
    });

    expect(resolved.verdictThresholds.noDataMinutes).toBe(9);
    expect(resolved.verdictPolicy).toEqual({ useClass: AppPolicy });
  });

  it('refuses a policy binding with no provider shape, or two', () => {
    expect(() => resolveTelemetryModuleOptions({ host, imports: [], dashboard: { verdictPolicy: {} as never } })).toThrow(
      /verdictPolicy` needs exactly one of/,
    );
    expect(() =>
      resolveTelemetryModuleOptions({
        host,
        imports: [],
        dashboard: { verdictPolicy: { useClass: class {}, useExisting: 'x' } as never },
      }),
    ).toThrow(/verdictPolicy` needs exactly one of/);
  });

  it('refuses a non-function actorId and a non-array metricGroups', () => {
    expect(() => resolveTelemetryModuleOptions({ host, imports: [], actorId: 'id' as never })).toThrow(/`actorId`/);
    expect(() => resolveTelemetryModuleOptions({ host, imports: [], metricGroups: {} as never })).toThrow(/`metricGroups`/);
  });
});

describe('resolveMetricFreshMs', () => {
  it('defaults to METRIC_FRESH_MS (150 s)', () => {
    expect(METRIC_FRESH_MS).toBe(150_000);
    expect(resolveMetricFreshMs(undefined)).toBe(150_000);
    expect(resolveMetricFreshMs({})).toBe(150_000);
  });

  it('accepts a whole number of milliseconds from 1 s to 24 h', () => {
    expect(resolveMetricFreshMs({ freshMs: 1_000 })).toBe(1_000);
    expect(resolveMetricFreshMs({ freshMs: 86_400_000 })).toBe(86_400_000);
  });

  it('fails boot naming the option for anything else', () => {
    for (const freshMs of [0, 999, 86_400_001, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '150000']) {
      expect(() => resolveMetricFreshMs({ freshMs: freshMs as never })).toThrow(/TelemetryModule\.forRoot: `metrics\.freshMs` must be/);
    }
    expect(() => resolveMetricFreshMs(null as never)).toThrow(/`metrics` must be an object/);
    expect(() => resolveTelemetryModuleOptions({ host, imports: [], metrics: { freshMs: -1 } })).toThrow(/`metrics\.freshMs`/);
  });
});

describe('defaultTelemetryActorId', () => {
  it("reads requestUser.id, else user.id, like the reference app's @CurrentUser('id')", () => {
    expect(defaultTelemetryActorId({ requestUser: { id: 'a' }, user: { id: 'b' } })).toBe('a');
    expect(defaultTelemetryActorId({ user: { id: 'b' } })).toBe('b');
    expect(defaultTelemetryActorId({})).toBeUndefined();
    expect(defaultTelemetryActorId(null)).toBeUndefined();
    expect(defaultTelemetryActorId({ user: { id: 7 } })).toBeUndefined();
  });
});
