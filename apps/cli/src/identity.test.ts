import { afterEach, describe, expect, it } from 'vitest';

import { DEPLOY_STATE_FILENAME } from './deploy/state.js';
import { PROXY_MANAGED_SENTINEL } from './deploy/proxy.js';
import {
  API_PATH_PREFIX,
  cliDisplayName,
  cliIdentity,
  cliName,
  configDirName,
  configFileName,
  envPrefix,
  envVar,
  replaceCliIdentityForTests,
  resolveCliIdentity,
  setCliIdentity,
  toEnvPrefix,
} from './identity.js';

// =============================================================================
// CLI identity by configuration  (#140, #715)
// =============================================================================
//
// These tests assert the DERIVATION, never the reference app's literal name,
// so they keep proving the rule in a fork that renames `appctl`.
// =============================================================================

const ACME = { name: 'acmectl', displayName: 'Acme CLI', repoSlug: 'acme/acme' };

let restore: (() => void) | undefined;
afterEach(() => {
  restore?.();
  restore = undefined;
});

describe('resolveCliIdentity', () => {
  it('derives the config directory and env prefix from the name', () => {
    const resolved = resolveCliIdentity(ACME);
    expect(resolved.configDirName).toBe('.acmectl');
    expect(resolved.envPrefix).toBe('ACMECTL_');
    expect(resolved.productName).toBe('Acme CLI');
    expect(resolved.configFileName).toBe('config.json');
  });

  it('keeps an explicit config directory and env prefix (a migrated app)', () => {
    const resolved = resolveCliIdentity({ ...ACME, configDirName: '.old', envPrefix: 'OLD_' });
    expect(resolved.configDirName).toBe('.old');
    expect(resolved.envPrefix).toBe('OLD_');
  });

  it('refuses a name that cannot be a dotfile directory and env prefix', () => {
    for (const name of ['', 'Acme', 'acme ctl', 'acme.ctl', '1acme']) {
      expect(() => resolveCliIdentity({ ...ACME, name })).toThrow(/invalid/);
    }
    expect(() => resolveCliIdentity({ ...ACME, envPrefix: 'acme-' })).toThrow(/env-var prefix/);
    expect(() => resolveCliIdentity({ ...ACME, repoSlug: 'nope' })).toThrow(/owner\/repo/);
  });

  it('never yields a config file name a machine-level gitignore would swallow', () => {
    expect(resolveCliIdentity(ACME).configFileName).not.toMatch(/^(credentials|secrets)\.json$/);
  });
});

describe('toEnvPrefix', () => {
  it('uppercases, replaces non-identifier characters and guards a leading digit', () => {
    expect(toEnvPrefix('appctl')).toBe('APPCTL_');
    expect(toEnvPrefix('acme-cli')).toBe('ACME_CLI_');
    expect(toEnvPrefix('9ctl')).toBe('_9CTL_');
  });
});

describe('accessors', () => {
  it('read the identity at call time, so a replaced identity is seen at once', () => {
    restore = replaceCliIdentityForTests(ACME);
    expect(cliName()).toBe('acmectl');
    expect(cliDisplayName()).toBe('Acme CLI');
    expect(envPrefix()).toBe('ACMECTL_');
    expect(envVar('TOKEN')).toBe('ACMECTL_TOKEN');
    expect(configDirName()).toBe('.acmectl');
    expect(configFileName()).toBe('config.json');
  });

  it('throw a clear error when no identity is set', () => {
    restore = replaceCliIdentityForTests(undefined);
    expect(() => cliName()).toThrow(/createCli/);
  });
});

describe('setCliIdentity', () => {
  it('is set-once: a different identity throws, the same one is a no-op', () => {
    restore = replaceCliIdentityForTests(undefined);
    setCliIdentity(ACME, '1.2.3');
    expect(() => setCliIdentity(ACME, '1.2.3')).not.toThrow();
    expect(() => setCliIdentity({ ...ACME, name: 'otherctl' }, '1.2.3')).toThrow(/already set/);
    expect(() => setCliIdentity(ACME, '9.9.9')).toThrow(/already set/);
    expect(cliIdentity().name).toBe('acmectl');
  });
});

describe('the fixed live-server literals (the deployed-server compatibility contract)', () => {
  it('do not follow the identity', () => {
    restore = replaceCliIdentityForTests(ACME);
    expect(DEPLOY_STATE_FILENAME).toBe('.appctl-deploy.json');
    expect(PROXY_MANAGED_SENTINEL).toBe('# Managed by appctl deploy');
  });
});

describe('API_PATH_PREFIX', () => {
  it("matches the API's global route prefix", () => {
    expect(API_PATH_PREFIX).toBe('/api');
  });
});
