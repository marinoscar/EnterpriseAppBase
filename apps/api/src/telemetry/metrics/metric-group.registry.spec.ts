import { RegistryError, withTemporaryEntries } from '../../common/registry';
import {
  familiesOf,
  familyByKey,
  isMetricGroup,
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
// Every rule runs at registration, so a malformed group fails at import time.
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
async function writable(fn: () => void): Promise<void> {
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

  it('fails at IMPORT time when the app registers a malformed group', () => {
    jest.isolateModules(() => {
      jest.doMock('../../app-registrations/telemetry', () => ({
        APP_METRIC_GROUPS: [group({ families: [family({ key: 'cpuUtilization' })] })],
      }));
      expect(() => require('./metric-catalog')).toThrow(/family key "cpuUtilization" is already used by group "host"/);
    });
    jest.dontMock('../../app-registrations/telemetry');
  });

  it('includes an app group registered at import time in every derived view', () => {
    jest.isolateModules(() => {
      jest.doMock('../../app-registrations/telemetry', () => ({ APP_METRIC_GROUPS: [group()] }));
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const catalog = require('./metric-catalog') as typeof import('./metric-catalog');
      expect(catalog.METRIC_GROUPS).toEqual(['host', 'database', 'queue', 'nodes', 'uptime', 'pipeline', APP_GROUP]);
      expect(catalog.METRIC_GROUP_LABELS[APP_GROUP]).toBe('Test');
      expect(catalog.METRIC_FAMILIES.map((f) => f.key)).toEqual([...METRIC_FAMILIES.map((f) => f.key), 'testWidgets']);
    });
    jest.dontMock('../../app-registrations/telemetry');
  });
});
