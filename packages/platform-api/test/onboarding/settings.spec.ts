// The `onboarding` user-settings namespace (issue #745): the shallow merge
// where null clears, the skipped validation and cap, the strict schema with
// app extensions, and the read that never fails.
import { BadRequestException } from '@nestjs/common';
import { ONBOARDING_SKIPPED_MAX } from '@marinoscar/platform-contract/onboarding';
import { z } from 'zod';

import { withTemporaryEntries } from '../../src/core/index';
import {
  ONBOARDING_USER_SETTINGS,
  extendOnboardingSettings,
  mergeOnboardingSettings,
  onboardingStepRegistry,
  readOnboardingState,
} from '../../src/onboarding/index';
import { extendUserSettingsNamespace, userSettingsNamespaceRegistry } from '../../src/settings/index';
import { boolStep } from './support';

const SKIPPABLE = boolStep('user.skippable', 'f');
const REQUIRED = boolStep('admin.required', 'f', { audience: 'admin', tier: 'required', skippable: false });
const T1 = '2026-01-01T00:00:00.000Z';

describe('mergeOnboardingSettings', () => {
  it('keeps on undefined, clears on null, replaces provided fields and deletes explicit nulls', () => {
    expect(mergeOnboardingSettings({ welcomeSeenAt: T1 }, undefined)).toEqual({ welcomeSeenAt: T1 });
    expect(mergeOnboardingSettings({ welcomeSeenAt: T1 }, null)).toBeUndefined();
    expect(mergeOnboardingSettings({ welcomeSeenAt: T1 }, { checklistDismissedAt: T1 })).toEqual({
      welcomeSeenAt: T1,
      checklistDismissedAt: T1,
    });
    expect(mergeOnboardingSettings({ welcomeSeenAt: T1, checklistDismissedAt: T1 }, { welcomeSeenAt: null, checklistDismissedAt: null })).toBeUndefined();
  });

  it('accepts only registered, skippable ids in skipped', () =>
    withTemporaryEntries(onboardingStepRegistry, [SKIPPABLE, REQUIRED], () => {
      expect(mergeOnboardingSettings(undefined, { skipped: ['user.skippable', 'user.skippable'] })).toEqual({ skipped: ['user.skippable'] });
      expect(() => mergeOnboardingSettings(undefined, { skipped: ['admin.required'] })).toThrow(BadRequestException);
      expect(() => mergeOnboardingSettings(undefined, { skipped: ['user.unknown'] })).toThrow(/refused: user.unknown/);
    }));

  it('drops stored ids that stopped qualifying on the next write', () =>
    withTemporaryEntries(onboardingStepRegistry, [SKIPPABLE], () => {
      expect(mergeOnboardingSettings({ skipped: ['user.skippable', 'user.gone'] }, { welcomeSeenAt: T1 })).toEqual({
        skipped: ['user.skippable'],
        welcomeSeenAt: T1,
      });
    }));

  it('caps skipped through the stored schema', () => {
    const many = Array.from({ length: ONBOARDING_SKIPPED_MAX + 1 }, (_, i) => `user.s${i}`);
    expect(ONBOARDING_USER_SETTINGS.schema.safeParse({ skipped: many }).success).toBe(false);
  });
});

describe('extendOnboardingSettings', () => {
  it('keeps the namespace strict while adding the app field', () => {
    const extended = extendUserSettingsNamespace(ONBOARDING_USER_SETTINGS, extendOnboardingSettings({ goal: z.enum(['strength', 'general']).optional() }));
    expect(extended.schema.safeParse({ goal: 'strength', welcomeSeenAt: T1 }).success).toBe(true);
    expect(extended.schema.safeParse({ goal: 'other' }).success).toBe(false);
    expect(extended.schema.safeParse({ stray: 1 }).success).toBe(false);
    expect(extended.merge({ welcomeSeenAt: T1, goal: 'strength' }, { goal: null })).toEqual({ welcomeSeenAt: T1 });
  });

  it('refuses a platform field', () => {
    expect(() => extendOnboardingSettings({ skipped: z.string() })).toThrow(/platform field/);
  });

  it('is what readOnboardingState parses with once registered', () => {
    const extended = extendUserSettingsNamespace(ONBOARDING_USER_SETTINGS, extendOnboardingSettings({ goal: z.string().optional() }));
    return withTemporaryEntries(userSettingsNamespaceRegistry, [extended], () => {
      expect(readOnboardingState({ onboarding: { goal: 'general' } })).toEqual(
        expect.objectContaining({ goal: 'general', welcomeSeenAt: null, skipped: [] }),
      );
    });
  });
});

describe('readOnboardingState', () => {
  it('reads absent and unparseable namespaces as all null', () => {
    const empty = { welcomeSeenAt: null, checklistDismissedAt: null, adminDismissedAt: null, skipped: [] };
    expect(readOnboardingState(null)).toEqual(empty);
    expect(readOnboardingState({ onboarding: 'garbage' })).toEqual(empty);
    expect(readOnboardingState({ onboarding: { welcomeSeenAt: 'not a date' } })).toEqual(empty);
  });

  it('drops skipped ids that are no longer registered and skippable', () =>
    withTemporaryEntries(onboardingStepRegistry, [SKIPPABLE], () => {
      expect(readOnboardingState({ onboarding: { welcomeSeenAt: T1, skipped: ['user.skippable', 'user.gone'] } })).toEqual({
        welcomeSeenAt: T1,
        checklistDismissedAt: null,
        adminDismissedAt: null,
        skipped: ['user.skippable'],
      });
    }));
});
