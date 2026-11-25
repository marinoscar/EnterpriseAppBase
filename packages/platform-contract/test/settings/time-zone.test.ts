// `profile.timezone` is a core field: the validator, the id schema and the
// profile schemas that carry it.
import { describe, expect, it } from 'vitest';

import {
  TIME_ZONE_ID_MAX,
  isValidTimeZone,
  timeZoneIdSchema,
  userProfileSettingsPatchSchema,
  userProfileSettingsSchema,
} from '../../src/settings/index.js';

describe('isValidTimeZone', () => {
  it('accepts IANA ids', () => {
    for (const id of ['UTC', 'America/Costa_Rica', 'Europe/Paris', 'Asia/Kolkata']) expect(isValidTimeZone(id)).toBe(true);
  });

  it('rejects non-zones, non-strings, empty and oversized ids', () => {
    for (const id of ['', 'Mars/Olympus', 'not a zone', 'x'.repeat(TIME_ZONE_ID_MAX + 1), 5, null, undefined, {}]) {
      expect(isValidTimeZone(id)).toBe(false);
    }
  });
});

describe('timeZoneIdSchema and the profile schemas', () => {
  it('validates the id', () => {
    expect(timeZoneIdSchema.safeParse('Europe/Paris').success).toBe(true);
    const bad = timeZoneIdSchema.safeParse('Mars/Olympus');
    expect(bad.success).toBe(false);
    expect(timeZoneIdSchema.safeParse('x'.repeat(TIME_ZONE_ID_MAX + 1)).success).toBe(false);
  });

  it('stores timezone optionally and lets a patch clear it with null', () => {
    expect(userProfileSettingsSchema.safeParse({ imageSource: 'none' }).success).toBe(true);
    expect(userProfileSettingsSchema.safeParse({ imageSource: 'none', timezone: 'UTC' }).success).toBe(true);
    expect(userProfileSettingsSchema.safeParse({ imageSource: 'none', timezone: 'nope' }).success).toBe(false);
    expect(userProfileSettingsSchema.safeParse({ imageSource: 'none', timezone: null }).success).toBe(false);
    expect(userProfileSettingsPatchSchema.safeParse({ timezone: null }).data).toEqual({ timezone: null });
    expect(userProfileSettingsPatchSchema.safeParse({}).data).toEqual({});
    expect(userProfileSettingsPatchSchema.safeParse({ timezone: 'nope' }).success).toBe(false);
  });
});
