import { createCli } from '@marinoscar/platform-cli';
import { listDeployCheckIds, type DeployCheckContext } from '@marinoscar/platform-cli/deploy';
import { resetCliForTests } from '@marinoscar/platform-cli/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { APP_CLI_OPTIONS } from '../app.js';

import { coachTokenCheck } from './coach.deploy-check.js';

// The registerDeployCheck example (PP-14.22).

beforeEach(() => resetCliForTests());
afterEach(() => resetCliForTests());

/** A context whose environment withholds secrets the way the real one does. */
const context = (env?: Record<string, string>): DeployCheckContext => {
  const values = new Map(Object.entries(env ?? {}));
  return {
    deployRoot: '/opt/infra/apps/app',
    bindPort: 3535,
    proxyRoot: '/opt/infra/proxy',
    domain: undefined,
    skipProxy: false,
    env:
      env === undefined
        ? undefined
        : {
            has: (key) => (values.get(key) ?? '') !== '',
            get: (key) => (key.includes('TOKEN') ? undefined : values.get(key)),
            keys: () => [...values.keys()].filter((key) => !key.includes('TOKEN')),
          },
  };
};

describe('coachTokenCheck', () => {
  it('is not among the shipped checks', () => {
    createCli(APP_CLI_OPTIONS);
    expect(listDeployCheckIds()).not.toContain('coach-token');
  });

  it('comes after the built-ins in doctor and in the install preflight once passed in deployChecks', () => {
    createCli({ ...APP_CLI_OPTIONS, deployChecks: [coachTokenCheck] });
    expect(listDeployCheckIds().at(-1)).toBe('coach-token');
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
