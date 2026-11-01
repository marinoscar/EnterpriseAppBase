/**
 * A `status` presentation column's cell (issue #1045): a boolean as is, a 0/1
 * flag (a gauge such as a node's `on_battery`) as false/true, `invert` flips
 * it, and anything else reads as no status.
 */
import { describe, expect, it } from 'vitest';
import { statusCellValue } from '../../../../src/telemetry/ui/components/dashboard/metrics/MetricSections.js';

describe('statusCellValue', () => {
  it('passes a boolean through and flips it when inverted', () => {
    expect(statusCellValue(true, false)).toBe(true);
    expect(statusCellValue(false, false)).toBe(false);
    expect(statusCellValue(true, true)).toBe(false);
  });

  it('reads a 0/1 flag as a boolean, so an inverted on_battery column reads AC as good', () => {
    expect(statusCellValue(1, false)).toBe(true);
    expect(statusCellValue(0, false)).toBe(false);
    // `on_battery` with okText "AC", badText "Battery", invert: 0 is AC (good), 1 is Battery.
    expect(statusCellValue(0, true)).toBe(true);
    expect(statusCellValue(1, true)).toBe(false);
  });

  it('is no status for any other value', () => {
    expect(statusCellValue(0.5, false)).toBeNull();
    expect(statusCellValue(2, true)).toBeNull();
    expect(statusCellValue('up', false)).toBeNull();
    expect(statusCellValue(null, true)).toBeNull();
    expect(statusCellValue(undefined, false)).toBeNull();
  });
});
