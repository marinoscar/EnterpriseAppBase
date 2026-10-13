import { afterEach, describe, expect, it } from 'vitest';

import { ALL_CHECKS, allChecks, requiredChecks } from './index.js';
import {
  freezeDeployCheckRegistry,
  listRegisteredDeployChecks,
  registerDeployCheck,
  resetDeployCheckRegistryForTests,
  type DeployCheck,
} from './registry.js';
import { runChecks, type CheckContext } from './types.js';

afterEach(() => resetDeployCheckRegistryForTests());

function appCheck(overrides: Partial<DeployCheck> = {}): DeployCheck {
  return {
    id: 'coach-token',
    title: 'Coach API token present',
    severity: 'required',
    run: async (context) =>
      context.env?.get('COACH_API_TOKEN')
        ? { status: 'pass', detail: 'set' }
        : { status: 'fail', detail: 'COACH_API_TOKEN is empty', remedy: 'Set COACH_API_TOKEN in .env' },
    ...overrides,
  };
}

const context = (env: Record<string, string> = {}): CheckContext => ({
  runCommand: (async () => ({ exitCode: 0, stdout: '', stderr: '' })) as unknown as CheckContext['runCommand'],
  deployRoot: '/opt/x',
  bindPort: 3535,
  proxyRoot: '/opt/proxy',
  env: new Map(Object.entries(env)),
});

describe('registerDeployCheck', () => {
  it('leaves the built-in list untouched when nothing is registered', () => {
    expect(allChecks()).toBe(ALL_CHECKS);
  });

  it('appends app checks after the built-ins, in registration order', () => {
    registerDeployCheck(appCheck());
    registerDeployCheck(appCheck({ id: 'coach-quota', severity: 'recommended' }));
    expect(allChecks().map((check) => check.id)).toEqual([...ALL_CHECKS.map((check) => check.id), 'coach-token', 'coach-quota']);
  });

  it('runs through the same runner and blocks a preflight when required and failing', async () => {
    registerDeployCheck(appCheck());
    const failing = await runChecks(requiredChecks(allChecks().filter((c) => c.id === 'coach-token'), context()), context());
    expect(failing).toMatchObject([{ id: 'coach-token', status: 'fail', severity: 'required' }]);
    const passing = await runChecks(allChecks().filter((c) => c.id === 'coach-token'), context({ COACH_API_TOKEN: 'x' }));
    expect(passing[0]?.status).toBe('pass');
  });

  it('reports a throwing app check as a failure instead of aborting the run', async () => {
    registerDeployCheck(
      appCheck({
        run: async () => {
          throw new Error('boom');
        },
      }),
    );
    const results = await runChecks(listRegisteredDeployChecks(), context());
    expect(results[0]).toMatchObject({ status: 'fail', detail: 'boom' });
  });

  it('refuses a built-in id, a duplicate, a malformed id and an unknown requires', () => {
    expect(() => registerDeployCheck(appCheck({ id: 'docker-installed' }))).toThrow(/already a built-in check/);
    registerDeployCheck(appCheck());
    expect(() => registerDeployCheck(appCheck())).toThrow(/already registered/);
    expect(() => registerDeployCheck(appCheck({ id: 'Bad Id' }))).toThrow(/invalid/);
    expect(() => registerDeployCheck(appCheck({ id: 'x', requires: ['nope'] }))).toThrow(/requires "nope"/);
    expect(() => registerDeployCheck(appCheck({ id: 'y', requires: ['docker-daemon', 'coach-token'] }))).not.toThrow();
  });

  it('refuses a check without a run function, a title or a severity', () => {
    expect(() => registerDeployCheck(appCheck({ run: undefined as never }))).toThrow(/run function/);
    expect(() => registerDeployCheck(appCheck({ title: '' }))).toThrow(/title/);
    expect(() => registerDeployCheck(appCheck({ severity: 'maybe' as never }))).toThrow(/severity/);
  });

  it('refuses a registration after the CLI is built', () => {
    freezeDeployCheckRegistry('createCli built the CLI');
    expect(() => registerDeployCheck(appCheck())).toThrow(/after createCli built the CLI/);
  });
});
