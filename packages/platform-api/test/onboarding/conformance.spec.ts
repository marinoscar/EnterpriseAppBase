// The onboarding conformance suite (issue #745) finds what it promises to.
import { withTemporaryEntries } from '../../src/core/index';
import {
  PLATFORM_ONBOARDING_FACTS,
  PLATFORM_ONBOARDING_STEPS,
  onboardingFactRegistry,
  onboardingStepRegistry,
  type OnboardingFactDef,
} from '../../src/onboarding/index';
import { checkOnboardingRegistries, onboardingConformanceSuite, probeOnboardingDerivation } from '../../src/onboarding/testing/index';
import { conformanceSuites } from '../../src/testing/index';
import { boolStep } from './support';

const PERMISSIONS = ['system_settings:read', 'storage_config:read', 'allowlist:read', 'ai_config:read', 'push:read', 'db_backup:read', 'org_invites:write'].map(
  (id) => ({ id }),
);

describe('onboarding conformance suite', () => {
  it('registers itself with the harness on import', () => {
    expect(conformanceSuites.has('onboarding')).toBe(true);
    expect(onboardingConformanceSuite.id).toBe('onboarding');
  });

  it('passes for the platform steps and facts', () =>
    withTemporaryEntries(onboardingFactRegistry, PLATFORM_ONBOARDING_FACTS, () =>
      withTemporaryEntries(onboardingStepRegistry, PLATFORM_ONBOARDING_STEPS, async () => {
        expect(checkOnboardingRegistries({ permissions: PERMISSIONS })).toEqual([]);
        const probe = await probeOnboardingDerivation({ permissions: PERMISSIONS });
        expect(Object.values(probe.resolutions).every((count) => count === 1)).toBe(true);
        expect(probe.evaluationCalls).toEqual([]);
      }),
    ));

  it('flags an unregistered permission and an unknown fact', () =>
    withTemporaryEntries(onboardingStepRegistry, [boolStep('user.x', 'nobody', { permission: 'invented:read' })], () => {
      expect(checkOnboardingRegistries({ permissions: [] }).map((f) => `${f.file}: ${f.message}`)).toEqual([
        'step:user.x: reads unknown fact "nobody"',
        'step:user.x: permission invented:read is not a registered permission',
      ]);
    }));

  it('catches a step that reaches the data port while evaluating', () => {
    let leaked: OnboardingFactDef['resolve'] | null = null;
    const sneaky: OnboardingFactDef = {
      id: 'sneaky',
      resolve: async (ctx) => {
        leaked = () => ctx.data.countAllowlistEntriesExcept(null);
        return true;
      },
    };
    return withTemporaryEntries(onboardingFactRegistry, [sneaky], () =>
      withTemporaryEntries(
        onboardingStepRegistry,
        [boolStep('user.y', 'sneaky', { evaluate: () => (void leaked?.(undefined as never), { status: 'todo' }) })],
        async () => {
          const probe = await probeOnboardingDerivation({ permissions: [] });
          expect(probe.evaluationCalls).toEqual(['countAllowlistEntriesExcept']);
        },
      ),
    );
  });
});
