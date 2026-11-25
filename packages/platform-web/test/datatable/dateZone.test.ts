/**
 * The `date` filter compares calendar days in the viewer's display zone, and
 * `zonedDayRangeToInstants` maps a day range onto the instants a server
 * filters by.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { setPreferredTimeZone } from '../../src/core/index.js';
import { matchesFilterValue, zonedDayRangeToInstants } from '../../src/datatable/headless/index.js';

const m = (value: unknown, operator: string, operand: unknown) => matchesFilterValue('date', value, operator, operand as never);

afterEach(() => setPreferredTimeZone(null));

describe('date filter in the display zone', () => {
  it('compares an instant by its day in the display zone, not by its UTC prefix', () => {
    setPreferredTimeZone('America/Costa_Rica');
    // 03:00 UTC on the 5th is 21:00 on the 4th in Costa Rica.
    const late = '2026-03-05T03:00:00.000Z';
    expect(m(late, 'between', ['2026-03-04', '2026-03-04'])).toBe(true);
    expect(m(late, 'before', '2026-03-05')).toBe(true);
    expect(m(late, 'after', '2026-03-04')).toBe(false);

    setPreferredTimeZone('Asia/Tokyo');
    expect(m(late, 'between', ['2026-03-05', '2026-03-05'])).toBe(true);
  });

  it('reads epoch milliseconds and Date values as instants', () => {
    setPreferredTimeZone('America/Costa_Rica');
    const late = Date.parse('2026-03-05T03:00:00.000Z');
    expect(m(late, 'between', ['2026-03-04', '2026-03-04'])).toBe(true);
    expect(m(new Date(late), 'before', '2026-03-05')).toBe(true);
  });

  it('keeps a bare YYYY-MM-DD value or operand as the day it names', () => {
    setPreferredTimeZone('Pacific/Honolulu');
    expect(m('2026-03-04', 'between', ['2026-03-04', '2026-03-04'])).toBe(true);
    expect(m('2026-03-04', 'after', '2026-03-03')).toBe(true);
  });

  it('accepts an instant operand by its day in the display zone', () => {
    setPreferredTimeZone('America/Costa_Rica');
    expect(m('2026-03-04', 'before', '2026-03-05T03:00:00.000Z')).toBe(false);
  });
});

describe('zonedDayRangeToInstants', () => {
  it('is [local midnight of from, local midnight after to)', () => {
    expect(zonedDayRangeToInstants('2026-10-01', '2026-10-31', 'America/Costa_Rica')).toEqual({
      from: '2026-10-01T06:00:00.000Z',
      to: '2026-11-01T06:00:00.000Z',
    });
    expect(zonedDayRangeToInstants('2026-10-27', undefined, 'UTC')).toEqual({
      from: '2026-10-27T00:00:00.000Z',
      to: '2026-10-28T00:00:00.000Z',
    });
  });

  it('covers a 25-hour and a 23-hour day exactly', () => {
    // US clocks fall back on 2026-11-01 and spring forward on 2026-03-08.
    const fall = zonedDayRangeToInstants('2026-11-01', '2026-11-01', 'America/New_York');
    expect(fall).toEqual({ from: '2026-11-01T04:00:00.000Z', to: '2026-11-02T05:00:00.000Z' });
    expect(Date.parse(fall.to) - Date.parse(fall.from)).toBe(25 * 3_600_000);
    const spring = zonedDayRangeToInstants('2026-03-08', '2026-03-08', 'America/New_York');
    expect(Date.parse(spring.to) - Date.parse(spring.from)).toBe(23 * 3_600_000);
  });

  it('starts a day whose midnight is skipped at the first instant after the gap', () => {
    // Chile springs forward at midnight (2026-09-06 00:00 -> 01:00).
    expect(zonedDayRangeToInstants('2026-09-06', '2026-09-06', 'America/Santiago').from).toBe('2026-09-06T04:00:00.000Z');
  });

  it('defaults to the display zone, reads an unknown zone as UTC and refuses a bad key', () => {
    setPreferredTimeZone('Asia/Tokyo');
    expect(zonedDayRangeToInstants('2026-10-27').from).toBe('2026-10-26T15:00:00.000Z');
    expect(zonedDayRangeToInstants('2026-10-27', '2026-10-27', 'Not/AZone').from).toBe('2026-10-27T00:00:00.000Z');
    expect(() => zonedDayRangeToInstants('2026-02-30')).toThrow(RangeError);
  });
});
