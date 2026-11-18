/**
 * Pure helpers behind the AI usage UI (#444): the range, the day fill and
 * the formatting that keeps "nothing measured" distinct from "0%".
 */
import { afterEach, describe, it, expect } from 'vitest';
import { setPreferredTimeZone } from '../../../src/core/index.js';
import {
  fillDailySeries,
  formatCost,
  formatFailureRate,
  formatUnits,
  formatUsageDay,
} from '../../../src/ai/ui/usage/index.js';
import { aiUsageRangeForDays } from '../../../src/ai/headless/types.js';
import { mockAiUsageReport } from '../fixtures.js';

afterEach(() => setPreferredTimeZone(null));

describe('aiUsageRangeForDays', () => {
  it('is the last N days of the given zone, inclusive of today', () => {
    const now = new Date('2026-09-26T23:30:00.000Z');
    expect(aiUsageRangeForDays(30, now, 'UTC')).toEqual({ from: '2026-08-28', to: '2026-09-26' });
    expect(aiUsageRangeForDays(7, now, 'UTC')).toEqual({ from: '2026-09-20', to: '2026-09-26' });
    expect(aiUsageRangeForDays(90, now, 'UTC')).toEqual({ from: '2026-06-29', to: '2026-09-26' });
    expect(aiUsageRangeForDays(1, now, 'UTC')).toEqual({ from: '2026-09-26', to: '2026-09-26' });
  });

  it("takes today from the zone's wall clock, not UTC", () => {
    // 03:00 UTC on the 27th is still the 26th in Costa Rica and already the 27th in Tokyo.
    const now = new Date('2026-10-27T03:00:00.000Z');
    expect(aiUsageRangeForDays(7, now, 'America/Costa_Rica')).toEqual({ from: '2026-10-20', to: '2026-10-26' });
    expect(aiUsageRangeForDays(7, now, 'Asia/Tokyo')).toEqual({ from: '2026-10-21', to: '2026-10-27' });
  });

  it('defaults to the display zone', () => {
    setPreferredTimeZone('America/Costa_Rica');
    expect(aiUsageRangeForDays(1, new Date('2026-10-27T03:00:00.000Z'))).toEqual({ from: '2026-10-26', to: '2026-10-26' });
  });

  it('counts calendar days across a DST change', () => {
    // US clocks fall back on 2026-11-01: the window still has exactly 7 day keys.
    const now = new Date('2026-11-03T12:00:00.000Z');
    expect(aiUsageRangeForDays(7, now, 'America/New_York')).toEqual({ from: '2026-10-28', to: '2026-11-03' });
  });
});

describe('fillDailySeries', () => {
  it('fills every day of the range, in order, with zeros where the API had none', () => {
    const report = { ...mockAiUsageReport('day'), range: { from: '2026-09-22', to: '2026-09-26' } };
    const days = fillDailySeries(report);

    expect(days.map((day) => [day.key, day.requests])).toEqual([
      ['2026-09-22', 0],
      ['2026-09-23', 0],
      ['2026-09-24', 40],
      ['2026-09-25', 0],
      ['2026-09-26', 80],
    ]);
  });

  it('fills calendar days across a DST change without skipping or repeating a key', () => {
    const report = {
      ...mockAiUsageReport('day'),
      timeZone: 'America/New_York',
      series: [],
      range: { from: '2026-10-31', to: '2026-11-02' },
    };
    expect(fillDailySeries(report).map((day) => day.key)).toEqual(['2026-10-31', '2026-11-01', '2026-11-02']);
  });

  it('accepts full ISO timestamps as the range', () => {
    const report = {
      ...mockAiUsageReport('day'),
      range: { from: '2026-09-24T00:00:00.000Z', to: '2026-09-26T23:59:59.999Z' },
    };
    expect(fillDailySeries(report)).toHaveLength(3);
  });
});

describe('formatting', () => {
  it('shows a failure rate only when something was requested', () => {
    expect(formatFailureRate({ requests: 120, failed: 6 })).toBe('5.0%');
    expect(formatFailureRate({ requests: 0, failed: 0 })).toBe('—');
  });

  it('formats a day key as the day it names, whatever the display zone, and lists non-zero units', () => {
    expect(formatUsageDay('2026-09-24')).toBe('Sep 24');
    setPreferredTimeZone('Pacific/Honolulu');
    expect(formatUsageDay('2026-09-24')).toBe('Sep 24');
    expect(formatUsageDay('not-a-day')).toBe('not-a-day');
    expect(formatUnits({ images: 4, audioSeconds: 0 })).toBe('images: 4');
    expect(formatUnits({})).toBeNull();
  });
});

describe('formatCost (PP-14.17)', () => {
  it('formats an ISO currency as money, with more places for a very small amount', () => {
    expect(formatCost({ amount: 12.5, currency: 'USD' })).toBe('$12.50');
    expect(formatCost({ amount: 0.0042, currency: 'USD' })).toBe('$0.0042');
    expect(formatCost({ amount: 0, currency: 'USD' })).toBe('$0.00');
  });

  it('formats any other label as a plain amount and the label', () => {
    expect(formatCost({ amount: 3, currency: 'credits' })).toBe('3.00 credits');
    expect(formatCost({ amount: 3, currency: 'ZZZZ' })).toBe('3.00 ZZZZ');
  });

  it('is an em dash when there is no cost (no price, or mixed currencies)', () => {
    expect(formatCost(null)).toBe('—');
    expect(formatCost(undefined)).toBe('—');
  });
});
