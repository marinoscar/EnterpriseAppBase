import { afterEach, describe, expect, it } from 'vitest';

import { ensurePlatformRegistrations, resetPlatformRegistrationsForTests } from '../../builtin-registrations.js';
import { registerEnvSpecFragment } from '../../../core/index.js';

import { appStepContext } from './app-step-context.js';
import { isSecretEnvKey, redactedValues } from './step-values.js';

afterEach(() => resetPlatformRegistrationsForTests());

const env = new Map([
  ['PUBLIC_URL', 'https://a.example'],
  ['JWT_SECRET', 'hunter2'],
  ['GREPTIME_ADMIN_PASSWORD', 'pw'],
  ['COACH_API_TOKEN', 'tok'],
  ['STRIPE_API_KEY', 'sk'],
  ['COACH_NOTE', 'annotated-secret'],
  ['BLANK', ''],
]);

describe('DeployStepContext.env / answers', () => {
  it('never returns or lists a secret key (annotated or named like one)', () => {
    ensurePlatformRegistrations();
    registerEnvSpecFragment({ id: 'coach', metadata: { COACH_NOTE: { secret: true } } });
    const values = redactedValues(() => env);

    expect(values.get('PUBLIC_URL')).toBe('https://a.example');
    expect(values.get('BLANK')).toBe('');
    for (const key of ['JWT_SECRET', 'GREPTIME_ADMIN_PASSWORD', 'COACH_API_TOKEN', 'STRIPE_API_KEY', 'COACH_NOTE']) {
      expect(values.get(key), key).toBeUndefined();
      expect(values.has(key), key).toBe(true); // presence only
    }
    expect(values.keys()).toEqual(['PUBLIC_URL', 'BLANK']);
    expect(JSON.stringify([values.keys(), values.get('JWT_SECRET')])).not.toContain('hunter2');
  });

  it('is frozen and reads the source live', () => {
    const live = new Map<string, string>();
    const values = redactedValues(() => live);
    expect(Object.isFrozen(values)).toBe(true);
    expect(values.has('A')).toBe(false);
    live.set('A', '1');
    expect(values.get('A')).toBe('1');
    expect(redactedValues(() => undefined).keys()).toEqual([]);
  });

  it('is what an app step is given: env from the run, answers from the options', () => {
    ensurePlatformRegistrations();
    const context = appStepContext('install', {
      options: { deployRoot: '/x', answers: new Map([['DOMAIN', 'a.example'], ['SMTP_PASSWORD', 'p']]) },
      env,
      journal: { redact: (line: string) => line, line: () => undefined, command: () => undefined } as never,
      hooks: undefined,
      completed: new Set(),
      runCommand: (async () => undefined) as never,
    });
    expect(context.env.get('PUBLIC_URL')).toBe('https://a.example');
    expect(context.env.get('JWT_SECRET')).toBeUndefined();
    expect(context.answers.get('DOMAIN')).toBe('a.example');
    expect(context.answers.get('SMTP_PASSWORD')).toBeUndefined();
  });

  it('withholds a key whose annotation cannot be resolved', () => {
    expect(isSecretEnvKey('JWT_SECRET')).toBe(true);
    expect(isSecretEnvKey('PUBLIC_URL')).toBe(false);
  });
});
