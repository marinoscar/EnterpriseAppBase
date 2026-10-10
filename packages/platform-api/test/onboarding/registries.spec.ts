// The onboarding registries (issue #745): duplicates, the required-not-
// skippable rule, unknown facts, malformed milestones, freezing.
import { RegistryError, withTemporaryEntries } from '../../src/core/index';
import {
  activationMilestoneRegistry,
  assertOnboardingRegistries,
  factIdsOf,
  onboardingFactRegistry,
  onboardingOrderingRegistry,
  onboardingStepRegistry,
  PLATFORM_ONBOARDING_FACTS,
  PLATFORM_ONBOARDING_STEPS,
} from '../../src/onboarding/index';
import { boolStep } from './support';

describe('onboarding step registry', () => {
  it('accepts the platform steps and facts, consistently', () =>
    withTemporaryEntries(onboardingFactRegistry, PLATFORM_ONBOARDING_FACTS, () =>
      withTemporaryEntries(onboardingStepRegistry, PLATFORM_ONBOARDING_STEPS, () => {
        expect(onboardingStepRegistry.ids()).toEqual([
          'admin.storage',
          'admin.email',
          'admin.access',
          'admin.ai',
          'admin.push',
          'admin.backup',
          'admin.org-invite',
          'user.profile',
          'user.notifications',
        ]);
        expect(() => assertOnboardingRegistries()).not.toThrow();
      }),
    ));

  it('refuses a duplicate id, naming it as permanent', () =>
    withTemporaryEntries(onboardingStepRegistry, [boolStep('user.a', 'f')], () => {
      expect(() => onboardingStepRegistry.register(boolStep('user.a', 'f'))).toThrow(/already registered.*permanent/);
    }));

  it('refuses a required step that is skippable', () => {
    expect(() => onboardingStepRegistry.register(boolStep('user.b', 'f', { tier: 'required', skippable: true }))).toThrow(
      /required step cannot be skippable/,
    );
  });

  it('refuses an un-namespaced id, a step with neither evaluate nor doctorChecks, and funnelSql on an admin step', () => {
    expect(() => onboardingStepRegistry.register(boolStep('profile', 'f'))).toThrow(RegistryError);
    expect(() => onboardingStepRegistry.register(boolStep('user.c', 'f', { evaluate: undefined }))).toThrow(/evaluate is required/);
    expect(() =>
      onboardingStepRegistry.register(boolStep('admin.c', 'f', { audience: 'admin', funnelSql: 'true' })),
    ).toThrow(/user steps only/);
    expect(() => onboardingStepRegistry.register(boolStep('user.d', 'f', { funnelSql: 'true; drop table users' }))).toThrow(/without ";"/);
    expect(onboardingStepRegistry.size).toBe(0);
  });

  it('adds the doctor fact for doctorChecks', () => {
    expect(factIdsOf(boolStep('admin.x', 'f', { doctorChecks: ['a.b'] }))).toEqual(['f', 'doctor']);
  });

  it('fails the bootstrap check on an unknown fact', () =>
    withTemporaryEntries(onboardingStepRegistry, [boolStep('user.e', 'nobody')], () => {
      expect(() => assertOnboardingRegistries()).toThrow(/step "user.e" reads unknown fact "nobody"/);
    }));

  it('allows one ordering per audience', () =>
    withTemporaryEntries(onboardingOrderingRegistry, [{ audience: 'user', facts: [], order: (s) => s }], () => {
      expect(() => onboardingOrderingRegistry.register({ audience: 'user', facts: [], order: (s) => s })).toThrow(
        /at most one per audience/,
      );
    }));

  it('validates milestones', () => {
    const base = { id: 'first_thing', label: 'First thing', windowDays: 7, firstReachedAtSql: '(SELECT NULL::timestamptz)' };
    expect(() => activationMilestoneRegistry.register({ ...base, windowDays: 0 })).toThrow(/windowDays/);
    expect(() => activationMilestoneRegistry.register({ ...base, id: 'First' })).toThrow(RegistryError);
    expect(() => activationMilestoneRegistry.register({ ...base, firstReachedAtSql: 'now(); select 1' })).toThrow(/without ";"/);
  });

  it('is frozen once frozen', async () => {
    await withTemporaryEntries(onboardingStepRegistry, [], () => {
      onboardingStepRegistry.freeze();
      expect(() => onboardingStepRegistry.register(boolStep('user.f', 'f'))).toThrow(expect.objectContaining({ code: 'FROZEN' }));
    });
    expect(onboardingStepRegistry.frozen).toBe(false);
  });
});
