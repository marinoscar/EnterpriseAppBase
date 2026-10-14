// The storage conformance suite (issue #736) passes on the slice's own
// registrations and fails on what it exists to catch.

import { withTemporaryEntries } from '../../src/core/index';
import { storageKeyPrefixRegistry } from '../../src/storage/storage-key-prefix.registry';
import { ensureStorageSliceKeyPrefixes } from '../../src/storage/storage-key-prefixes';
import {
  checkOrgScopedKeys,
  checkStorageKeyPrefixes,
  checkStorageSettingsSchemas,
  storageConformanceSuite,
} from '../../src/storage/testing/index';
import { conformanceSuites } from '../../src/testing/index';

beforeAll(() => ensureStorageSliceKeyPrefixes());

describe('storage conformance suite', () => {
  it('registers itself with the conformance harness', () => {
    expect(conformanceSuites.has('storage')).toBe(true);
    expect(storageConformanceSuite.id).toBe('storage');
  });

  it('passes on the slice registrations', () => {
    const report = storageConformanceSuite.check({ sourceRoots: [] }, {});
    expect(report.findings).toEqual([]);
    expect(report.scanned.orgScoped).toBeGreaterThanOrEqual(1);
  });

  it('flags a missing required prefix, a malformed one and an overlapping one', () => {
    const defs = storageKeyPrefixRegistry.list();
    expect(checkStorageKeyPrefixes(defs, ['exports']).map((f) => f.message)).toEqual([
      'prefix "exports" is not registered: a purge would leave its objects behind',
    ]);
    const bad = [
      { id: 'a', prefix: 'a//', owner: 't', description: 'd' },
      { id: 'b', prefix: 'uploads/sub/', owner: 't', description: 'd' },
    ];
    const messages = checkStorageKeyPrefixes([...defs, ...bad], []).map((f) => f.message);
    expect(messages.some((m) => m.includes('"a//"'))).toBe(true);
    expect(messages.some((m) => m.includes('overlaps "uploads/"'))).toBe(true);
  });

  it('checks org-scoped keys against an app-registered org prefix too', async () => {
    await withTemporaryEntries(
      storageKeyPrefixRegistry,
      [{ id: 'exports', prefix: 'exports/', owner: 't', scope: 'org', description: 'd' }],
      () => {
        expect(checkOrgScopedKeys(storageKeyPrefixRegistry.list())).toEqual([]);
      },
    );
  });

  it('finds no secret-named field in the storage schemas', () => {
    expect(checkStorageSettingsSchemas()).toEqual([]);
  });
});

