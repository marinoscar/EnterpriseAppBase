/**
 * The units an app registers (PP-14.18): formatted from the descriptors
 * `/metric-groups` serves, never overriding a built-in id.
 */
import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';

import {
  MetricUnitFormatsContext,
  metricUnitFormatsOf,
  useMetricUnitFormats,
} from '../../../src/telemetry/headless/context/metricUnitFormats.js';
import {
  formatMetricValue,
  formatTileValue,
  formatWithDescriptor,
} from '../../../src/telemetry/headless/lib/format.js';
import type { MetricUnitFormats } from '../../../src/telemetry/headless/lib/format.js';
import type { DashboardMetricUnitDescriptor } from '../../../src/telemetry/headless/services/telemetryDashboard.js';

const USD: DashboardMetricUnitDescriptor = {
  id: 'usd',
  label: 'US dollars',
  format: 'currency',
  currency: 'USD',
  decimals: 2,
};
const NUDGES: DashboardMetricUnitDescriptor = {
  id: 'nudges',
  label: 'Nudges',
  format: 'number',
  decimals: 0,
  suffix: ' nudges',
};
const formats: MetricUnitFormats = new Map([USD, NUDGES].map((unit) => [unit.id, unit]));

describe('formatWithDescriptor', () => {
  it("formats a currency with the browser's Intl, to the declared decimals", () => {
    expect(formatWithDescriptor(1234.5, USD, 0).value).toBe(
      new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(1234.5)
    );
    expect(formatWithDescriptor(1234.5, USD).unit).toBe('');
    expect(formatWithDescriptor(2.999, { ...USD, decimals: 0 }).value).toContain('3');
  });

  it('falls back to the amount and the code when the currency code is not one Intl knows', () => {
    expect(formatWithDescriptor(5, { ...USD, currency: 'ZZZZ' })).toEqual({
      value: '5',
      unit: 'ZZZZ',
    });
  });

  it.each([
    [
      { id: 'a', label: 'A', format: 'number', decimals: 1, suffix: ' pts' },
      12.345,
      { value: '12.3', unit: 'pts' },
    ],
    [{ id: 'a', label: 'A', format: 'number' }, 12.345, { value: '12.35', unit: '' }],
    [{ id: 'a', label: 'A', format: 'percent', decimals: 1 }, 12.345, { value: '12.3', unit: '%' }],
    [{ id: 'a', label: 'A', format: 'bytes' }, 1536, { value: '1.5', unit: 'KB' }],
    [{ id: 'a', label: 'A', format: 'duration-ms' }, 1500, { value: '1.5', unit: 's' }],
    [{ id: 'a', label: 'A', format: 'duration-s' }, 900, { value: '15', unit: 'min' }],
    [{ id: 'a', label: 'A', format: 'boolean' }, 1, { value: 'Yes', unit: '' }],
    [{ id: 'a', label: 'A', format: 'text' }, 'hello', { value: 'hello', unit: '' }],
  ] as Array<[DashboardMetricUnitDescriptor, number | string, { value: string; unit: string }]>)(
    '%j of %s',
    (unit, value, expected) => {
      expect(formatWithDescriptor(value, unit)).toEqual(expected);
    }
  );

  it('reads a missing or unparsable value as "—"', () => {
    expect(formatWithDescriptor(null, USD)).toEqual({ value: '—', unit: '' });
    expect(formatWithDescriptor('abc', NUDGES)).toEqual({ value: '—', unit: '' });
  });
});

describe("formatTileValue and formatMetricValue with the app's units", () => {
  it('format an app unit from its descriptor, and show an unregistered one as given', () => {
    expect(formatMetricValue(12, 'nudges', 0, formats)).toBe('12 nudges');
    expect(formatMetricValue(12.5, 'zorkmids', 0, formats)).toBe('12.5 zorkmids');
    expect(formatMetricValue(12.5, 'nudges', 0)).toBe('12.5 nudges');
    expect(formatTileValue(7, 'nudges', 0, formats)).toEqual({ value: '7', unit: 'nudges' });
  });

  it('never let a descriptor override a built-in unit id', () => {
    const hostile: MetricUnitFormats = new Map([
      ['bytes', { id: 'bytes', label: 'Evil', format: 'number', suffix: ' pwned' }],
    ]);
    expect(formatMetricValue(1536, 'bytes', 0, hostile)).toBe('1.5 KB');
    expect(formatMetricValue(35.64, '%', 0, hostile)).toBe('35.64%');
  });

  it('format every built-in unit exactly as without descriptors', () => {
    for (const [value, unit] of [
      [1500, 'ms'],
      [900, 'seconds'],
      [3, 'per_min'],
      [true, 'boolean'],
      ['x', 'text'],
    ] as const) {
      expect(formatMetricValue(value, unit, 0, formats)).toBe(formatMetricValue(value, unit, 0));
    }
  });
});

describe('metricUnitFormatsOf and the context', () => {
  it("folds every group's units into one map, and is empty for the platform groups", () => {
    expect(metricUnitFormatsOf(undefined).size).toBe(0);
    expect(metricUnitFormatsOf([{}, { units: [] }]).size).toBe(0);
    const folded = metricUnitFormatsOf([{ units: [USD] }, { units: [USD, NUDGES] }, {}]);
    expect([...folded.keys()]).toEqual(['usd', 'nudges']);
  });

  it('provides the map to the hook, empty outside a provider', () => {
    expect(renderHook(() => useMetricUnitFormats()).result.current.size).toBe(0);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <MetricUnitFormatsContext.Provider value={formats}>
        {children}
      </MetricUnitFormatsContext.Provider>
    );
    expect(renderHook(() => useMetricUnitFormats(), { wrapper }).result.current.get('usd')).toEqual(
      USD
    );
  });
});
