// Fixtures for the onboarding slice's tests (issue #745).
import type { OnboardingDataPort, OnboardingFactDef, OnboardingStepDef } from '../../src/onboarding/index';

export const USER_ID = '11111111-1111-4111-8111-111111111111';

/** A data port answering "nothing yet", recording each call. */
export function fakeData(overrides: Partial<OnboardingDataPort> = {}): OnboardingDataPort & { calls: string[] } {
  const calls: string[] = [];
  const port: OnboardingDataPort & { calls: string[] } = {
    calls,
    readUserSettingsValue: async () => (calls.push('readUserSettingsValue'), null),
    countAllowlistEntriesExcept: async () => (calls.push('countAllowlistEntriesExcept'), 0),
    hasPushSubscription: async () => (calls.push('hasPushSubscription'), false),
    queryAggregate: async () => (calls.push('queryAggregate'), []),
    ...overrides,
  };
  return port;
}

/** A counted fact. */
export function countedFact<T>(id: string, value: T): OnboardingFactDef<T> & { count: () => number } {
  let count = 0;
  return {
    id,
    resolve: async () => {
      count += 1;
      return value;
    },
    count: () => count,
  };
}

/** A user step over one boolean fact. */
export function boolStep(id: string, fact: string, extra: Partial<OnboardingStepDef> = {}): OnboardingStepDef {
  return {
    id,
    audience: 'user',
    tier: 'optional',
    order: 10,
    title: `Title ${id}`,
    description: `Description ${id}`,
    actionLabel: 'Go',
    href: '/somewhere',
    skippable: true,
    facts: [fact],
    evaluate: (facts) => ({ status: facts[fact] === true ? 'done' : 'todo' }),
    ...extra,
  };
}
