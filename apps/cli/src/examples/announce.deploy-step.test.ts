import { createCli } from '@marinoscar/platform-cli';
import { INSTALL_STEP_IDS, planDeploySteps } from '@marinoscar/platform-cli/deploy';
import { resetCliForTests } from '@marinoscar/platform-cli/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { APP_CLI_OPTIONS } from '../app.js';

import { announceInstall } from './announce.deploy-step.js';

// The registerDeployStep example (#715): registered, it is in the dry-run
// install plan right after `verify`.

beforeEach(() => resetCliForTests());
afterEach(() => resetCliForTests());

describe('announceInstall', () => {
  it('is not in the shipped install plan (which carries only the Android step, #746)', () => {
    createCli(APP_CLI_OPTIONS);
    const ids = [...INSTALL_STEP_IDS] as string[];
    ids.splice(ids.indexOf('verify') + 1, 0, 'android-release');
    expect(planDeploySteps('install').map((step) => step.id)).toEqual(ids);
  });

  it('runs right after verify once passed in deploySteps', () => {
    createCli({ ...APP_CLI_OPTIONS, deploySteps: [announceInstall] });
    const plan = planDeploySteps('install');
    const verify = plan.findIndex((step) => step.id === 'verify');
    expect(plan[verify + 1]).toEqual({ id: 'announce', title: 'Announce the deployment', source: 'app' });
  });

  it('skips itself when there is no commit, and logs the commit through the context', async () => {
    const logs: string[] = [];
    const context = {
      pipeline: 'install' as const,
      deployRoot: '/opt/infra/apps/app',
      checkoutPath: '/opt/infra/apps/app/repo',
      commitSha: 'abc123',
      hooks: undefined,
      log: (line: string) => logs.push(line),
      progress: () => undefined,
      exec: async () => ({ exitCode: 0, stdout: 'feat: ship it\n', stderr: '' }),
    };
    expect(announceInstall.step.skip?.({ ...context, commitSha: undefined })).toBe('no commit recorded');
    await announceInstall.step.run(context);
    expect(logs).toEqual(['Deployed abc123: feat: ship it']);
  });

  it('a duplicate id throws at createCli', () => {
    expect(() => createCli({ ...APP_CLI_OPTIONS, deploySteps: [announceInstall, announceInstall] })).toThrow(/already a step/);
  });
});
