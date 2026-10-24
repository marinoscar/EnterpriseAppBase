import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { platformSeedInputFrom, readSeedSnapshot, type SeedRegistrySnapshot } from '../../src/seed/index.js';

const SNAPSHOT: SeedRegistrySnapshot = {
  permissions: {
    roles: [{ name: 'admin', description: 'Admin' }],
    permissions: [{ name: 'a:read', description: 'Read a' }],
    rolePermissions: { admin: ['a:read'] },
  },
  settings: { jobs: { stuckThresholdMinutes: 30 } },
};

describe('platformSeedInputFrom', () => {
  it('maps the snapshots onto the input fields, keeping registration order', () => {
    const input = platformSeedInputFrom(SNAPSHOT, {});

    expect(input).toEqual({
      roles: SNAPSHOT.permissions.roles,
      permissions: SNAPSHOT.permissions.permissions,
      roleGrants: { admin: ['a:read'] },
      systemSettingsDefaults: { jobs: { stuckThresholdMinutes: 30 } },
    });
    expect('initialAdminEmail' in input).toBe(false);
  });

  it('takes the initial admin from INITIAL_ADMIN_EMAIL, as written', () => {
    expect(platformSeedInputFrom(SNAPSHOT, { INITIAL_ADMIN_EMAIL: 'Admin@Example.test' }).initialAdminEmail).toBe('Admin@Example.test');
  });

  it('treats an empty INITIAL_ADMIN_EMAIL as unset', () => {
    expect(platformSeedInputFrom(SNAPSHOT, { INITIAL_ADMIN_EMAIL: '' }).initialAdminEmail).toBeUndefined();
  });
});

describe('readSeedSnapshot', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'seed-catalog-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const put = (name: string, value: unknown): void => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, name), typeof value === 'string' ? value : JSON.stringify(value));
  };

  it('reads permissions.json and system-settings-defaults.json', () => {
    put('permissions.json', { $comment: 'generated', ...SNAPSHOT.permissions });
    put('system-settings-defaults.json', SNAPSHOT.settings);

    const read = readSeedSnapshot(dir);

    expect(read.permissions.roles).toEqual(SNAPSHOT.permissions.roles);
    expect(read.permissions.rolePermissions).toEqual(SNAPSHOT.permissions.rolePermissions);
    expect(read.settings).toEqual(SNAPSHOT.settings);
  });

  it('names the file when it is missing', () => {
    put('system-settings-defaults.json', {});
    expect(() => readSeedSnapshot(dir)).toThrow(/permissions\.json cannot be read/);
  });

  it('names the file when it is not JSON', () => {
    put('permissions.json', '{ nope');
    put('system-settings-defaults.json', {});
    expect(() => readSeedSnapshot(dir)).toThrow(/permissions\.json is not valid JSON/);
  });

  it('rejects a permissions file of the wrong shape', () => {
    put('permissions.json', { roles: [], permissions: [] });
    put('system-settings-defaults.json', {});
    expect(() => readSeedSnapshot(dir)).toThrow(/permissions\.json must hold/);
  });

  it('rejects a settings file that is not an object', () => {
    put('permissions.json', SNAPSHOT.permissions);
    put('system-settings-defaults.json', []);
    expect(() => readSeedSnapshot(dir)).toThrow(/system-settings-defaults\.json must hold one object/);
  });
});
