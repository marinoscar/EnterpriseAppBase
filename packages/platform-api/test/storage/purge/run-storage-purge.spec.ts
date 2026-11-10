// `runStoragePurge` (issue #736): enumerates `allKeyPrefixes()` of the running
// process (app-registered prefixes included), dry run by default, and
// re-checks a typed bucket against the LIVE configuration before deleting.
// The S3 client is a fake; the prefix list is the real registry.

import { z } from 'zod';

import { withTemporaryEntries } from '../../../src/core/index';
import { registerStorageDriver } from '../../../src/storage/drivers/storage-driver';
import { runStoragePurge, runStoragePurgeCli, type StoragePurgeClient } from '../../../src/storage/purge/run-storage-purge';
import { allKeyPrefixes, storageKeyPrefixRegistry } from '../../../src/storage/storage-key-prefix.registry';
import { ensureStorageSliceKeyPrefixes } from '../../../src/storage/storage-key-prefixes';

interface Sent {
  name: string;
  input: Record<string, any>;
}

/** A fake S3 client: one 10-byte object under every prefix; records every command. */
function fakeClient(opts: { versioning?: 'Enabled' | 'unreadable' } = {}): { client: StoragePurgeClient; sent: Sent[] } {
  const sent: Sent[] = [];
  const client: StoragePurgeClient = {
    async send(command: any) {
      const name = command.constructor.name.replace(/Command$/, '');
      sent.push({ name, input: command.input });
      if (name === 'GetBucketVersioning') {
        if (opts.versioning === 'unreadable') throw new Error('AccessDenied');
        return opts.versioning === 'Enabled' ? { Status: 'Enabled' } : {};
      }
      if (name === 'ListObjectsV2') return { Contents: [{ Key: `${command.input.Prefix}object-1`, Size: 10 }], IsTruncated: false };
      if (name === 'ListObjectVersions') {
        return {
          Versions: [{ Key: `${command.input.Prefix}object-1`, VersionId: 'v1', Size: 10 }],
          DeleteMarkers: [{ Key: `${command.input.Prefix}gone`, VersionId: 'm1' }],
          IsTruncated: false,
        };
      }
      return {};
    },
  };
  return { client, sent };
}

const CONFIG = { provider: 's3', bucket: 'the-bucket', region: 'us-east-1', settings: { bucket: 'the-bucket' }, secrets: {} };

/** A booted app context, as far as the purge reads it. */
function appWith(config: unknown) {
  return { get: () => ({ resolveActiveConfig: async () => config }) } as never;
}

const APP_PREFIX = { id: 'exports', prefix: 'exports/', owner: 'test-app', scope: 'org' as const, description: 'fixture' };

beforeAll(() => ensureStorageSliceKeyPrefixes());

describe('runStoragePurge', () => {
  it('a dry run lists every registered prefix, app prefixes included, in registry order, and deletes nothing', async () => {
    await withTemporaryEntries(storageKeyPrefixRegistry, [APP_PREFIX], async () => {
      const { client, sent } = fakeClient();
      const outcome = await runStoragePurge(appWith(CONFIG), { createClient: () => client });

      expect(outcome.kind).toBe('report');
      if (outcome.kind !== 'report') return;
      const prefixes = allKeyPrefixes();
      expect(prefixes).toContain('exports/');
      expect(outcome.report.prefixes).toEqual(prefixes.map((prefix) => ({ prefix, objects: 1, bytes: 10 })));
      expect(outcome.report).toMatchObject({ bucket: 'the-bucket', versioning: 'unversioned', dryRun: true, deleted: 0 });
      expect(sent.filter((c) => c.name === 'ListObjectsV2').map((c) => c.input.Prefix)).toEqual(prefixes);
      expect(sent.some((c) => c.name === 'DeleteObjects')).toBe(false);
    });
  });

  it('--confirm with the live bucket deletes under exactly the registered prefixes', async () => {
    const { client, sent } = fakeClient();
    const outcome = await runStoragePurge(appWith(CONFIG), { confirm: true, bucket: 'the-bucket', createClient: () => client });

    expect(outcome).toMatchObject({ kind: 'report', report: { dryRun: false, deleted: allKeyPrefixes().length } });
    expect(sent.filter((c) => c.name === 'DeleteObjects').map((c) => c.input.Delete.Objects[0].Key)).toEqual(
      allKeyPrefixes().map((prefix) => `${prefix}object-1`),
    );
  });

  it('refuses a typed bucket that is not the live one, and lists nothing', async () => {
    const { client, sent } = fakeClient();
    const outcome = await runStoragePurge(appWith(CONFIG), { confirm: true, bucket: 'other', createClient: () => client });

    expect(outcome).toEqual({ kind: 'refused', typed: 'other', bucket: 'the-bucket' });
    expect(sent).toEqual([]);
  });

  it('an unreadable versioning status counts as versioned: versions and delete markers go by id', async () => {
    const { client, sent } = fakeClient({ versioning: 'unreadable' });
    const outcome = await runStoragePurge(appWith(CONFIG), { confirm: true, bucket: 'the-bucket', createClient: () => client });

    expect(outcome).toMatchObject({ kind: 'report', report: { versioning: 'unknown' } });
    const firstDelete = sent.find((c) => c.name === 'DeleteObjects');
    expect(firstDelete?.input.Delete.Objects).toEqual([
      { Key: `${allKeyPrefixes()[0]}object-1`, VersionId: 'v1' },
      { Key: `${allKeyPrefixes()[0]}gone`, VersionId: 'm1' },
    ]);
  });

  it('reports a deployment without storage as not configured', async () => {
    await expect(runStoragePurge(appWith(null))).resolves.toEqual({ kind: 'not-configured' });
  });
});

describe('runStoragePurgeCli', () => {
  it('prints the report for a dry run and exits 0', async () => {
    const { client } = fakeClient();
    const out: string[] = [];
    const code = await runStoragePurgeCli(appWith(CONFIG), ['node', 'x', '--json'], { stdout: (t) => out.push(t), stderr: () => undefined }, () => client);

    expect(code).toBe(0);
    expect(Object.keys(JSON.parse(out.join('')))).toEqual(['bucket', 'provider', 'endpoint', 'versioning', 'prefixes', 'totals', 'deleted', 'dryRun']);
  });

  it('exits 2 with the refusal on stderr for a mismatched --bucket', async () => {
    const err: string[] = [];
    const code = await runStoragePurgeCli(appWith(CONFIG), ['--confirm', '--bucket', 'nope'], { stdout: () => undefined, stderr: (t) => err.push(t) });

    expect(code).toBe(2);
    expect(err.join('')).toBe("Refusing: --bucket was nope but this deployment's bucket is the-bucket.\n");
  });

  it('prints configured:false when storage was never configured', async () => {
    const out: string[] = [];
    const code = await runStoragePurgeCli(appWith(null), [], { stdout: (t) => out.push(t), stderr: () => undefined });

    expect(code).toBe(0);
    expect(JSON.parse(out.join(''))).toEqual({ configured: false, reason: 'object storage is not configured for this deployment' });
  });
});

// A driver an app registered, which only knows how to list its keys (PP-14.7):
// the purge deletes each one through the provider the driver builds.
describe('runStoragePurge for a registered driver', () => {
  const deleted: string[] = [];
  const destroyed = jest.fn();

  registerStorageDriver({
    id: 'toy-list',
    label: 'Toy list',
    settingsSchema: z.object({ directory: z.string() }),
    defaults: { directory: '' },
    build: () => ({ delete: async (key: string) => void deleted.push(key), destroy: destroyed }) as never,
    testConnection: async () => ({ ok: true, message: 'ok' }),
    async *listKeys(_ctx, prefix) {
      yield `${prefix}a`;
      yield `${prefix}b`;
    },
  });
  registerStorageDriver({
    id: 'toy-opaque',
    label: 'Toy opaque',
    settingsSchema: z.object({}),
    defaults: {},
    build: () => ({}) as never,
    testConnection: async () => ({ ok: true, message: 'ok' }),
  });

  const config = (provider: string) => ({ provider, bucket: '/data', region: '', settings: { directory: '/data' }, secrets: {} });

  beforeEach(() => {
    deleted.length = 0;
    destroyed.mockClear();
  });

  it('a dry run lists every registered prefix and deletes nothing', async () => {
    const outcome = await runStoragePurge(appWith(config('toy-list')));

    expect(outcome).toMatchObject({ kind: 'report', report: { provider: 'toy-list', bucket: '/data', versioning: 'unversioned', deleted: 0, dryRun: true } });
    if (outcome.kind !== 'report') return;
    expect(outcome.report.prefixes).toEqual(allKeyPrefixes().map((prefix) => ({ prefix, objects: 2, bytes: 0 })));
    expect(deleted).toEqual([]);
  });

  it('--confirm deletes each listed key through the driver\'s provider and releases it', async () => {
    const outcome = await runStoragePurge(appWith(config('toy-list')), { confirm: true, bucket: '/data' });

    expect(outcome).toMatchObject({ kind: 'report', report: { dryRun: false, deleted: allKeyPrefixes().length * 2 } });
    expect(deleted).toEqual(allKeyPrefixes().flatMap((prefix) => [`${prefix}a`, `${prefix}b`]));
    expect(destroyed).toHaveBeenCalledTimes(1);
  });

  it('still re-checks the typed bucket against the live one', async () => {
    expect(await runStoragePurge(appWith(config('toy-list')), { confirm: true, bucket: 'elsewhere' })).toEqual({
      kind: 'refused',
      typed: 'elsewhere',
      bucket: '/data',
    });
    expect(deleted).toEqual([]);
  });

  it('reports a driver that can neither purge nor list as unsupported, and the CLI exits 3', async () => {
    expect(await runStoragePurge(appWith(config('toy-opaque')))).toEqual({ kind: 'unsupported', provider: 'toy-opaque' });

    const err: string[] = [];
    const code = await runStoragePurgeCli(appWith(config('toy-opaque')), [], { stdout: () => undefined, stderr: (t) => err.push(t) });
    expect(code).toBe(3);
    expect(err.join('')).toContain('toy-opaque');
  });
});
