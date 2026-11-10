import { describe, expect, it } from 'vitest';

import {
  BUILTIN_ONBOARDING_AUDIENCES,
  ONBOARDING_AUDIENCES,
  ONBOARDING_AUDIENCE_ID_PATTERN,
  ONBOARDING_SKIPPED_MAX,
  ONBOARDING_STEP_ID_PATTERN,
  onboardingAudienceSchema,
  onboardingMetricsQuerySchema,
  onboardingQuerySchema,
  onboardingResponseSchema,
  onboardingSettingsPatchSchema,
  onboardingSettingsSchema,
} from '../src/onboarding/index.js';

describe('@marinoscar/platform-contract/onboarding', () => {
  it('keeps the stored namespace strict and bounded', () => {
    expect(onboardingSettingsSchema.safeParse({}).success).toBe(true);
    expect(onboardingSettingsSchema.safeParse({ welcomeSeenAt: '2026-01-01T00:00:00.000Z' }).success).toBe(true);
    expect(onboardingSettingsSchema.safeParse({ goal: 'x' }).success).toBe(false);
    expect(onboardingSettingsSchema.safeParse({ welcomeSeenAt: 'yesterday' }).success).toBe(false);
    const tooMany = Array.from({ length: ONBOARDING_SKIPPED_MAX + 1 }, (_, i) => `user.s${i}`);
    expect(onboardingSettingsSchema.safeParse({ skipped: tooMany }).success).toBe(false);
  });

  it('lets a PATCH clear a field with null', () => {
    const parsed = onboardingSettingsPatchSchema.parse({ welcomeSeenAt: null, skipped: null });
    expect(parsed).toEqual({ welcomeSeenAt: null, skipped: null });
    expect(onboardingSettingsPatchSchema.safeParse({ unknown: 1 }).success).toBe(false);
  });

  it('reads refresh as a string enum, never a coerced boolean', () => {
    expect(onboardingQuerySchema.parse({ refresh: 'false' })).toEqual({ refresh: false });
    expect(onboardingQuerySchema.parse({ refresh: 'true' })).toEqual({ refresh: true });
    expect(onboardingQuerySchema.safeParse({ refresh: '1' }).success).toBe(false);
  });

  it('bounds the metrics window', () => {
    expect(onboardingMetricsQuerySchema.parse({})).toEqual({ days: 30 });
    expect(onboardingMetricsQuerySchema.parse({ days: '7' })).toEqual({ days: 7 });
    expect(onboardingMetricsQuerySchema.safeParse({ days: '0' }).success).toBe(false);
    expect(onboardingMetricsQuerySchema.safeParse({ days: '366' }).success).toBe(false);
  });

  it('namespaces step ids', () => {
    expect(ONBOARDING_STEP_ID_PATTERN.test('admin.storage')).toBe(true);
    expect(ONBOARDING_STEP_ID_PATTERN.test('admin.org-invite')).toBe(true);
    expect(ONBOARDING_STEP_ID_PATTERN.test('storage')).toBe(false);
    expect(ONBOARDING_STEP_ID_PATTERN.test('Admin.Storage')).toBe(false);
  });

  it('carries app fields through the stored state', () => {
    const parsed = onboardingResponseSchema.parse({
      settings: { welcomeSeenAt: null, checklistDismissedAt: null, adminDismissedAt: null, skipped: [], goal: 'strength' },
      user: { steps: [], completed: 0, total: 0, requiredDone: true, allResolved: true },
      admin: null,
    });
    expect(parsed.settings['goal']).toBe('strength');
  });

  it('keeps the original two audiences and adds org_admin to the built-ins', () => {
    expect(ONBOARDING_AUDIENCES).toEqual(['admin', 'user']);
    expect(BUILTIN_ONBOARDING_AUDIENCES).toEqual(['admin', 'user', 'org_admin']);
  });

  it('opens the audience vocabulary to ids matching the pattern', () => {
    for (const id of ['admin', 'user', 'org_admin', 'coaches', 'app-coaches']) {
      expect(onboardingAudienceSchema.safeParse(id).success).toBe(true);
      expect(ONBOARDING_AUDIENCE_ID_PATTERN.test(id)).toBe(true);
    }
    for (const id of ['', 'A', 'Org Admin', '1abc', 'a', 'x'.repeat(49), 'a.b']) {
      expect(onboardingAudienceSchema.safeParse(id).success).toBe(false);
    }
  });

  it('carries the extra audiences as an optional record beside user and admin', () => {
    const block = { steps: [], completed: 0, total: 0, requiredDone: true, allResolved: true };
    const settings = { welcomeSeenAt: null, checklistDismissedAt: null, adminDismissedAt: null, skipped: [] };
    const plain = onboardingResponseSchema.parse({ settings, user: block, admin: null });
    expect('audiences' in plain).toBe(false);
    const withExtra = onboardingResponseSchema.parse({ settings, user: block, admin: null, audiences: { org_admin: block } });
    expect(Object.keys(withExtra.audiences ?? {})).toEqual(['org_admin']);
    expect(onboardingResponseSchema.safeParse({ settings, user: block, admin: null, audiences: { 'Bad Id': block } }).success).toBe(false);
  });
});
