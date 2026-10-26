import { createCli } from '@marinoscar/platform-cli';
import { resetCliForTests } from '@marinoscar/platform-cli/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { APP_CLI_OPTIONS } from '../app.js';

import { COACH_VERSIONED_MANIFESTS } from './coach.versioned-manifests.js';

// The deploy.versionedManifests example (issue #1030). The step's own behaviour
// (one commit, the lockfile, the first manifest as the source, apps/cli untouched) is pinned in the
// package: app-version.test.ts, version-step.test.ts, versioned-manifests.test.ts.

beforeEach(() => resetCliForTests());
afterEach(() => resetCliForTests());

describe('COACH_VERSIONED_MANIFESTS', () => {
  it('leaves apps/cli out and names the version source first', () => {
    expect(COACH_VERSIONED_MANIFESTS[0]).toBe('apps/api/package.json');
    expect(COACH_VERSIONED_MANIFESTS).not.toContain('apps/cli/package.json');
  });

  it('is accepted by createCli', () => {
    expect(() => createCli({ ...APP_CLI_OPTIONS, deploy: { versionedManifests: COACH_VERSIONED_MANIFESTS } })).not.toThrow();
  });

  it('is not set by the shipped CLI: the reference app keeps all four in lockstep', () => {
    expect(APP_CLI_OPTIONS.deploy).toBeUndefined();
  });

  it('refuses a malformed list at createCli', () => {
    expect(() => createCli({ ...APP_CLI_OPTIONS, deploy: { versionedManifests: [] } })).toThrow(/at least one/);
    resetCliForTests();
    expect(() => createCli({ ...APP_CLI_OPTIONS, deploy: { versionedManifests: ['apps/api/package.json', 'apps/api/package.json'] } })).toThrow(/more than once/);
  });
});
