// The key-prefix registry's scopes and key builder (issue #736, PP-8.3):
// org-aware keys for new objects, legacy keys still under their root, the
// lists a full purge and an org offboarding enumerate.

import { RegistryError, withTemporaryEntries } from '../../src/core/index';
import * as tenancy from '../../src/identity/auth/tenancy-mode';
import {
  KEY_PREFIX_SCOPES,
  allKeyPrefixes,
  buildObjectKey,
  isRegisteredStorageKey,
  orgKeyPrefixes,
  registerKeyPrefix,
  registerStorageKeyPrefixes,
  storageKeyPrefixRegistry,
  type StorageKeyPrefixDef,
} from '../../src/storage/storage-key-prefix.registry';
import { STORAGE_SLICE_KEY_PREFIXES, ensureStorageSliceKeyPrefixes } from '../../src/storage/storage-key-prefixes';

const ORG = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const DEFAULT_ORG = '33333333-3333-4333-8333-333333333333';

const exportsDef: StorageKeyPrefixDef = {
  id: 'exports',
  prefix: 'exports/',
  owner: 'test-app',
  scope: 'org',
  description: 'test exports',
};

beforeAll(() => ensureStorageSliceKeyPrefixes());
afterEach(() => jest.restoreAllMocks());

describe('the slice registers its own prefixes, with their scopes', () => {
  it('uploads is org scope, avatars user scope, node-outputs and storage-config-test deployment scope', () => {
    const scopes = Object.fromEntries(storageKeyPrefixRegistry.list().map((def) => [def.id, def.scope]));
    expect(scopes).toMatchObject({
      uploads: 'org',
      avatars: 'user',
      'node-outputs': 'deployment',
      'storage-config-test': 'deployment',
    });
  });

  it('registering them again is a no-op (an app manifest may have registered them first)', () => {
    const before = storageKeyPrefixRegistry.ids();
    expect(() => registerStorageKeyPrefixes(STORAGE_SLICE_KEY_PREFIXES)).not.toThrow();
    expect(storageKeyPrefixRegistry.ids()).toEqual(before);
  });

  it('a different definition under a registered id is still a DUPLICATE_ID', async () => {
    await withTemporaryEntries(storageKeyPrefixRegistry, [], () => {
      let error: unknown;
      try {
        registerKeyPrefix({ ...STORAGE_SLICE_KEY_PREFIXES[0]!, description: 'something else' });
      } catch (err) {
        error = err;
      }
      expect(error).toBeInstanceOf(RegistryError);
      expect((error as RegistryError).code).toBe('DUPLICATE_ID');
    });
  });

  it('refuses an unknown scope', async () => {
    await withTemporaryEntries(storageKeyPrefixRegistry, [], () => {
      expect(() => registerKeyPrefix({ ...exportsDef, scope: 'tenant' as never })).toThrow(/scope "tenant" must be one of/);
    });
    expect(KEY_PREFIX_SCOPES).toEqual(['deployment', 'org', 'user']);
  });
});

describe('buildObjectKey', () => {
  it('org scope: <prefix><orgId>/<parts>', () => {
    expect(buildObjectKey('uploads', { orgId: ORG }, '1700000000000', 'abc.pdf')).toBe(`uploads/${ORG}/1700000000000/abc.pdf`);
  });

  it('user scope: <prefix><userId>/<parts>', () => {
    expect(buildObjectKey('avatars', { userId: USER }, 'pic.png')).toBe(`avatars/${USER}/pic.png`);
    expect(() => buildObjectKey('avatars', { orgId: ORG }, 'pic.png')).toThrow(/userId/);
  });

  it('deployment scope: <prefix><parts>, ignoring the context', () => {
    expect(buildObjectKey('storage-config-test', { orgId: ORG, userId: USER }, 'probe-1')).toBe('storage-config-test/probe-1');
  });

  it("buildObjectKey('uploads', {}) throws outside single-org mode", () => {
    jest.spyOn(tenancy, 'currentTenancyMode').mockReturnValue('multi');
    expect(() => buildObjectKey('uploads', {}, 'x')).toThrow(/needs ctx.orgId/);
    // A default organization is never used in multi mode.
    expect(() => buildObjectKey('uploads', { defaultOrgId: DEFAULT_ORG }, 'x')).toThrow(/needs ctx.orgId/);
  });

  it('uses the default organization of the request scope inside single-org mode', () => {
    jest.spyOn(tenancy, 'currentTenancyMode').mockReturnValue('single');
    expect(buildObjectKey('uploads', { defaultOrgId: DEFAULT_ORG }, 'x')).toBe(`uploads/${DEFAULT_ORG}/x`);
    // ... and still needs SOME organization: there is no implicit one.
    expect(() => buildObjectKey('uploads', {}, 'x')).toThrow(/needs ctx.orgId/);
    // An explicit orgId always wins over the default.
    expect(buildObjectKey('uploads', { orgId: ORG, defaultOrgId: DEFAULT_ORG }, 'x')).toBe(`uploads/${ORG}/x`);
  });

  it('refuses an unknown prefix, no parts, and parts or ids that are not one path segment', () => {
    expect(() => buildObjectKey('nope', { orgId: ORG }, 'x')).toThrow(/no key prefix "nope"/);
    expect(() => buildObjectKey('uploads', { orgId: ORG })).toThrow(/at least one part/);
    for (const part of ['', 'a/b', '.', '..']) {
      expect(() => buildObjectKey('uploads', { orgId: ORG }, part)).toThrow(/invalid key part/);
    }
    for (const orgId of ['', 'a/b', '..']) {
      expect(() => buildObjectKey('uploads', { orgId }, 'x')).toThrow(/one non-empty path segment/);
    }
  });

  it('an app-registered org prefix builds the same way', async () => {
    await withTemporaryEntries(storageKeyPrefixRegistry, [exportsDef], () => {
      expect(buildObjectKey('exports', { orgId: ORG }, 'report.zip')).toBe(`exports/${ORG}/report.zip`);
    });
  });

  it('a pre-#736 registration (no scope) builds deployment-scoped keys', async () => {
    const legacy: StorageKeyPrefixDef = { id: 'legacy-app', prefix: 'legacy-app/', owner: 'test-app', description: 'no scope' };
    await withTemporaryEntries(storageKeyPrefixRegistry, [legacy], () => {
      expect(buildObjectKey('legacy-app', { orgId: ORG }, 'a.txt')).toBe('legacy-app/a.txt');
    });
  });
});

describe('the purge and offboarding lists', () => {
  it('allKeyPrefixes() is every root prefix, in registration order, frozen, including app prefixes', async () => {
    await withTemporaryEntries(storageKeyPrefixRegistry, [exportsDef], () => {
      const all = allKeyPrefixes();
      expect(all).toEqual(storageKeyPrefixRegistry.list().map((def) => def.prefix));
      expect(all).toContain('exports/');
      expect(all).toEqual(expect.arrayContaining(['uploads/', 'avatars/', 'node-outputs/', 'storage-config-test/']));
      expect(Object.isFrozen(all)).toBe(true);
    });
  });

  it('orgKeyPrefixes(orgId) returns only org-scoped prefixes, with the org segment', async () => {
    await withTemporaryEntries(storageKeyPrefixRegistry, [exportsDef], () => {
      expect(orgKeyPrefixes(ORG)).toEqual([`uploads/${ORG}/`, `exports/${ORG}/`]);
    });
    expect(orgKeyPrefixes(ORG)).toEqual([`uploads/${ORG}/`]);
    expect(() => orgKeyPrefixes('')).toThrow();
  });

  it('legacy keys stay under their root prefix: a full purge still covers both layouts', () => {
    const legacy = 'uploads/1700000000000/0b0c.pdf';
    const current = buildObjectKey('uploads', { orgId: ORG }, '1700000000000', '0b0c.pdf');

    expect(isRegisteredStorageKey(legacy)).toBe(true);
    expect(isRegisteredStorageKey(current)).toBe(true);
    // ... but only the new layout is under the org's offboarding prefix, which
    // is why offboarding also deletes `storage_objects WHERE org_id = $1` by key.
    expect(orgKeyPrefixes(ORG).some((prefix) => current.startsWith(prefix))).toBe(true);
    expect(orgKeyPrefixes(ORG).some((prefix) => legacy.startsWith(prefix))).toBe(false);
  });
});
