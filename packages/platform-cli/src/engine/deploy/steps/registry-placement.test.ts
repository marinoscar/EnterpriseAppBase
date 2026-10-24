import { afterEach, describe, expect, it } from 'vitest';

import { INSTALL_STEP_IDS, UPDATE_STEP_IDS } from './registry.js';
import { planDeploySteps } from './plan.js';
import { runPipeline, type DeployStep, type StepContext } from './pipeline.js';
import { registerDeployStep, resetDeployStepRegistryForTests, withRegisteredSteps, type DeployStepContext } from './registry.js';

afterEach(() => resetDeployStepRegistryForTests());

const noop = { title: 'Noop', run: async (): Promise<void> => undefined };

function ids(pipeline: 'install' | 'update'): string[] {
  return planDeploySteps(pipeline).map((step) => step.id);
}

describe('registerDeployStep placement (before, replaces, skipWhen)', () => {
  it('inserts a step before a built-in, keeping registration order for two', () => {
    registerDeployStep({ pipeline: 'install', id: 'pre-build-a', before: 'build', step: noop });
    registerDeployStep({ pipeline: 'install', id: 'pre-build-b', before: 'build', step: noop });
    const plan = ids('install');
    expect(plan.slice(plan.indexOf('pre-build-a') - 1, plan.indexOf('build') + 1)).toEqual(['version', 'pre-build-a', 'pre-build-b', 'build']);
  });

  it('replaces a built-in in place: the built-in id leaves the plan', () => {
    registerDeployStep({ pipeline: 'update', id: 'my-seed', replaces: 'seed', step: { ...noop, title: 'My seed' } });
    const plan = planDeploySteps('update');
    expect(plan.map((step) => step.id)).toEqual(UPDATE_STEP_IDS.map((id) => (id === 'seed' ? 'my-seed' : id)));
    expect(plan.find((step) => step.id === 'my-seed')).toEqual({ id: 'my-seed', title: 'My seed', source: 'app', replaces: 'seed' });
  });

  it('refuses to anchor on a replaced step, naming the replacement', () => {
    registerDeployStep({ pipeline: 'update', id: 'my-seed', replaces: 'seed', step: noop });
    expect(() => registerDeployStep({ pipeline: 'update', id: 'late', after: 'seed', step: noop })).toThrow(
      /"seed", which step "my-seed" already replaces; name "my-seed" instead/,
    );
    registerDeployStep({ pipeline: 'update', id: 'late', after: 'my-seed', step: noop });
    expect(ids('update')).toContain('late');
  });

  it('needs exactly one anchor', () => {
    expect(() => registerDeployStep({ pipeline: 'install', id: 'x', step: noop })).toThrow(/exactly one of after, before and replaces/);
    expect(() => registerDeployStep({ pipeline: 'install', id: 'x', after: 'build', before: 'build', step: noop })).toThrow(/exactly one/);
    expect(() => registerDeployStep({ pipeline: 'install', id: 'x', before: 'nope', step: noop })).toThrow(/not a step of the install pipeline/);
  });

  it('needs a step, except for a skip-only replaces with skipWhen', () => {
    expect(() => registerDeployStep({ pipeline: 'install', id: 'x', after: 'build' })).toThrow(/needs a title and a run function/);
    expect(() => registerDeployStep({ pipeline: 'install', id: 'x', replaces: 'build' })).toThrow(/needs a title and a run function/);
    expect(() => registerDeployStep({ pipeline: 'install', id: 'x', after: 'build', step: noop, skipWhen: () => true })).toThrow(/skipWhen applies/);
    expect(() => registerDeployStep({ pipeline: 'install', id: 'skip-seed', replaces: 'seed', skipWhen: () => true })).not.toThrow();
  });

  describe('at run time', () => {
    const context = (): StepContext => ({ journal: { line: () => undefined, step: () => undefined } as never, hooks: undefined, completed: new Set() });
    const appContext = {} as DeployStepContext;

    // Real built-in ids (a registration is validated against them); stand-in bodies.
    function builtins(order: string[]): DeployStep<StepContext>[] {
      return ['version', 'build', 'migrate'].map((id) => ({ id, title: id, run: async () => void order.push(id) }));
    }

    it('runs the replacement instead of the built-in, and a before step first', async () => {
      const order: string[] = [];
      registerDeployStep({ pipeline: 'install', id: 'b2', replaces: 'build', step: { title: 'B2', run: async () => void order.push('b2') } });
      registerDeployStep({ pipeline: 'install', id: 'pre-migrate', before: 'migrate', step: { title: 'pre', run: async () => void order.push('pre-migrate') } });
      const steps = withRegisteredSteps('install', builtins(order), () => appContext);
      await runPipeline(steps, context());
      expect(order).toEqual(['version', 'b2', 'pre-migrate', 'migrate']);
    });

    it('skip-only: the built-in runs unless skipWhen is true', async () => {
      for (const skip of [true, false]) {
        resetDeployStepRegistryForTests();
        const order: string[] = [];
        registerDeployStep({ pipeline: 'install', id: 'skip-build', replaces: 'build', skipWhen: () => skip });
        const steps = withRegisteredSteps('install', builtins(order), () => appContext);
        const result = await runPipeline(steps, context());
        expect(order).toEqual(skip ? ['version', 'migrate'] : ['version', 'build', 'migrate']);
        if (skip) expect(result.steps.find((step) => step.id === 'build')).toMatchObject({ outcome: 'skipped', detail: 'skipped by skip-build' });
      }
    });

    it('a replacement with skipWhen true skips the slot entirely', async () => {
      const order: string[] = [];
      registerDeployStep({ pipeline: 'install', id: 'b2', replaces: 'build', skipWhen: () => true, step: { title: 'B2', run: async () => void order.push('b2') } });
      const steps = withRegisteredSteps('install', builtins(order), () => appContext);
      const result = await runPipeline(steps, context());
      expect(order).toEqual(['version', 'migrate']);
      expect(result.steps.find((step) => step.id === 'b2')?.outcome).toBe('skipped');
    });
  });

  it('keeps the built-in plan when nothing is registered', () => {
    expect(ids('install')).toEqual([...INSTALL_STEP_IDS]);
  });
});
