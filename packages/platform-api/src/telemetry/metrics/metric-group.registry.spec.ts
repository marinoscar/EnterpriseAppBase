import { definePlatformHost, RegistryError, withTemporaryEntries } from '../../core/index';
import { TelemetryModule } from '../telemetry.module';
import { COACH_METRIC_GROUP, COACH_METRIC_GROUP_ID } from '../testing/coach-metric-group.fixture';
import { appSampleMetricSchema, metricCatalogSchema } from '../testing/metric-schema.fixture';
import { MetricGroupRegistry, registerMetricGroup } from './metric-group-registry.service';
import { computeMetricGroup } from './metric-group';
import {
  familiesOf,
  familyByKey,
  isMetricGroup,
  metricTablesOf,
  METRIC_FAMILIES,
  METRIC_GROUPS,
  metricGroupIds,
  metricGroupRegistry,
  metricGroups,
  ratiosOf,
  registerMetricGroups,
  tablesOf,
  type MetricFamily,
  type MetricGroup,
  type MetricGroupDef,
} from './metric-catalog';

// =============================================================================
// The metric-group registry (issue #680)
// =============================================================================
//
// Every rule runs at registration, so a malformed group fails at import time
// (a platform group) or at `TelemetryModule.forRoot` (an app's group).
// The registry is read through `metric-catalog.ts` (which imports the manifest),
// exactly as production code reads it.
// =============================================================================

const APP_GROUP = 'test_app' as MetricGroup;

function family(overrides: Partial<MetricFamily> & { key: string }): MetricFamily {
  return {
    group: APP_GROUP,
    label: 'Test family',
    table: 'app_test_widgets',
    kind: 'gauge',
    unit: 'count',
    requiredColumns: [],
    seriesAggregate: 'sum',
    bucketAggregate: 'max',
    filters: ['service', 'instance'],
    ...overrides,
  } as MetricFamily;
}

function group(overrides: Partial<MetricGroupDef> = {}): MetricGroupDef {
  return {
    id: APP_GROUP,
    label: 'Test',
    title: 'Test section',
    order: 70,
    description: 'test widgets',
    families: [family({ key: 'testWidgets' })],
    ...overrides,
  };
}

/** Runs `fn` against a writable registry, restored afterwards. */
async function writable(fn: () => void | Promise<void>): Promise<void> {
  await withTemporaryEntries(metricGroupRegistry, [], fn);
}

function rejection(fn: () => void): RegistryError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(RegistryError);
    return err as RegistryError;
  }
  throw new Error('expected the registration to be refused');
}

describe('metric-group registry', () => {
  it('holds the six platform groups in dashboard order', () => {
    expect(metricGroupRegistry.ids()).toEqual(['host', 'database', 'queue', 'nodes', 'uptime', 'pipeline']);
    expect(metricGroups().map((g) => [g.id, g.label, g.title, g.order])).toEqual([
      ['host', 'Host', 'Infrastructure', 10],
      ['database', 'Database', 'Database', 20],
      ['queue', 'Job queue', 'Job queue', 30],
      ['nodes', 'Worker nodes', 'Worker nodes', 40],
      ['uptime', 'Uptime and edge', 'Uptime & dependencies', 50],
      ['pipeline', 'Telemetry pipeline', 'Telemetry pipeline', 60],
    ]);
  });

  it('gives every platform group a one-line description', () => {
    for (const g of metricGroups()) {
      expect(g.description.trim()).not.toBe('');
      expect(g.description).not.toContain('\n');
    }
  });

  describe('accepts an app group', () => {
    it('serves it through the live lookups', async () => {
      await withTemporaryEntries(metricGroupRegistry, [group()], () => {
        expect(isMetricGroup(APP_GROUP)).toBe(true);
        expect(metricGroupIds()).toEqual(['host', 'database', 'queue', 'nodes', 'uptime', 'pipeline', APP_GROUP]);
        expect(familiesOf(APP_GROUP).map((f) => f.key)).toEqual(['testWidgets']);
        expect(ratiosOf(APP_GROUP)).toEqual([]);
        expect(tablesOf(APP_GROUP)).toEqual([]);
        expect(familyByKey('testWidgets')?.group).toBe(APP_GROUP);
      });
      expect(isMetricGroup(APP_GROUP)).toBe(false);
      expect(familyByKey('testWidgets')).toBeUndefined();
    });

    it('orders by `order`, then by id', async () => {
      await withTemporaryEntries(
        metricGroupRegistry,
        [
          group({ id: 'zz_between', order: 35, families: [family({ key: 'zz', group: 'zz_between' as MetricGroup })] }),
          group({ id: 'aa_between', order: 35, families: [family({ key: 'aa', group: 'aa_between' as MetricGroup })] }),
          group({ id: 'first', order: 0, families: [family({ key: 'f0', group: 'first' as MetricGroup })] }),
        ],
        () => {
          expect(metricGroupIds()).toEqual([
            'first',
            'host',
            'database',
            'queue',
            'aa_between',
            'zz_between',
            'nodes',
            'uptime',
            'pipeline',
          ]);
        },
      );
    });

    it('lets a ratio and a table reference a family of an earlier group', async () => {
      await writable(() => {
        registerMetricGroups([
          group({
            ratios: [
              {
                key: 'testShare',
                group: APP_GROUP,
                label: 'Share',
                unit: '%',
                numerator: [{ family: 'testWidgets' }],
                denominator: [{ family: 'queueDepth' }],
                scale: 100,
              },
            ],
            tables: [
              {
                key: 'testTable',
                group: APP_GROUP,
                label: 'Widgets',
                keyColumn: 'job_type',
                keyLabel: 'Job type',
                filters: ['service', 'instance'],
                parts: [
                  { column: 'n', label: 'N', unit: 'count', table: 'app_test_widgets', seriesAggregate: 'max', over: 'last' },
                ],
                histogram: { column: 'p95', label: 'p95', family: 'jobDurationP95' },
              },
            ],
          }),
        ]);
        expect(ratiosOf(APP_GROUP).map((r) => r.key)).toEqual(['testShare']);
      });
    });

    it('checks a batch against its own earlier groups', async () => {
      await writable(() => {
        const second = group({
          id: 'test_second',
          families: [family({ key: 'second', group: 'test_second' as MetricGroup })],
          ratios: [
            {
              key: 'secondRatio',
              group: 'test_second' as MetricGroup,
              label: 'R',
              unit: '%',
              numerator: [{ family: 'testWidgets' }],
              denominator: [{ family: 'second' }],
              scale: 100,
            },
          ],
        });
        registerMetricGroups([group(), second]);
        expect(metricGroupRegistry.has('test_second')).toBe(true);
      });
    });
  });

  describe('refuses at registration', () => {
    const cases: Array<[string, MetricGroupDef[], RegExp]> = [
      [
        'a family whose group differs',
        [group({ families: [family({ key: 'misfiled', group: 'host' })] })],
        /family "misfiled" with group "host"; it must be "test_app"/,
      ],
      [
        'a family key another group already uses',
        [group({ families: [family({ key: 'cpuUtilization' })] })],
        /family key "cpuUtilization" is already used by group "host"/,
      ],
      [
        'a table key equal to a platform family key',
        [
          group({
            tables: [
              {
                key: 'queueDepth',
                group: APP_GROUP,
                label: 'x',
                keyColumn: 'k',
                keyLabel: 'K',
                filters: ['host'],
                parts: [{ column: 'v', label: 'V', unit: 'count', table: 't', seriesAggregate: 'max', over: 'last' }],
              },
            ],
          }),
        ],
        /table key "queueDepth" is already used by group "queue"/,
      ],
      [
        'an unknown unit',
        [group({ families: [family({ key: 'odd', unit: 'furlongs' as never })] })],
        /Family "odd" has unit "furlongs"/,
      ],
      [
        'an unknown filter',
        [group({ families: [family({ key: 'odd', filters: ['tenant' as never] })] })],
        /Family "odd" has filter "tenant"/,
      ],
      [
        'a ratio referencing an unknown family',
        [
          group({
            ratios: [
              {
                key: 'orphan',
                group: APP_GROUP,
                label: 'Orphan',
                unit: '%',
                numerator: [{ family: 'nope' }],
                denominator: [{ family: 'testWidgets' }],
                scale: 100,
              },
            ],
          }),
        ],
        /Ratio "orphan" references family "nope", which is not registered/,
      ],
      [
        'a table histogram that is not a histogram family',
        [
          group({
            tables: [
              {
                key: 'hist',
                group: APP_GROUP,
                label: 'x',
                keyColumn: 'k',
                keyLabel: 'K',
                filters: ['host'],
                parts: [{ column: 'v', label: 'V', unit: 'count', table: 't', seriesAggregate: 'max', over: 'last' }],
                histogram: { column: 'p', label: 'P', family: 'queueDepth' },
              },
            ],
          }),
        ],
        /not a registered histogram family/,
      ],
      ['a group with nothing to render', [group({ families: [] })], /declares no family and no table/],
      ['a group without a title', [group({ title: ' ' })], /title must be a non-empty string/],
      [
        'two groups of one batch sharing a key',
        [group(), group({ id: 'test_other', families: [family({ key: 'testWidgets', group: 'test_other' as MetricGroup })] })],
        /family key "testWidgets" is already used by group "test_app"/,
      ],
      [
        'a ratio referencing a family of a LATER group of the batch',
        [
          group({
            ratios: [
              {
                key: 'early',
                group: APP_GROUP,
                label: 'R',
                unit: '%',
                numerator: [{ family: 'later' }],
                denominator: [{ family: 'testWidgets' }],
                scale: 100,
              },
            ],
          }),
          group({ id: 'test_later', families: [family({ key: 'later', group: 'test_later' as MetricGroup })] }),
        ],
        /Ratio "early" references family "later"/,
      ],
    ];

    it.each(cases)('%s (INVALID_ENTRY), leaving the registry unchanged', async (_name, groups, message) => {
      await writable(() => {
        const err = rejection(() => registerMetricGroups(groups));
        expect(err.code).toBe('INVALID_ENTRY');
        expect(err.registry).toBe('telemetry-metric-groups');
        expect(err.message).toMatch(message);
        expect(metricGroupRegistry.ids()).toEqual([...METRIC_GROUPS]);
      });
    });

    it.each(cases.filter(([, groups]) => groups.length === 1))(
      '%s through the registry itself (withTemporaryEntries)',
      async (_name, groups, message) => {
        await expect(withTemporaryEntries(metricGroupRegistry, groups, () => undefined)).rejects.toThrow(message);
      },
    );

    it('a duplicate group id (DUPLICATE_ID)', async () => {
      await writable(() => {
        const err = rejection(() =>
          registerMetricGroups([group({ id: 'host', families: [family({ key: 'x', group: 'host' })] })]),
        );
        expect(err.code).toBe('DUPLICATE_ID');
        expect(err.message).toContain('Duplicate metric group id "host"');
      });
    });

    it('an id that is not lower snake_case (INVALID_ID)', async () => {
      await writable(() => {
        expect(rejection(() => registerMetricGroups([group({ id: 'Coach-Metrics' })])).code).toBe('INVALID_ID');
      });
    });
  });

  // An app's groups come in through `TelemetryModule.forRoot({ metricGroups })`
  // (#703), BEFORE the controllers are created, so a bad one fails boot there.
  const host = definePlatformHost({
    access: { requirePermissions: () => () => undefined, requireAuthenticated: () => () => undefined },
  });

  it('fails at forRoot when the app passes a malformed group', async () => {
    await writable(() => {
      expect(() =>
        TelemetryModule.forRoot({
          host,
          imports: [],
          metricGroups: [group({ families: [family({ key: 'cpuUtilization' })] })],
        }),
      ).toThrow(/family key "cpuUtilization" is already used by group "host"/);
      expect(metricGroupIds()).not.toContain(APP_GROUP);
    });
  });

  it('includes an app group passed to forRoot in every live view, after the platform groups', async () => {
    await writable(() => {
      TelemetryModule.forRoot({ host, imports: [], metricGroups: [group()] });
      expect(metricGroupIds()).toEqual(['host', 'database', 'queue', 'nodes', 'uptime', 'pipeline', APP_GROUP]);
      expect(familiesOf(APP_GROUP).map((f) => f.key)).toEqual(['testWidgets']);
      expect(familyByKey('testWidgets')?.group).toBe(APP_GROUP);
      // A second forRoot with the very same definition is a no-op, not a duplicate.
      expect(() => TelemetryModule.forRoot({ host, imports: [], metricGroups: [metricGroupRegistry.get(APP_GROUP)!] })).not.toThrow();
    });
  });
});

// =============================================================================
// MetricGroupRegistry and an app's coach-shaped group (issue #703, rung 2)
// =============================================================================

describe('MetricGroupRegistry (the injectable facade)', () => {
  it('lists the platform groups first, in dashboard order, and reads the same registry', () => {
    const registry = new MetricGroupRegistry();

    expect(registry.list().map((g) => g.id)).toEqual(['host', 'database', 'queue', 'nodes', 'uptime', 'pipeline']);
    expect(registry.get('host')).toBe(metricGroupRegistry.get('host'));
    expect(registry.get('nope')).toBeUndefined();
  });

  it('registers an app group after the platform groups, through registerMetricGroup too', async () => {
    await writable(() => {
      const registry = new MetricGroupRegistry();
      registerMetricGroup(registry, COACH_METRIC_GROUP);

      expect(registry.list().map((g) => g.id)).toEqual([
        'host',
        'database',
        'queue',
        'nodes',
        'uptime',
        'pipeline',
        COACH_METRIC_GROUP_ID,
      ]);
      expect(familiesOf(COACH_METRIC_GROUP_ID).map((f) => f.key)).toEqual(['coachNudgesSent', 'healthSummaryP95']);
    });
  });

  it('refuses a duplicate id and a duplicate family key', async () => {
    await writable(() => {
      const registry = new MetricGroupRegistry();

      expect(rejection(() => registry.register({ ...metricGroupRegistry.get('host')! })).code).toBe('DUPLICATE_ID');
      expect(
        rejection(() =>
          registry.register({
            ...COACH_METRIC_GROUP,
            families: [{ ...COACH_METRIC_GROUP.families[0], key: 'cpuUtilization' }],
          }),
        ).message,
      ).toMatch(/family key "cpuUtilization" is already used by group "host"/);
    });
  });

  it('freezes once the application has bootstrapped: a later register throws FROZEN', async () => {
    await writable(() => {
      const registry = new MetricGroupRegistry();
      registry.onApplicationBootstrap();

      expect(metricGroupRegistry.frozen).toBe(true);
      expect(rejection(() => registry.register(COACH_METRIC_GROUP)).code).toBe('FROZEN');
    });
  });
});

describe('a coach-shaped app group (counters and histograms of app_* tables)', () => {
  const WINDOW = {
    from: new Date('2026-09-27T21:00:00.000Z'),
    to: new Date('2026-09-27T22:00:00.000Z'),
    previousFrom: new Date('2026-09-27T20:00:00.000Z'),
    bucketSeconds: 60,
  };

  const at = (hhmm: string) => `2026-09-27 ${hhmm}:00.000000`;
  const rows = (names: string[], data: unknown[][]) => ({ fields: names.map((name) => ({ name, dataTypeID: 25 })), rows: data });
  /** The store: nudges per channel (a counter), the summary duration buckets (a histogram). */
  const answer = (statement: string) => {
    if (statement.includes('FROM "app_coach_nudge_sent_total"')) {
      return rows(['t', 'g', 'v'], [
        [at('21:10'), 'push', 10],
        [at('21:20'), 'email', 4],
      ]);
    }
    if (statement.includes('FROM "app_health_summary_duration_seconds_bucket"')) {
      return rows(['period', 'g', 'le', 'v'], [
        ['current', '', '0.5', 50],
        ['current', '', '1', 100],
        ['current', '', 'inf', 100],
      ]);
    }
    return rows([], []);
  };

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

  it('renders tiles and series from the app tables, with the platform family kinds', async () => {
    await writable(async () => {
      registerMetricGroup(new MetricGroupRegistry(), COACH_METRIC_GROUP);
      const { out, sql } = await compute(metricTablesOf({ tables: [...metricCatalogSchema().tables, ...appSampleMetricSchema().tables] }));

      expect(out.skipped).toEqual([]);
      expect(out.available).toBe(true);
      const tile = (key: string) => out.tiles.find((t) => t.key === key);
      expect(tile('coachNudgesSent')).toMatchObject({ value: 14, unit: 'count' });
      expect(tile('healthSummaryP95')?.unit).toBe('ms');
      expect(tile('healthSummaryP95')?.value).toBeGreaterThan(0);
      expect(out.series.filter((series) => series.key === 'coachNudgesSent').map((series) => series.groupBy).sort()).toEqual([
        'email',
        'push',
      ]);
      expect(sql.some((s) => s.includes('FROM "app_coach_nudge_sent_total"'))).toBe(true);
      expect(sql.some((s) => s.includes('FROM "app_health_summary_duration_seconds_bucket"'))).toBe(true);
    });
  });

  it('is skipped cleanly, with no statement run, while its tables do not exist', async () => {
    await writable(async () => {
      registerMetricGroup(new MetricGroupRegistry(), COACH_METRIC_GROUP);
      const { out, sql } = await compute(metricTablesOf(metricCatalogSchema()));

      expect(out.available).toBe(false);
      expect(out.skipped).toEqual(['coachNudgesSent', 'healthSummaryP95']);
      expect(out.tiles).toEqual([]);
      expect(sql).toEqual([]);
    });
  });
});
