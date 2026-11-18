import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createCli } from '../create-cli.js';
import { UsageError } from '../errors.js';
import { resetCliForTests, TEST_CLI_IDENTITY } from '../test-support.js';
import {
  appCheckoutPath,
  appDir,
  composeDirFor,
  normalizeAppDir,
  repoCheckoutPath,
  resetAppDirForTests,
  setAppDir,
} from './app-dir.js';
import { VERSIONED_MANIFESTS, versionedManifests, writeVersion } from './app-version.js';
import { composeCwd } from './compose-command.js';
import { legacyEnvPathFor } from './deployment-evidence.js';

const BASE = { identity: TEST_CLI_IDENTITY, version: '2.3.4' } as const;
const ROOT = '/srv/app';

beforeEach(() => {
  resetCliForTests();
});

afterEach(() => {
  resetAppDirForTests();
  resetCliForTests();
});

describe('deploy.appDir validation', () => {
  it.each([
    ['console', 'console'],
    ['apps/x', 'apps/x'],
    ['console/', 'console'],
    ['', ''],
  ])('accepts %j as %j', (input, expected) => {
    expect(normalizeAppDir(input)).toBe(expected);
    expect(() => createCli({ ...BASE, deploy: { appDir: input } })).not.toThrow();
    expect(appDir()).toBe(expected);
  });

  it.each([['../x'], ['/abs'], ['a//b'], ['a\\b'], ['a/../b'], ['./a'], ['C:/x'], ['console//']])(
    'rejects %j',
    (input) => {
      expect(() => normalizeAppDir(input)).toThrow(UsageError);
      expect(() => createCli({ ...BASE, deploy: { appDir: input } })).toThrow(/deploy\.appDir/);
      expect(appDir()).toBe('');
    },
  );

  it('createCli without the option restores the default', () => {
    createCli({ ...BASE, deploy: { appDir: 'console' } });
    expect(appDir()).toBe('console');
    resetCliForTests();
    expect(appDir()).toBe('');
  });
});

describe('paths with the default app directory (unchanged)', () => {
  it('resolve at the repository root', () => {
    expect(repoCheckoutPath(ROOT)).toBe(join(ROOT, 'repo'));
    expect(appCheckoutPath(ROOT)).toBe(join(ROOT, 'repo'));
    expect(composeDirFor(ROOT)).toBe(join(ROOT, 'repo', 'infra', 'compose'));
    expect(composeCwd(ROOT)).toBe(join(ROOT, 'repo', 'infra', 'compose'));
    expect(legacyEnvPathFor(ROOT)).toBe(join(ROOT, 'repo', 'infra', 'compose', '.env'));
  });

  it('keeps the default manifests', () => {
    expect([...versionedManifests()]).toEqual([...VERSIONED_MANIFESTS]);
  });
});

describe('paths with deploy.appDir = console', () => {
  it('resolve under repo/console while git stays at repo', () => {
    createCli({ ...BASE, deploy: { appDir: 'console/' } });
    expect(repoCheckoutPath(ROOT)).toBe(join(ROOT, 'repo'));
    expect(appCheckoutPath(ROOT)).toBe(join(ROOT, 'repo', 'console'));
    expect(composeCwd(ROOT)).toBe(join(ROOT, 'repo', 'console', 'infra', 'compose'));
    expect(legacyEnvPathFor(ROOT)).toBe(join(ROOT, 'repo', 'console', 'infra', 'compose', '.env'));
    expect(join(composeDirFor(ROOT), '.env.example')).toBe(
      join(ROOT, 'repo', 'console', 'infra', 'compose', '.env.example'),
    );
  });

  it('a nested directory resolves segment by segment', () => {
    setAppDir('apps/x');
    expect(appCheckoutPath(ROOT)).toBe(join(ROOT, 'repo', 'apps', 'x'));
  });

  it('prefixes the default versioned manifests', () => {
    setAppDir('console');
    expect([...versionedManifests()]).toEqual(VERSIONED_MANIFESTS.map((m) => `console/${m}`));
  });

  it('an explicit manifest list is used as given (checkout-root relative)', () => {
    createCli({ ...BASE, deploy: { appDir: 'console', versionedManifests: ['console/apps/api/package.json'] } });
    expect([...versionedManifests()]).toEqual(['console/apps/api/package.json']);
  });

  it('writes the version into the app directory manifests and its lockfile', () => {
    const repo = mkdtempSync(join(tmpdir(), 'app-dir-'));
    mkdirSync(join(repo, 'console', 'apps', 'api'), { recursive: true });
    writeFileSync(join(repo, 'console', 'apps', 'api', 'package.json'), '{"name":"api","version":"1.0.0"}\n');
    writeFileSync(
      join(repo, 'console', 'package-lock.json'),
      '{"packages":{"apps/api":{"name":"api","version":"1.0.0"},"node_modules/x":{"version":"1.0.0"}}}\n',
    );
    createCli({ ...BASE, deploy: { appDir: 'console', versionedManifests: ['console/apps/api/package.json'] } });

    const result = writeVersion(repo, '1.0.1');

    expect(result.changed).toEqual(['console/apps/api/package.json', 'console/package-lock.json']);
    const lock = readFileSync(join(repo, 'console', 'package-lock.json'), 'utf8');
    expect(lock).toContain('"apps/api":{"name":"api","version": "1.0.1"}');
    expect(lock).toContain('"node_modules/x":{"version":"1.0.0"}');
  });
});
