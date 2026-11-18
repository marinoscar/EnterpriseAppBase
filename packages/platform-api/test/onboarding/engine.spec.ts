// The onboarding engine (issue #745): Doctor mapping (skip is not pass),
// omission rules, blocked steps, ordering, facts once, skipped steps.
import type { DoctorCheckReport } from '@marinoscar/platform-contract/doctor';

import {
  evaluateDoctorChecks,
  evaluateOnboarding,
  type OnboardingEngineInput,
  type OnboardingFactDef,
  type OnboardingRequestContext,
  type OnboardingStepDef,
} from '../../src/onboarding/index';
import { USER_ID, boolStep, countedFact, fakeData } from './support';

function report(id: string, status: DoctorCheckReport['status'], remedy: string | null = null): DoctorCheckReport {
  return { id, category: id.split('.')[0]!, label: id, settingsPath: null, status, detail: `${id} detail`, remedy, error: null, data: null, durationMs: 0 };
}

function input(
  steps: OnboardingStepDef[],
  facts: OnboardingFactDef[],
  extra: Partial<OnboardingEngineInput> & { permissions?: string[]; features?: Record<string, boolean>; checks?: string[] } = {},
): OnboardingEngineInput {
  const { permissions = [], features = {}, checks, ...rest } = extra;
  return {
    steps,
    facts,
    orderings: [],
    includeAdmin: false,
    skipped: [],
    context: (doctorCheckIds, fact): OnboardingRequestContext => ({
      caller: { id: USER_ID, permissions, roles: [], activeOrgId: null },
      refresh: false,
      data: fakeData(),
      doctor: checks ? { has: (id) => checks.includes(id), reports: async () => new Map() } : null,
      doctorCheckIds,
      initialAdminEmail: null,
      isFeatureEnabled: async (feature) => features[feature] === true,
      fact: (id) => fact(id) as never,
      get: () => {
        throw new Error('none');
      },
    }),
    ...rest,
  };
}

describe('evaluateDoctorChecks', () => {
  it('is done only when every mapped check passes', () => {
    const reports = new Map([
      ['storage.config', report('storage.config', 'pass')],
      ['storage.bucket', report('storage.bucket', 'pass')],
    ]);
    expect(evaluateDoctorChecks(['storage.config', 'storage.bucket'], reports)).toEqual({ status: 'done', detail: null });
  });

  it('treats skip as not passing and reports the first non-pass remedy, else its detail', () => {
    const reports = new Map([
      ['ai.enabled', report('ai.enabled', 'skip')],
      ['ai.providers', report('ai.providers', 'fail', 'Add a provider.')],
    ]);
    expect(evaluateDoctorChecks(['ai.enabled', 'ai.providers'], reports)).toEqual({ status: 'todo', detail: 'ai.enabled detail' });
    expect(evaluateDoctorChecks(['ai.providers'], reports)).toEqual({ status: 'todo', detail: 'Add a provider.' });
  });

  it('is todo when a mapped check is missing from the report', () => {
    expect(evaluateDoctorChecks(['email.config'], new Map())).toEqual({ status: 'todo', detail: null });
  });
});

describe('evaluateOnboarding', () => {
  it('omits steps the caller lacks the permission for, or whose feature is off', async () => {
    const fact = countedFact('f', true);
    const result = await evaluateOnboarding(
      input(
        [
          boolStep('user.open', 'f'),
          boolStep('user.gated', 'f', { permission: 'things:read' }),
          boolStep('user.ai', 'f', { feature: 'ai' }),
        ],
        [fact],
        { permissions: [] },
      ),
    );
    expect(result.user.steps.map((s) => s.id)).toEqual(['user.open']);
    expect(result.admin).toBeNull();
  });

  it('includes the admin block only when asked, and omits a Doctor step whose check is not registered', async () => {
    const doctorFact: OnboardingFactDef = {
      id: 'doctor',
      resolve: async () => new Map([['storage.config', report('storage.config', 'fail', 'Configure storage.')]]),
    };
    const steps: OnboardingStepDef[] = [
      { ...boolStep('admin.storage', 'f'), audience: 'admin', tier: 'required', skippable: false, facts: [], evaluate: undefined, doctorChecks: ['storage.config'] },
      { ...boolStep('admin.missing', 'f'), audience: 'admin', facts: [], evaluate: undefined, doctorChecks: ['nobody.here'] },
    ];
    const result = await evaluateOnboarding(input(steps, [doctorFact], { includeAdmin: true, checks: ['storage.config'] }));
    expect(result.admin?.steps).toEqual([
      expect.objectContaining({ id: 'admin.storage', status: 'todo', detail: 'Configure storage.', tier: 'required', skippable: false }),
    ]);
    expect(result.admin?.requiredDone).toBe(false);
  });

  it('resolves a fact shared by several steps once', async () => {
    const fact = countedFact('f', true);
    await evaluateOnboarding(input([boolStep('user.a', 'f'), boolStep('user.b', 'f'), boolStep('user.c', 'f')], [fact]));
    expect(fact.count()).toBe(1);
  });

  it('never resolves a fact no applicable step needs', async () => {
    const needed = countedFact('needed', true);
    const unneeded = countedFact('unneeded', true);
    await evaluateOnboarding(
      input([boolStep('user.a', 'needed'), boolStep('user.b', 'unneeded', { permission: 'nope:read' })], [needed, unneeded]),
    );
    expect(unneeded.count()).toBe(0);
  });

  it('omits the steps of a fact that rejects, and warns', async () => {
    const warnings: string[] = [];
    const broken: OnboardingFactDef = { id: 'broken', resolve: async () => Promise.reject(new Error('db down')) };
    const ok = countedFact('ok', false);
    const result = await evaluateOnboarding(
      input([boolStep('user.a', 'broken'), boolStep('user.b', 'ok')], [broken, ok], { warn: (m) => warnings.push(m) }),
    );
    expect(result.user.steps.map((s) => s.id)).toEqual(['user.b']);
    expect(warnings.join(' ')).toMatch(/fact "broken" failed.*db down/);
  });

  it('carries blockedReason on a blocked step, and omits a blocked step without one', async () => {
    const fact = countedFact('f', true);
    const result = await evaluateOnboarding(
      input(
        [
          boolStep('user.blocked', 'f', { evaluate: () => ({ status: 'blocked', blockedReason: 'Add a key first.' }) }),
          boolStep('user.bad', 'f', { evaluate: () => ({ status: 'blocked' }) }),
        ],
        [fact],
      ),
    );
    expect(result.user.steps).toEqual([expect.objectContaining({ id: 'user.blocked', status: 'blocked', blockedReason: 'Add a key first.' })]);
  });

  it('omits a step whose applies is false and orders by order, then id', async () => {
    const fact = countedFact('f', false);
    const result = await evaluateOnboarding(
      input(
        [
          boolStep('user.z', 'f', { order: 1 }),
          boolStep('user.b', 'f', { order: 2 }),
          boolStep('user.a', 'f', { order: 2 }),
          boolStep('user.never', 'f', { applies: () => false }),
        ],
        [fact],
      ),
    );
    expect(result.user.steps.map((s) => s.id)).toEqual(['user.z', 'user.a', 'user.b']);
  });

  it('applies the ordering hook with its own facts', async () => {
    const goal = countedFact('goal', 'lifter');
    const f = countedFact('f', false);
    const result = await evaluateOnboarding(
      input([boolStep('user.profile', 'f', { order: 1 }), boolStep('user.gym', 'f', { order: 2 })], [goal, f], {
        orderings: [
          {
            audience: 'user',
            facts: ['goal'],
            order: (steps, facts) => (facts['goal'] === 'lifter' ? [...steps].reverse() : steps),
          },
        ],
      }),
    );
    expect(result.user.steps.map((s) => s.id)).toEqual(['user.gym', 'user.profile']);
  });

  it('marks skipped steps and counts them as resolved', async () => {
    const f = countedFact('f', false);
    const result = await evaluateOnboarding(input([boolStep('user.a', 'f')], [f], { skipped: ['user.a'] }));
    expect(result.user).toEqual(expect.objectContaining({ completed: 0, total: 1, allResolved: true }));
    expect(result.user.steps[0]).toEqual(expect.objectContaining({ skipped: true, status: 'todo' }));
  });

  it('passes a step only the facts it declared', async () => {
    let seen: string[] = [];
    const a = countedFact('a', 1);
    const b = countedFact('b', 2);
    await evaluateOnboarding(
      input(
        [
          boolStep('user.a', 'a', {
            evaluate: (facts) => {
              seen = Object.keys(facts);
              return { status: 'todo' };
            },
          }),
          boolStep('user.b', 'b'),
        ],
        [a, b],
      ),
    );
    expect(seen).toEqual(['a']);
  });
});
