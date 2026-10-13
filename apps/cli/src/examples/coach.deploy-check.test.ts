import { createCli } from '@marinoscar/platform-cli';
import { allChecks, requiredChecks, type CheckContext } from '@marinoscar/platform-cli/deploy';
import { resetCliForTests } from '@marinoscar/platform-cli/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { APP_CLI_OPTIONS } from '../app.js';

import { coachTokenCheck } from './coach.deploy-check.js';

// The registerDeployCheck example (PP-14.22).

beforeEach(() => resetCliForTests());
afterEach(() => resetCliForTests());

const context = (env?: Record<string, string>): CheckContext => ({
  runCommand: (async () => ({ exitCode: 0, stdout: '', stderr: '' })) as unknown as CheckContext['runCommand'],
  deployRoot: '/opt/infra/apps/app',
  bindPort: 3535,
  proxyRoot: '/opt/infra/proxy',
  ...(env === undefined ? {} : { env: new Map(Object.entries(env)) }),
});

describe('coachTokenCheck', () => {
  it('is not among the shipped checks', () => {
    createCli(APP_CLI_OPTIONS);
    expect(allChecks().map((check) => check.id)).not.toContain('coach-token');
  });

  it('comes after the built-ins in doctor and in the install preflight once passed in deployChecks', () => {
    createCli({ ...APP_CLI_OPTIONS, deployChecks: [coachTokenCheck] });
    expect(allChecks().at(-1)?.id).toBe('coach-token');
    expect(requiredChecks(allChecks(), context()).map((check) => check.id)).toContain('coach-token');
  });

  it('passes when the group is off, fails with a remedy when the token is missing, and passes when set', async () => {
    expect(await coachTokenCheck.run(context())).toMatchObject({ status: 'skip' });
    expect(await coachTokenCheck.run(context({ APP_URL: 'x' }))).toMatchObject({ status: 'pass' });
    const failing = await coachTokenCheck.run(context({ COACH_API_URL: 'https://c', COACH_API_TOKEN: '' }));
    expect(failing).toMatchObject({ status: 'fail' });
    expect(failing.remedy).toContain('COACH_API_TOKEN');
    expect(await coachTokenCheck.run(context({ COACH_API_URL: 'https://c', COACH_API_TOKEN: 'a'.repeat(24) }))).toMatchObject({ status: 'pass' });
  });

  it('a built-in id throws at createCli', () => {
    expect(() => createCli({ ...APP_CLI_OPTIONS, deployChecks: [{ ...coachTokenCheck, id: 'docker-daemon' }] })).toThrow(/already a built-in check/);
  });
});
