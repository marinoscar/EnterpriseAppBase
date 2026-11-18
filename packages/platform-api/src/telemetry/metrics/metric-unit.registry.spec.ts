import { RegistryError, withTemporaryEntries } from '../../core/index';
import type { MetricFamily, MetricGroup, MetricGroupDef } from './metric-catalog';
import { metricGroupRegistry, registerMetricGroups } from './metric-catalog';
import {
  isMetricUnit,
  metricUnitIds,
  metricUnitRegistry,
  registerMetricUnit,
  type MetricUnitDef,
} from './metric-unit.registry';

// =============================================================================
// The metric-unit registry (PP-14.18)
// =============================================================================
//
// `METRIC_UNITS` was a closed list the group registry checked units against.
// Now the platform registers its fifteen units through `registerMetricUnit`,
// an app adds its own, and `assertUnit` asks the registry.
// =============================================================================

const GROUP = 'unit_test' as MetricGroup;

const USD: MetricUnitDef = { id: 'usd', label: 'US dollars', format: 'currency', currency: 'USD', decimals: 2 };

function group(unit: string): MetricGroupDef {
  return {
    id: GROUP,
    label: 'Unit test',
    title: 'Unit test',
    order: 90,
    description: 'a group that uses a unit',
    families: [
      {
        key: 'unitTestSpend',
        group: GROUP,
        label: 'Spend',
        table: 'app_unit_test_spend',
        kind: 'gauge',
        unit,
        requiredColumns: [],
        seriesAggregate: 'sum',
        bucketAggregate: 'max',
        filters: ['service', 'instance'],
      } as MetricFamily,
    ],
  };
}

function refused(fn: () => void): RegistryError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(RegistryError);
    return err as RegistryError;
  }
  throw new Error('expected the registration to be refused');
}

describe('the metric-unit registry', () => {
  it("registers the platform's fifteen units through the same function an app uses", () => {
    expect(metricUnitIds()).toEqual([
      '%', 'bytes', 'bytes/s', 'count', 'per_s', 'per_min', 'ms', 'seconds', 'hours', 'days', 'cores', 'load',
      'timestamp', 'text', 'boolean',
    ]);
    for (const id of metricUnitIds()) expect(isMetricUnit(id)).toBe(true);
    expect(isMetricUnit('usd')).toBe(false);
    expect(isMetricUnit(undefined)).toBe(false);
    expect(isMetricUnit(42)).toBe(false);
  });

  it('adds an app unit, after the platform ones', async () => {
    await withTemporaryEntries(metricUnitRegistry, [], () => {
      registerMetricUnit(USD);
      expect(metricUnitIds().at(-1)).toBe('usd');
      expect(isMetricUnit('usd')).toBe(true);
      expect(metricUnitRegistry.get('usd')).toEqual(USD);
    });
    expect(isMetricUnit('usd')).toBe(false);
  });

  it('refuses a duplicate id, a malformed id and an invalid descriptor, naming the problem', async () => {
    await withTemporaryEntries(metricUnitRegistry, [], () => {
      expect(refused(() => registerMetricUnit({ id: 'bytes', label: 'Again', format: 'bytes' })).code).toBe('DUPLICATE_ID');
      expect(refused(() => registerMetricUnit({ id: 'USD', label: 'x', format: 'number' })).code).toBe('INVALID_ID');
      const noCode = refused(() => registerMetricUnit({ id: 'eur', label: 'Euro', format: 'currency' }));
      expect(noCode.code).toBe('INVALID_ENTRY');
      expect(noCode.message).toContain('currency');
      const badFormat = refused(() => registerMetricUnit({ id: 'x1', label: 'X', format: 'html' } as unknown as MetricUnitDef));
      expect(badFormat.code).toBe('INVALID_ENTRY');
      const extra = refused(() => registerMetricUnit({ id: 'x2', label: 'X', format: 'number', render: 'alert(1)' } as unknown as MetricUnitDef));
      expect(extra.code).toBe('INVALID_ENTRY');
      expect(isMetricUnit('x1')).toBe(false);
    });
  });

  it('is what a group is checked against: an unregistered unit fails the group, a registered one passes', async () => {
    await withTemporaryEntries(metricGroupRegistry, [], async () => {
      await withTemporaryEntries(metricUnitRegistry, [], () => {
        const err = refused(() => registerMetricGroups([group('usd')]));
        expect(err.code).toBe('INVALID_ENTRY');
        expect(err.message).toContain('"usd"');
        expect(err.message).toContain('registerMetricUnit');

        registerMetricUnit(USD);
        registerMetricGroups([group('usd')]);
        expect(metricGroupRegistry.has(GROUP)).toBe(true);
      });
    });
  });

  it('freezes with the other registries: no unit after bootstrap', async () => {
    await withTemporaryEntries(metricUnitRegistry, [], () => {
      metricUnitRegistry.freeze();
      expect(refused(() => registerMetricUnit(USD)).code).toBe('FROZEN');
    });
  });
});
