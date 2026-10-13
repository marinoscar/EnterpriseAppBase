import { createCli } from '@marinoscar/platform-cli';
import { annotateEnvKey } from '@marinoscar/platform-cli/core';
import { metadataFor } from '@marinoscar/platform-cli/deploy';
import { resetCliForTests } from '@marinoscar/platform-cli/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { APP_CLI_OPTIONS } from '../app.js';

import { coachEnvAnnotations } from './coach.env-annotation.js';

// The annotateEnvKey example (PP-14.22): the app wins for fixed and help, only.

beforeEach(() => resetCliForTests());
afterEach(() => resetCliForTests());

describe('coachEnvAnnotations', () => {
  it('changes nothing in the shipped CLI', () => {
    createCli(APP_CLI_OPTIONS);
    expect(metadataFor('OTEL_SERVICE_NAME')).toEqual({ group: 'observability' });
    expect(metadataFor('APP_URL').help).toBeUndefined();
  });

  it('wins over the platform owner for fixed and help, and keeps the rest of its metadata', () => {
    createCli({ ...APP_CLI_OPTIONS, envAnnotations: coachEnvAnnotations });
    // The platform put OTEL_SERVICE_NAME in the observability group; that stays.
    expect(metadataFor('OTEL_SERVICE_NAME')).toEqual({ group: 'observability', fixed: 'coach-api' });
    expect(metadataFor('APP_URL').help).toContain('coaching app');
  });

  it('cannot unmask a secret, fix one, or bring back a key that is never written', () => {
    createCli({
      ...APP_CLI_OPTIONS,
      envAnnotations: { JWT_SECRET: { help: 'Signs sessions.' }, GOOGLE_CLIENT_SECRET: { fixed: 'hunter2' }, TEST_AUTH_ENABLED: { fixed: 'true' } },
    });
    expect(metadataFor('JWT_SECRET')).toMatchObject({ secret: true, help: 'Signs sessions.' });
    expect(() => metadataFor('GOOGLE_CLIENT_SECRET')).toThrow(/fixes a secret key/);
    expect(metadataFor('TEST_AUTH_ENABLED')).toEqual({ never: true });
  });

  it('annotating a key twice throws', () => {
    annotateEnvKey('APP_URL', { help: 'one' });
    expect(() => createCli({ ...APP_CLI_OPTIONS, envAnnotations: { APP_URL: { help: 'two' } } })).toThrow(/already registered/);
  });
});
