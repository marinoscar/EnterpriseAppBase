// The display-zone store and the formatters of `timezone/headless`.

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  TIME_ZONE_STORAGE_KEY,
  deviceTimeZone,
  formatDate,
  formatDateTime,
  formatTime,
  formatUtcOffset,
  getDisplayTimeZone,
  getPreferredTimeZone,
  getTimeZoneOffsetMinutes,
  setPreferredTimeZone,
  subscribeDisplayTimeZone,
  timeZoneFromProfile,
  zonedDateKey,
} from '../../src/timezone/headless/index.js';

// 2026-01-15 18:30 UTC: 12:30 in Costa Rica (UTC-6), 03:30 the next day in Tokyo.
const MOMENT = '2026-01-15T18:30:00.000Z';

afterEach(() => setPreferredTimeZone(null));

/** ICU versions differ on the space before AM/PM (U+202F or U+0020). */
const plain = (text: string): string => text.replace(/\s/g, ' ');

describe('the display-zone store', () => {
  it('follows the device until a zone is chosen, then the choice', () => {
    expect(getPreferredTimeZone()).toBeNull();
    expect(getDisplayTimeZone()).toBe(deviceTimeZone());
    setPreferredTimeZone('Asia/Tokyo');
    expect(getPreferredTimeZone()).toBe('Asia/Tokyo');
    expect(getDisplayTimeZone()).toBe('Asia/Tokyo');
  });

  it('ignores an id the runtime does not know', () => {
    setPreferredTimeZone('America/Costa_Rica');
    setPreferredTimeZone('Mars/Olympus_Mons');
    setPreferredTimeZone('');
    expect(getPreferredTimeZone()).toBe('America/Costa_Rica');
  });

  it('notifies subscribers on a change only, and caches the choice', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeDisplayTimeZone(listener);
    setPreferredTimeZone('Europe/Paris');
    setPreferredTimeZone('Europe/Paris');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(TIME_ZONE_STORAGE_KEY)).toBe('Europe/Paris');
    setPreferredTimeZone(null);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem(TIME_ZONE_STORAGE_KEY)).toBeNull();
    unsubscribe();
    setPreferredTimeZone('UTC');
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('survives a storage that throws', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => setPreferredTimeZone('Asia/Kolkata')).not.toThrow();
    expect(getDisplayTimeZone()).toBe('Asia/Kolkata');
    spy.mockRestore();
  });

  it('reads profile.timezone defensively', () => {
    expect(timeZoneFromProfile({ timezone: 'Asia/Tokyo' })).toBe('Asia/Tokyo');
    expect(timeZoneFromProfile({ timezone: 'nope' })).toBeNull();
    expect(timeZoneFromProfile({})).toBeNull();
    expect(timeZoneFromProfile(null)).toBeNull();
  });
});

describe('the formatters', () => {
  it('render in the chosen zone by default', () => {
    setPreferredTimeZone('America/Costa_Rica');
    expect(plain(formatTime(MOMENT, { locale: 'en-US' }))).toBe('12:30 PM');
    expect(plain(formatDate(MOMENT, { locale: 'en-US' }))).toBe('Jan 15, 2026');
    setPreferredTimeZone('Asia/Tokyo');
    expect(plain(formatDate(MOMENT, { locale: 'en-US' }))).toBe('Jan 16, 2026');
    expect(plain(formatDateTime(MOMENT, { locale: 'en-US' }))).toBe('Jan 16, 2026, 3:30 AM');
  });

  it('honour an explicit timeZone over the store', () => {
    setPreferredTimeZone('Asia/Tokyo');
    expect(plain(formatTime(MOMENT, { locale: 'en-US', timeZone: 'UTC' }))).toBe('6:30 PM');
  });

  it('take field options instead of the default styles', () => {
    expect(plain(formatDate(MOMENT, { locale: 'en-US', timeZone: 'UTC', weekday: 'long' }))).toBe('Thursday');
    expect(plain(formatDateTime(new Date(MOMENT), { locale: 'en-US', timeZone: 'UTC', hour: 'numeric', hourCycle: 'h23' }))).toBe('18');
  });

  it('render the fallback for an empty or invalid value', () => {
    expect(plain(formatDateTime(null))).toBe('—');
    expect(plain(formatDateTime(undefined))).toBe('—');
    expect(plain(formatDate(''))).toBe('—');
    expect(plain(formatTime('not a date'))).toBe('—');
    expect(plain(formatDateTime(null, { fallback: 'Never' }))).toBe('Never');
  });

  it('accept epoch milliseconds', () => {
    expect(plain(formatTime(Date.parse(MOMENT), { locale: 'en-US', timeZone: 'UTC' }))).toBe('6:30 PM');
  });
});

describe('zonedDateKey', () => {
  it('is the calendar day in the zone, across midnight', () => {
    expect(zonedDateKey(MOMENT, 'UTC')).toBe('2026-01-15');
    expect(zonedDateKey(MOMENT, 'Asia/Tokyo')).toBe('2026-01-16');
    expect(zonedDateKey('2026-01-16T05:59:00.000Z', 'America/Costa_Rica')).toBe('2026-01-15');
    expect(zonedDateKey('2026-01-16T06:00:00.000Z', 'America/Costa_Rica')).toBe('2026-01-16');
  });

  it('defaults to the display zone and returns null for no value', () => {
    setPreferredTimeZone('Asia/Tokyo');
    expect(zonedDateKey(MOMENT)).toBe('2026-01-16');
    expect(zonedDateKey(null)).toBeNull();
  });
});

describe('offsets', () => {
  it('computes the offset at a moment, daylight saving time included', () => {
    expect(getTimeZoneOffsetMinutes('America/Costa_Rica', new Date(MOMENT))).toBe(-360);
    expect(getTimeZoneOffsetMinutes('Asia/Kolkata', new Date(MOMENT))).toBe(330);
    expect(getTimeZoneOffsetMinutes('America/New_York', new Date('2026-01-15T12:00:00Z'))).toBe(-300);
    expect(getTimeZoneOffsetMinutes('America/New_York', new Date('2026-07-15T12:00:00Z'))).toBe(-240);
    expect(getTimeZoneOffsetMinutes('UTC', new Date(MOMENT))).toBe(0);
  });

  it('labels an offset with the minus sign', () => {
    expect(formatUtcOffset(-360)).toBe('UTC−06:00');
    expect(formatUtcOffset(330)).toBe('UTC+05:30');
    expect(formatUtcOffset(0)).toBe('UTC');
    expect(formatUtcOffset(-570)).toBe('UTC−09:30');
  });
});
