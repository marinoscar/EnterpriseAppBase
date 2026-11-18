import { PLATFORM_METRIC_PRESENTATIONS, type MetricGroupPresentation } from '@marinoscar/platform-contract/telemetry';

import { RegistryError, withTemporaryEntries } from '../../core/index';
import { metricGroupRegistry, metricGroups, registerMetricGroups, type MetricFamily, type MetricGroup, type MetricGroupDef } from './metric-catalog';
import { assertPresentation, customUnitsOf, groupTileKeys } from './metric-presentation';
import { metricUnitRegistry, registerMetricUnit } from './metric-unit.registry';

// =============================================================================
// A group's presentation (PP-14.18)
// =============================================================================
//
// Data only, validated at registration against the group that carries it.
// =============================================================================

const GROUP = 'presentation_test' as MetricGroup;

function family(key: string, overrides: Record<string, unknown> = {}): MetricFamily {
  return {
    key,
    group: GROUP,
    label: key,
    table: `app_${key}`,
    kind: 'gauge',
    unit: 'count',
    requiredColumns: [],
    seriesAggregate: 'sum',
    bucketAggregate: 'max',
    filters: ['service', 'instance'],
    ...overrides,
  } as MetricFamily;
}

function group(presentation?: MetricGroupPresentation): MetricGroupDef {
  return {
    id: GROUP,
    label: 'Presentation test',
    title: 'Presentation test',
    order: 90,
    description: 'a group with a presentation',
    families: [
      family('ptSpend', { unit: 'usd' }),
      family('ptCost', { unit: 'usd' }),
      family('ptUsers', { unit: 'count' }),
      family('ptDepth', { tileGroups: ['pending', 'running'] }),
    ],
    ratios: [
      { key: 'ptRatio', group: GROUP, label: 'Ratio', unit: '%', numerator: [{ family: 'ptUsers' }], denominator: [{ family: 'ptDepth' }], scale: 100 },
    ],
    tables: [
      {
        key: 'ptFeatures',
        group: GROUP,
        label: 'Features',
        keyColumn: 'feature',
        keyLabel: 'Feature',
        filters: ['service', 'instance'],
        parts: [{ column: 'uses', label: 'Uses', unit: 'count', table: 'app_pt_uses', seriesAggregate: 'sum', over: 'increase' }],
      },
    ],
    ...(presentation ? { presentation } : {}),
  };
}

function message(presentation: MetricGroupPresentation): string {
  try {
    assertPresentation(group(presentation));
  } catch (err) {
    return (err as Error).message;
  }
  throw new Error('expected the presentation to be refused');
}

describe('assertPresentation', () => {
  it('accepts a group without one, and the six platform presentations', () => {
    expect(() => assertPresentation(group())).not.toThrow();
    for (const platform of metricGroups()) expect(() => assertPresentation(platform)).not.toThrow();
  });

  it('knows the tiles a group emits: a family, a ratio, and one per tile group', () => {
    expect([...groupTileKeys(group())].sort()).toEqual(
      ['ptDepth.pending', 'ptDepth.running', 'ptCost', 'ptRatio', 'ptSpend', 'ptUsers'].sort(),
    );
  });

  it('accepts a presentation that names the group\'s own tiles, charts and tables', async () => {
    await withTemporaryEntries(metricUnitRegistry, [], () => {
      registerMetricUnit({ id: 'usd', label: 'US dollars', format: 'currency', currency: 'USD' });
      expect(() =>
        assertPresentation(
          group({
            tiles: [{ metric: 'ptSpend', color: 'warn', unit: 'usd' }, { metric: 'ptDepth.pending' }, { metric: 'ptRatio' }],
            series: [{ title: 'Spend', metrics: ['ptSpend', 'ptCost'] }],
            tables: [{ metric: 'ptFeatures', topN: 5 }],
            virtualColumns: [{ id: 'perUse', label: 'Per use', expression: 'ratio', of: ['uses', 'uses'], table: 'ptFeatures' }],
          }),
        ),
      ).not.toThrow();
    });
  });

  it('refuses a tile the group does not emit, naming the choices', () => {
    const text = message({ tiles: [{ metric: 'nope' }] });
    expect(text).toContain('"nope"');
    expect(text).toContain('ptDepth.pending');
    expect(message({ tiles: [{ metric: 'ptDepth' }] })).toContain('"ptDepth"');
  });

  it('refuses a chart over an unknown metric, or over metrics in different units', () => {
    expect(message({ series: [{ title: 'X', metrics: ['nope'] }] })).toContain('not a family or ratio');
    expect(message({ series: [{ title: 'Mixed', metrics: ['ptSpend', 'ptUsers'] }] })).toContain('mixes units');
  });

  it('refuses a table or a virtual column for a table the group does not declare', () => {
    expect(message({ tables: [{ metric: 'ghost' }] })).toContain('"ghost"');
    expect(message({ virtualColumns: [{ id: 'v', label: 'V', expression: 'delta', of: ['a', 'b'], table: 'ghost' }] })).toContain('"ghost"');
  });

  it('refuses duplicates: tiles, chart titles, tables, columns, virtual column ids', () => {
    expect(message({ tiles: [{ metric: 'ptUsers' }, { metric: 'ptUsers' }] })).toContain('twice');
    expect(message({ series: [{ title: 'A', metrics: ['ptUsers'] }, { title: 'A', metrics: ['ptUsers'] }] })).toContain('twice');
    expect(message({ tables: [{ metric: 'ptFeatures' }, { metric: 'ptFeatures' }] })).toContain('twice');
    expect(message({ tables: [{ metric: 'ptFeatures', columns: [{ key: 'a' }, { key: 'a' }] }] })).toContain('twice');
    expect(
      message({
        virtualColumns: [
          { id: 'v', label: 'V', expression: 'delta', of: ['a', 'b'] },
          { id: 'v', label: 'W', expression: 'delta', of: ['a', 'b'] },
        ],
      }),
    ).toContain('twice');
  });

  it('refuses an unregistered unit on a tile or a virtual column', () => {
    expect(message({ tiles: [{ metric: 'ptUsers', unit: 'zorkmids' }] })).toContain('not registered');
    expect(message({ virtualColumns: [{ id: 'v', label: 'V', expression: 'delta', of: ['a', 'b'], unit: 'zorkmids' }] })).toContain(
      'not registered',
    );
  });

  it('refuses what the schema refuses: unknown fields, CSS colours, code', () => {
    expect(message({ tiles: [{ metric: 'ptUsers', color: '#f00' }] } as unknown as MetricGroupPresentation)).toContain('invalid');
    expect(message({ tiles: [{ metric: 'ptUsers', render: '() => 1' }] } as unknown as MetricGroupPresentation)).toContain('invalid');
  });

  it('fails group registration with the registry\'s error, naming the group', async () => {
    await withTemporaryEntries(metricGroupRegistry, [], () => {
      try {
        registerMetricGroups([group({ tiles: [{ metric: 'nope' }] })]);
        throw new Error('expected a refusal');
      } catch (err) {
        expect(err).toBeInstanceOf(RegistryError);
        expect((err as RegistryError).code).toBe('INVALID_ENTRY');
        expect((err as Error).message).toContain('presentation_test');
      }
    });
  });
});

describe('customUnitsOf', () => {
  it('is empty for every platform group: they use only built-in units', () => {
    for (const platform of metricGroups()) expect(customUnitsOf(platform)).toEqual([]);
  });

  it('lists the registered app units a group uses, once each', async () => {
    await withTemporaryEntries(metricUnitRegistry, [], () => {
      const usd = { id: 'usd', label: 'US dollars', format: 'currency', currency: 'USD' } as const;
      registerMetricUnit(usd);
      registerMetricUnit({ id: 'unused', label: 'Unused', format: 'number' });
      expect(customUnitsOf(group())).toEqual([usd]);
    });
  });
});

describe('the platform presentations', () => {
  it('are what the six platform groups declare', () => {
    for (const platform of metricGroups()) {
      expect(platform.presentation).toBe(PLATFORM_METRIC_PRESENTATIONS[platform.id as keyof typeof PLATFORM_METRIC_PRESENTATIONS]);
    }
  });
});
