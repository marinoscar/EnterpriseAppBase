import { describe, expect, it } from 'vitest';
import {
  addCalendarInZone,
  addDaysToDateKey,
  DEFAULT_SERVER_TIME_ZONE,
  TIME_ZONE_HEADER,
  getTimeZoneOffsetMinutes,
  zonedDateKey,
  zonedDayStart,
} from '../src/timezone/index.js';

describe('timezone', () => {
  it('defaults to UTC', () => expect(DEFAULT_SERVER_TIME_ZONE).toBe('UTC'));
  it('names the header', () => expect(TIME_ZONE_HEADER).toBe('x-time-zone'));

  it('reads the offset, DST aware', () => {
    expect(getTimeZoneOffsetMinutes(new Date('2026-07-01T00:00:00Z'), 'America/Costa_Rica')).toBe(-360);
    expect(getTimeZoneOffsetMinutes(new Date('2026-01-15T12:00:00Z'), 'America/Chicago')).toBe(-360);
    expect(getTimeZoneOffsetMinutes(new Date('2026-07-15T12:00:00.789Z'), 'America/Chicago')).toBe(-300);
    expect(getTimeZoneOffsetMinutes(new Date('2026-01-01T00:00:00Z'), 'Asia/Kolkata')).toBe(330);
    expect(getTimeZoneOffsetMinutes(0, 'UTC')).toBe(0);
  });

  it('keys an instant by the zone calendar day', () => {
    const t = new Date('2026-10-27T02:30:00Z');
    expect(zonedDateKey(t, 'UTC')).toBe('2026-10-27');
    expect(zonedDateKey(t, 'America/Costa_Rica')).toBe('2026-10-26');
    expect(zonedDateKey(t, 'Pacific/Auckland')).toBe('2026-10-27');
  });

  it('finds local midnight, including 23h and 25h days', () => {
    expect(zonedDayStart('2026-10-27', 'UTC').toISOString()).toBe('2026-10-27T00:00:00.000Z');
    expect(zonedDayStart('2026-10-27', 'America/Costa_Rica').toISOString()).toBe('2026-10-27T06:00:00.000Z');
    // US spring forward 2026-03-08, fall back 2026-11-01.
    const mar8 = zonedDayStart('2026-03-08', 'America/Chicago');
    const mar9 = zonedDayStart('2026-03-09', 'America/Chicago');
    expect(mar8.toISOString()).toBe('2026-03-08T06:00:00.000Z');
    expect(mar9.toISOString()).toBe('2026-03-09T05:00:00.000Z');
    expect((mar9.getTime() - mar8.getTime()) / 3_600_000).toBe(23);
    const nov1 = zonedDayStart('2026-11-01', 'America/Chicago');
    const nov2 = zonedDayStart('2026-11-02', 'America/Chicago');
    expect((nov2.getTime() - nov1.getTime()) / 3_600_000).toBe(25);
  });

  it('starts a day after a skipped midnight at the first instant after the gap', () => {
    // Sao Paulo skipped 2018-11-04 00:00 -> 01:00.
    const start = zonedDayStart('2018-11-04', 'America/Sao_Paulo');
    expect(start.toISOString()).toBe('2018-11-04T03:00:00.000Z');
    expect(zonedDateKey(start, 'America/Sao_Paulo')).toBe('2018-11-04');
    expect(zonedDateKey(new Date(start.getTime() - 1), 'America/Sao_Paulo')).toBe('2018-11-03');
  });

  it('rejects a malformed day', () => {
    expect(() => zonedDayStart('2026-02-30', 'UTC')).toThrow(RangeError);
    expect(() => zonedDayStart('nope', 'UTC')).toThrow(RangeError);
  });

  it('shifts day keys without a zone', () => {
    expect(addDaysToDateKey('2026-02-28', 1)).toBe('2026-03-01');
    expect(addDaysToDateKey('2026-01-01', -1)).toBe('2025-12-31');
  });

  describe('addCalendarInZone', () => {
    it('adds days keeping the wall-clock time across DST', () => {
      // 2026-03-07 10:00 CST (16:00Z) + 1 day = 2026-03-08 10:00 CDT (15:00Z).
      const start = new Date('2026-03-07T16:00:00Z');
      expect(addCalendarInZone(start, { days: 1 }, 'America/Chicago').toISOString()).toBe('2026-03-08T15:00:00.000Z');
      expect(addCalendarInZone(start, { days: 1 }, 'UTC').toISOString()).toBe('2026-03-08T16:00:00.000Z');
    });

    it('does month math on the zone calendar, not UTC', () => {
      // 2026-01-31 20:00 in Costa Rica is 2026-02-01T02:00Z; UTC math would land on Mar 1.
      const start = new Date('2026-02-01T02:00:00Z');
      expect(addCalendarInZone(start, { months: 1 }, 'America/Costa_Rica').toISOString()).toBe('2026-03-01T02:00:00.000Z');
    });

    it('clamps Jan 31 plus one month to Feb 28, and Feb 29 in a leap year', () => {
      const jan31 = new Date('2026-01-31T18:00:00Z'); // 12:00 in Costa Rica
      expect(zonedDateKey(addCalendarInZone(jan31, { months: 1 }, 'America/Costa_Rica'), 'America/Costa_Rica')).toBe(
        '2026-02-28',
      );
      const leap = new Date('2028-01-31T18:00:00Z');
      expect(zonedDateKey(addCalendarInZone(leap, { months: 1 }, 'America/Costa_Rica'), 'America/Costa_Rica')).toBe(
        '2028-02-29',
      );
      expect(addCalendarInZone(jan31, { months: 1 }, 'America/Costa_Rica').toISOString()).toBe('2026-02-28T18:00:00.000Z');
    });

    it('rolls over years and handles negative months', () => {
      const t = new Date('2026-11-30T12:00:00Z');
      expect(addCalendarInZone(t, { months: 3 }, 'UTC').toISOString()).toBe('2027-02-28T12:00:00.000Z');
      expect(addCalendarInZone(t, { months: -12 }, 'UTC').toISOString()).toBe('2025-11-30T12:00:00.000Z');
    });
  });
});
