import { withTemporaryEntries } from '../../core/index';
import {
  checkMetricGroups,
  checkMetricGroupsOnEmptySchema,
} from '../testing/conformance';
import { COACH_METRIC_GROUP, COACH_METRIC_GROUP_ID } from '../testing/coach-metric-group.fixture';
import { APP_SAMPLE_METRIC_TAGS, appSampleMetricSchema, metricCatalogSchema } from '../testing/metric-schema.fixture';
import { metricGroupRegistry, metricTablesOf } from './metric-catalog';
import { computeMetricGroup } from './metric-group';
import { registerMetricGroups } from './metric-group.registry';

// =============================================================================
// EvoPath readiness: a coach-shaped group needs ZERO platform edits (PP-4.6)
// =============================================================================
//
// The adoption plan for EvoPath says its `coach` dashboard group is a NEW
// EXTENSION, not a platform change. This is the evidence: a group declared with
// EvoPath's table names (`app_coach_nudge_sent_total`, `..._suppressed_total`,
// `..._opened_total`, `app_coach_audio_generated_total`, `..._failed_total`,
// `app_health_summary_duration_seconds_bucket`), registered the way an app
// registers one, over a fixture schema extended with those tables, which
//
//   - passes the telemetry conformance checks (the same functions an app runs
//     through `runPlatformConformance`),
//   - renders tiles, series and ratios through the platform's own renderer,
//   - and with its tables absent is `available: false` with every key skipped.
//
// Nothing in `metrics/`, `dashboard/` or the web is edited for the group; the
// only inputs are the group definition and the tables it reads.
// =============================================================================

const WINDOW = {
  from: new Date('2026-09-27T21:00:00.000Z'),
  to: new Date('2026-09-27T22:00:00.000Z'),
  previousFrom: new Date('2026-09-27T20:00:00.000Z'),
  bucketSeconds: 60,
};

const at = (hhmm: string) => `2026-09-27 ${hhmm}:00.000000`;
const rows = (names: string[], data: unknown[][]) => ({ fields: names.map((name) => ({ name, dataTypeID: 25 })), rows: data });

/** The store: counters per label, and the summary duration buckets (a histogram). */
function answer(statement: string) {
  if (statement.includes('FROM "app_coach_nudge_sent_total"')) {
    return rows(['t', 'g', 'v'], [[at('21:10'), 'push', 10], [at('21:20'), 'email', 10]]);
  }
  if (statement.includes('FROM "app_coach_nudge_suppressed_total"')) {
    return rows(['t', 'g', 'v'], [[at('21:10'), 'quiet_hours', 3], [at('21:20'), 'rate_limited', 1]]);
  }
  if (statement.includes('FROM "app_coach_nudge_opened_total"')) {
    return rows(['t', 'g', 'v'], [[at('21:15'), 'push', 5]]);
  }
  if (statement.includes('FROM "app_coach_audio_generated_total"')) {
    return rows(['t', 'g', 'v'], [[at('21:30'), '', 18]]);
  }
  if (statement.includes('FROM "app_coach_audio_failed_total"')) {
    return rows(['t', 'g', 'v'], [[at('21:30'), 'provider_error', 2]]);
  }
  if (statement.includes('FROM "app_health_summary_duration_seconds_bucket"')) {
    return rows(['period', 'g', 'le', 'v'], [['current', '', '0.5', 50], ['current', '', '1', 100], ['current', '', 'inf', 100]]);
  }
  return rows([], []);
}

async function compute(tables: ReturnType<typeof metricTablesOf>) {
  const sql: string[] = [];
  const out = await computeMetricGroup({
    group: COACH_METRIC_GROUP_ID,
    window: WINDOW,
    filters: {},
    tables,
    now: WINDOW.to,
    runner: {
      maybe: async (statement: string | null) => {
        if (!statement) return null;
        sql.push(statement);
        return answer(statement);
      },
    },
  });
  return { out, sql };
}

/** Runs `fn` with the coach group registered in a writable registry, restored afterwards. */
async function withCoachGroup(fn: () => Promise<void>): Promise<void> {
  await withTemporaryEntries(metricGroupRegistry, [], async () => {
    registerMetricGroups([COACH_METRIC_GROUP]);
    await fn();
  });
}

describe('the coach-shaped group (EvoPath readiness)', () => {
  it('reads exactly the six tables EvoPath emits, all present in the fixture schema', () => {
    const tables = new Set(COACH_METRIC_GROUP.families.map((family) => family.table));
    expect([...tables].sort()).toEqual([
      'app_coach_audio_failed_total',
      'app_coach_audio_generated_total',
      'app_coach_nudge_opened_total',
      'app_coach_nudge_sent_total',
      'app_coach_nudge_suppressed_total',
      'app_health_summary_duration_seconds_bucket',
    ]);
    expect(Object.keys(APP_SAMPLE_METRIC_TAGS).sort()).toEqual([...tables].sort());
    for (const family of COACH_METRIC_GROUP.families) {
      for (const column of family.requiredColumns) expect(APP_SAMPLE_METRIC_TAGS[family.table]).toContain(column);
    }
  });

  it('passes conformance check 1: well formed, and degrading to skipped on an empty schema', async () => {
    expect(checkMetricGroups([COACH_METRIC_GROUP])).toEqual([]);
    await withCoachGroup(async () => {
      expect(await checkMetricGroupsOnEmptySchema([COACH_METRIC_GROUP])).toEqual([]);
    });
  });

  it('together with the platform groups, keeps every key unique', async () => {
    await withCoachGroup(async () => {
      expect(checkMetricGroups(metricGroupRegistry.list())).toEqual([]);
    });
  });

  it('renders tiles, series and ratios from the app tables with the platform renderer', async () => {
    await withCoachGroup(async () => {
      const { out, sql } = await compute(metricTablesOf({ tables: [...metricCatalogSchema().tables, ...appSampleMetricSchema().tables] }));

      expect(out.skipped).toEqual([]);
      expect(out.available).toBe(true);
      const tile = (key: string) => out.tiles.find((t) => t.key === key);
      expect(tile('coachNudgesSent')).toMatchObject({ value: 20, unit: 'count' });
      expect(tile('coachNudgesSuppressed')).toMatchObject({ value: 4, unit: 'count' });
      expect(tile('coachNudgesOpened')).toMatchObject({ value: 5, unit: 'count' });
      expect(tile('coachAudioGenerated')).toMatchObject({ value: 18, unit: 'count' });
      expect(tile('coachAudioFailed')).toMatchObject({ value: 2, unit: 'count' });
      expect(tile('healthSummaryP95')).toMatchObject({ unit: 'ms' });
      expect(tile('healthSummaryP95')?.value).toBeGreaterThan(0);
      // Ratios: 5 opened of 20 sent; 2 failed of 18 + 2 attempted.
      expect(tile('coachNudgeOpenRate')).toMatchObject({ value: 25, unit: '%' });
      expect(tile('coachAudioFailureRatio')).toMatchObject({ value: 10, unit: '%' });

      expect(out.series.filter((s) => s.key === 'coachNudgesSent').map((s) => s.groupBy).sort()).toEqual(['email', 'push']);
      expect(out.series.filter((s) => s.key === 'coachNudgesSuppressed').map((s) => s.groupBy).sort()).toEqual(['quiet_hours', 'rate_limited']);
      for (const table of COACH_METRIC_GROUP.families.map((family) => family.table)) {
        expect(sql.some((statement) => statement.includes(`FROM "${table}"`))).toBe(true);
      }
    });
  });

  it('is available: false with every family and ratio skipped, and no statement run, while its tables are absent', async () => {
    await withCoachGroup(async () => {
      const { out, sql } = await compute(metricTablesOf(metricCatalogSchema()));

      expect(out.available).toBe(false);
      expect(out.skipped.sort()).toEqual(
        [...COACH_METRIC_GROUP.families.map((f) => f.key), ...(COACH_METRIC_GROUP.ratios ?? []).map((r) => r.key)].sort(),
      );
      expect(out.tiles).toEqual([]);
      expect(out.series).toEqual([]);
      expect(sql).toEqual([]);
    });
  });

  it('degrades per family: the tables that exist render, the others are skipped', async () => {
    await withCoachGroup(async () => {
      const { out } = await compute(metricTablesOf(appSampleMetricSchema(['app_coach_nudge_sent_total'])));

      expect(out.available).toBe(true);
      expect(out.tiles.map((t) => t.key)).toEqual(['coachNudgesSent']);
      expect(out.skipped).toEqual(
        expect.arrayContaining(['coachNudgesOpened', 'coachAudioFailed', 'healthSummaryP95', 'coachNudgeOpenRate', 'coachAudioFailureRatio']),
      );
    });
  });
});
