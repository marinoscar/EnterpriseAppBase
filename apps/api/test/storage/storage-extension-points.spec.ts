import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import { Test } from '@nestjs/testing';
import { withTemporaryEntries } from '@marinoscar/platform-api/core';
import { NODE_OBJECT_STORE } from '@marinoscar/platform-api/nodes';
import {
  STORAGE_PROVIDER,
  allKeyPrefixes,
  buildObjectKey,
  nodeObjectStoreBinding,
  orgKeyPrefixes,
  registerKeyPrefix,
  runStoragePurge,
  storageKeyPrefixRegistry,
  type StorageKeyPrefixDef,
  type StorageProvider,
  type StoragePurgeClient,
} from '@marinoscar/platform-api/storage';

// The app's manifest: the platform six and the app's own prefixes.
import '../../src/platform/storage/storage-key-prefix.manifest';
import { TmpDirStorageProvider } from '../helpers/tmp-storage-provider.helper';

// =============================================================================
// The storage slice's extension points, as the reference app uses them (#736)
// =============================================================================
//
//   - rung 3: STORAGE_PROVIDER overridden by a non-S3 provider (the local-disk
//     test double), and the nodes slice's object store bound to it with
//     `nodeObjectStoreBinding`;
//   - rung 2: an app object-key prefix with `registerKeyPrefix`, org scoped,
//     built with `buildObjectKey`, listed by `allKeyPrefixes` (the full purge)
//     and `orgKeyPrefixes` (org offboarding);
//   - the purge entry point, `runStoragePurge`, listing the app's prefix.
// =============================================================================

const ORG = '11111111-1111-4111-8111-111111111111';

const EXPORTS: StorageKeyPrefixDef = {
  id: 'exports',
  prefix: 'exports/',
  owner: 'health-export',
  scope: 'org',
  description: 'User data exports, purged after seven days.',
};

describe('the storage extension points in the reference app', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'storage-ext-'));
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('STORAGE_PROVIDER: an app provider replaces the S3 driver, and the nodes slice signs through it', async () => {
    const local: StorageProvider = new TmpDirStorageProvider(dir, 'local-disk');
    const moduleRef = await Test.createTestingModule({
      providers: [{ provide: STORAGE_PROVIDER, useValue: local }, nodeObjectStoreBinding],
    }).compile();

    const provider = moduleRef.get<StorageProvider>(STORAGE_PROVIDER);
    await provider.upload('uploads/x/hello.txt', Readable.from(['hello']), { mimeType: 'text/plain' });

    expect(provider.getBucket()).toBe('local-disk');
    await expect(provider.exists('uploads/x/hello.txt')).resolves.toBe(true);
    expect(moduleRef.get(NODE_OBJECT_STORE)).toBe(local);
  });

  it('registerKeyPrefix: an org-scoped app prefix builds org keys and joins both purge lists', async () => {
    await withTemporaryEntries(storageKeyPrefixRegistry, [], () => {
      registerKeyPrefix(EXPORTS);

      expect(buildObjectKey('exports', { orgId: ORG }, 'export.zip')).toBe(`exports/${ORG}/export.zip`);
      expect(allKeyPrefixes()).toEqual(expect.arrayContaining(['uploads/', 'database-backups/', 'exports/']));
      expect(orgKeyPrefixes(ORG)).toEqual([`uploads/${ORG}/`, `exports/${ORG}/`]);
    });
  });

  it('runStoragePurge: a dry run of the booted registry lists the app prefix too', async () => {
    await withTemporaryEntries(storageKeyPrefixRegistry, [EXPORTS], async () => {
      const listed: string[] = [];
      const client: StoragePurgeClient = {
        async send(command: { constructor: { name: string }; input: { Prefix?: string } }) {
          if (command.constructor.name === 'ListObjectsV2Command') listed.push(command.input.Prefix ?? '');
          return {};
        },
      };
      const app = { get: () => ({ resolveActiveConfig: async () => ({ provider: 's3', bucket: 'b', region: 'r' }) }) };

      const outcome = await runStoragePurge(app as never, { createClient: () => client });

      expect(outcome.kind).toBe('report');
      expect(listed).toEqual([...allKeyPrefixes()]);
      expect(listed).toContain('exports/');
    });
  });
});
