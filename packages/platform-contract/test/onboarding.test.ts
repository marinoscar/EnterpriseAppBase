import { describe, expect, it } from 'vitest';

import {
  ONBOARDING_SKIPPED_MAX,
  ONBOARDING_STEP_ID_PATTERN,
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
});
