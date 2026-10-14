import { createCli } from '@marinoscar/platform-cli';
import { INSTALL_STEP_IDS, UPDATE_STEP_IDS, planDeploySteps } from '@marinoscar/platform-cli/deploy';
import { resetCliForTests, testDeployStepContext } from '@marinoscar/platform-cli/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { APP_CLI_OPTIONS } from '../app.js';

import { coachWarmup, skipSeedWhenAsked } from './coach.deploy-step-placement.js';

// The registerDeployStep before / replaces / skipWhen example (PP-14.22).

beforeEach(() => resetCliForTests());
afterEach(() => resetCliForTests());

describe('coachWarmup (before)', () => {
  it('runs right before the built-in build step', () => {
    createCli({ ...APP_CLI_OPTIONS, deploySteps: [coachWarmup] });
    const ids = planDeploySteps('install').map((step) => step.id);
    expect(ids[ids.indexOf('build') - 1]).toBe('coach-warmup');
    expect(ids.filter((id) => !['coach-warmup', 'android-release'].includes(id))).toEqual([...INSTALL_STEP_IDS]);
  });

  it('skips itself without the coach group, and reads only non-secret values from env', async () => {
    expect(coachWarmup.step.skip?.(testDeployStepContext())).toBe('the coach group is not enabled');
    const calls: (readonly string[])[] = [];
    const logs: string[] = [];
    const context = testDeployStepContext(
      {
        log: (line) => logs.push(line),
        exec: async (argv) => {
          calls.push(argv);
          return { exitCode: 0, stdout: '', stderr: '' };
        },
      },
      { COACH_API_URL: 'https://coach.example.com', COACH_API_TOKEN: 'super-secret-token' },
    );
    expect(coachWarmup.step.skip?.(context)).toBeUndefined();
    await coachWarmup.step.run(context);
    expect(calls).toEqual([['curl', '--fail', '--silent', 'https://coach.example.com/warmup']]);
    // The token is present but a step cannot read it, so it cannot log it.
    expect(context.env.has('COACH_API_TOKEN')).toBe(true);
    expect(context.env.get('COACH_API_TOKEN')).toBeUndefined();
    expect(logs.join('\n')).not.toContain('super-secret-token');
  });
});

describe('skipSeedWhenAsked (replaces + skipWhen, no step)', () => {
  it('keeps the built-in seed in the plan: it is skipped at run time, not removed', () => {
    createCli({ ...APP_CLI_OPTIONS, deploySteps: [skipSeedWhenAsked] });
    const ids = planDeploySteps('update').map((step) => step.id);
    expect(ids.filter((id) => id !== 'android-release')).toEqual([...UPDATE_STEP_IDS]);
  });

  it('skips when SKIP_SEED=true', () => {
    expect(skipSeedWhenAsked.skipWhen?.(testDeployStepContext({}, { SKIP_SEED: 'true' }))).toBe(true);
    expect(skipSeedWhenAsked.skipWhen?.(testDeployStepContext({}, { SKIP_SEED: 'false' }))).toBe(false);
    expect(skipSeedWhenAsked.skipWhen?.(testDeployStepContext())).toBe(false);
  });

  it('naming a step that does not exist throws at createCli', () => {
    expect(() => createCli({ ...APP_CLI_OPTIONS, deploySteps: [{ ...skipSeedWhenAsked, replaces: 'nope' }] })).toThrow(/not a step of the update pipeline/);
  });
});
