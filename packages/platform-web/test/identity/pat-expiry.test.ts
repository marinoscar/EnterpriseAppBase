// The Create token dialog previews the expiry the server will compute: days
// and months are calendar steps in the user's zone (`addCalendarInZone` of the
// contract, the function the PAT service uses), not 24-hour multiples.

import { afterEach, describe, expect, it } from 'vitest';

import { setPreferredTimeZone } from '../../src/core/index.js';
import { computeExpiresAt } from '../../src/identity/ui/tokens/CreatePatDialog.js';

afterEach(() => setPreferredTimeZone(null));

describe('computeExpiresAt', () => {
  it('adds minutes as a plain duration', () => {
    const now = new Date('2026-03-07T12:00:00.000Z');
    expect(computeExpiresAt(90, 'minutes', now, 'America/New_York').toISOString()).toBe('2026-03-07T13:30:00.000Z');
  });

  it('keeps the wall-clock time across a DST change when adding days', () => {
    // 07:00 in New York on Mar 7 (EST, UTC-5); US clocks spring forward on Mar 8.
    const now = new Date('2026-03-07T12:00:00.000Z');
    // Mar 9, 07:00 EDT (UTC-4): 47 hours later, not 48.
    expect(computeExpiresAt(2, 'days', now, 'America/New_York').toISOString()).toBe('2026-03-09T11:00:00.000Z');
    // In a zone with no DST the same step is exactly 48 hours.
    expect(computeExpiresAt(2, 'days', now, 'America/Costa_Rica').toISOString()).toBe('2026-03-09T12:00:00.000Z');
  });

  it('clamps a month step to the end of a shorter month, on the zone\'s calendar', () => {
    // 03:00 UTC on Jan 31 is still Jan 30, 21:00 in Costa Rica: one month is Feb 28 21:00 there.
    const now = new Date('2026-01-31T03:00:00.000Z');
    expect(computeExpiresAt(1, 'months', now, 'America/Costa_Rica').toISOString()).toBe('2026-03-01T03:00:00.000Z');
    // Read in UTC the same instant is Jan 31, clamped to Feb 28 03:00.
    expect(computeExpiresAt(1, 'months', now, 'UTC').toISOString()).toBe('2026-02-28T03:00:00.000Z');
  });

  it('defaults to the display zone and falls back to UTC for an unknown one', () => {
    setPreferredTimeZone('America/New_York');
    const now = new Date('2026-03-07T12:00:00.000Z');
    expect(computeExpiresAt(2, 'days', now).toISOString()).toBe('2026-03-09T11:00:00.000Z');
    expect(computeExpiresAt(2, 'days', now, 'Not/AZone').toISOString()).toBe('2026-03-09T12:00:00.000Z');
  });
});
