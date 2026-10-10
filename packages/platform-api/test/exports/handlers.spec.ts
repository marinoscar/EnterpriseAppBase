import { Readable } from 'node:stream';

import { exportJsonFileSchema } from '@marinoscar/platform-contract/exports';

import { registerUserOwnedModels } from '../../src/core';
import {
  BUILTIN_EXPORT_WRITERS,
  EXPORTS_KEY_PREFIXES,
  ExportPurgeHandler,
  ExportRunHandler,
  USER_DATA_EXPORT_SOURCE,
  registerExportSource,
  registerExportWriter,
  resolveExportsModuleOptions,
  type ExportJobPayload,
} from '../../src/exports';
import type { Job } from '../../src/jobs';
import { registerStorageKeyPrefixes } from '../../src/storage';
import { FIXTURE_DATAMODEL, UUID, fakeDb } from './support';

for (const writer of BUILTIN_EXPORT_WRITERS) registerExportWriter(writer);
registerExportSource(USER_DATA_EXPORT_SOURCE);
registerStorageKeyPrefixes(EXPORTS_KEY_PREFIXES);
registerUserOwnedModels([{ model: 'ApiToken', ownerField: 'userId', purge: 'delete', export: 'include', rationale: 'tokens' }]);

const NOW = new Date('2026-10-08T10:00:00.000Z');

/** A fake object store that consumes uploads fully. */
function fakeStorage(fail?: Error) {
  const objects = new Map<string, Buffer>();
  return {
    kind: 's3',
    objects,
    deleted: [] as string[],
    async upload(key: string, stream: Readable) {
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(Buffer.from(chunk));
        if (fail) throw fail;
      }
      objects.set(key, Buffer.concat(chunks));
      return { key, bucket: 'bucket', location: `s3://bucket/${key}` };
    },
    async delete(key: string) {
      this.deleted.push(key);
      objects.delete(key);
    },
  };
}

function payload(over: Partial<ExportJobPayload> = {}): ExportJobPayload {
  return {
    source: 'user-data',
    format: 'json',
    request: {},
    requestedById: UUID.user,
    scope: 'user',
    subjectId: UUID.user,
    orgId: UUID.orgA,
    ...over,
  };
}

function setup(storage = fakeStorage(), options: Parameters<typeof resolveExportsModuleOptions>[0] = { datamodel: FIXTURE_DATAMODEL }) {
  const writes: Array<Record<string, any>> = [];
  const tx = {
    storageObject: { upsert: jest.fn(async (args: Record<string, any>) => (writes.push({ upsert: args }), { id: UUID.object })) },
    job: { update: jest.fn(async (args: Record<string, any>) => (writes.push({ jobUpdate: args }), {})) },
  };
  const prisma = { runInOrg: jest.fn(async (orgId: string, fn: (tx: unknown) => Promise<unknown>) => (writes.push({ orgId }), fn(tx))) };
  const db = fakeDb({
    user: [{ id: UUID.user, email: 'me@example.test', createdAt: NOW }],
    apiToken: [{ id: 't1', userId: UUID.user, name: 'cli', tokenHash: 'HASH', hint: 'HINT', lastUsedAt: null }],
  });
  const audit = { record: jest.fn(async () => undefined) };
  const notifier = { notify: jest.fn(async () => undefined) };
  const metrics = { add: jest.fn(), record: jest.fn() };
  const registry = { register: jest.fn() };
  const resolved = resolveExportsModuleOptions(options);
  const handler = new ExportRunHandler(
    registry as never,
    resolved,
    prisma as never,
    { asSystem: () => db } as never,
    storage as never,
    audit as never,
    notifier as never,
    metrics as never,
  );
  handler.now = () => NOW;
  return { handler, storage, writes, audit, notifier, metrics, registry, tx };
}

const job = (p: ExportJobPayload, attempts = 1): Job =>
  ({ id: UUID.job, type: 'export.run', subjectType: 'user', subjectId: p.subjectId, payload: p, attempts }) as unknown as Job;

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('export.run', () => {
  it('streams the file under exports/users/<userId>/, commits the row and the result in one org transaction, then audits and notifies', async () => {
    const { handler, storage, writes, audit, notifier, metrics } = setup();
    await handler.process(job(payload()));
    await flush();

    const key = `exports/users/${UUID.user}/${UUID.job}.json`;
    const file = exportJsonFileSchema.parse(JSON.parse(storage.objects.get(key)!.toString('utf8')));
    expect(Object.keys(file.datasets)).toEqual(['account', 'api_token']);
    expect(storage.objects.get(key)!.toString('utf8')).not.toMatch(/HASH|HINT/);

    expect(writes[0]).toEqual({ orgId: UUID.orgA });
    const upsert = writes[1]!.upsert;
    expect(upsert.where).toEqual({ storageKey: key });
    expect(upsert.create).toMatchObject({
      name: 'app-user-data-2026-10-08.json',
      mimeType: 'application/json',
      status: 'ready',
      uploadedById: UUID.user,
      orgId: UUID.orgA,
      bucket: 'bucket',
      storageProvider: 's3',
      metadata: { source: 'export', exportId: UUID.job, exportSource: 'user-data', format: 'json' },
    });
    const result = writes[2]!.jobUpdate.data.payload.result;
    expect(result).toMatchObject({
      storageObjectId: UUID.object,
      fileName: 'app-user-data-2026-10-08.json',
      rowCounts: { account: 1, api_token: 1 },
      completedAt: NOW.toISOString(),
      expiresAt: '2026-10-15T10:00:00.000Z',
    });
    expect(result.sizeBytes).toBe(storage.objects.get(key)!.length);

    expect(audit.record).toHaveBeenCalledWith({
      action: 'export:create',
      actorUserId: UUID.user,
      targetType: 'export',
      targetId: UUID.job,
      meta: expect.objectContaining({ source: 'user-data', format: 'json', rows: 2, datasets: 2, rowCounts: '{"account":1,"api_token":1}' }),
    });
    const meta = JSON.stringify((audit.record.mock.calls[0] as unknown[])[0]);
    expect(meta).not.toMatch(/app-user-data|https?:|me@example/);
    expect(notifier.notify).toHaveBeenCalledWith('export.ready', UUID.user, {
      exportId: UUID.job,
      source: 'user-data',
      sourceLabel: 'Your data',
      format: 'json',
    });
    expect(metrics.add).toHaveBeenCalledWith('exportsRuns', 1, { source: 'user-data', format: 'json', outcome: 'completed' });
  });

  it('an org export goes under exports/orgs/<orgId>/', async () => {
    registerExportSource({ ...USER_DATA_EXPORT_SOURCE, id: 'org-copy', scope: 'org', crossOrgPermission: undefined });
    const { handler, storage } = setup();
    await handler.process({ ...job(payload({ source: 'org-copy', scope: 'org', subjectId: UUID.orgB, orgId: UUID.orgB })), subjectType: 'organization' });
    expect([...storage.objects.keys()]).toEqual([`exports/orgs/${UUID.orgB}/${UUID.job}.json`]);
  });

  it('a failure deletes the partial object and rethrows; only the last attempt notifies export.failed', async () => {
    const failing = fakeStorage(new Error('bucket unreachable'));
    const first = setup(failing);
    await expect(first.handler.process(job(payload({ format: 'csv' }), 1))).rejects.toThrow('bucket unreachable');
    await flush();
    expect(failing.deleted).toEqual([`exports/users/${UUID.user}/${UUID.job}.zip`]);
    expect(first.notifier.notify).not.toHaveBeenCalled();
    expect(first.audit.record).not.toHaveBeenCalled();
    expect(first.metrics.add).toHaveBeenCalledWith('exportsRuns', 1, { source: 'user-data', format: 'csv', outcome: 'failed' });

    const last = setup(fakeStorage(new Error('bucket unreachable')));
    await expect(last.handler.process(job(payload({ format: 'csv' }), 2))).rejects.toThrow('bucket unreachable');
    await flush();
    expect(last.notifier.notify).toHaveBeenCalledWith('export.failed', UUID.user, expect.objectContaining({ exportId: UUID.job }));
  });

  it('is idempotent: a payload with a result does nothing; a mismatched subject is refused', async () => {
    const { handler, storage } = setup();
    await handler.process(job(payload({ result: { storageObjectId: 'x', fileName: 'a.json', mimeType: 'application/json', sizeBytes: 1, rowCounts: {}, completedAt: 'x', expiresAt: 'x' } })));
    expect(storage.objects.size).toBe(0);
    await expect(handler.process({ ...job(payload()), subjectId: UUID.other })).rejects.toThrow(/does not match/);
  });

  it('a source that throws before yielding fails the job and ends the upload', async () => {
    registerExportSource({
      ...USER_DATA_EXPORT_SOURCE,
      id: 'throws-early',
      collect: () => {
        throw new Error('source misconfigured');
      },
    });
    const { handler, storage } = setup();
    await expect(handler.process(job(payload({ source: 'throws-early' })))).rejects.toThrow('source misconfigured');
    expect(storage.objects.size).toBe(0);
    expect(storage.deleted).toEqual([`exports/users/${UUID.user}/${UUID.job}.json`]);
  });

  it('re-validates the request at job start', async () => {
    const { handler } = setup();
    await expect(handler.process(job(payload({ request: { injected: true } })))).rejects.toThrow();
  });

  it('registers legacy run aliases that map their payload', async () => {
    const { handler, registry, storage } = setup(fakeStorage(), {
      datamodel: FIXTURE_DATAMODEL,
      legacyJobTypes: [{ type: 'health.export', handles: 'run', toPayload: (p) => ({ ...(p as object), source: 'user-data' }) }],
    });
    handler.onModuleInit();
    expect(registry.register).toHaveBeenCalledTimes(2);
    const alias = registry.register.mock.calls[1]![0];
    expect(alias).toMatchObject({ type: 'health.export', label: 'Data export', profile: { maxAttempts: 2 } });
    expect(alias.nodeResultSchema).toBeUndefined();
    await alias.process(job({ ...payload(), source: 'legacy' }));
    expect(storage.objects.size).toBe(1);
  });

  it('is server-only', () => {
    const { handler } = setup();
    expect((handler as unknown as Record<string, unknown>).nodeResultSchema).toBeUndefined();
    expect((handler as unknown as Record<string, unknown>).persistNodeResult).toBeUndefined();
  });
});

describe('export.purge', () => {
  function purgeSetup(failKey?: string) {
    const objects = [
      { id: 'o1', storageKey: `exports/users/${UUID.user}/a.json`, createdAt: new Date('2026-09-01T00:00:00.000Z') },
      { id: 'o2', storageKey: `exports/orgs/${UUID.orgA}/b.zip`, createdAt: new Date('2026-09-02T00:00:00.000Z') },
      { id: 'o3', storageKey: `exports/users/${UUID.user}/fresh.json`, createdAt: new Date('2026-10-07T00:00:00.000Z') },
      { id: 'o4', storageKey: 'uploads/x/old.pdf', createdAt: new Date('2026-01-01T00:00:00.000Z') },
    ];
    const db = fakeDb({ storageObject: objects });
    const deleted: string[] = [];
    const storage = {
      delete: jest.fn(async (key: string) => {
        if (key === failKey) throw new Error('provider error');
        deleted.push(key);
      }),
    };
    const reasons: string[] = [];
    const handler = new ExportPurgeHandler(
      { register: jest.fn() } as never,
      resolveExportsModuleOptions({ datamodel: FIXTURE_DATAMODEL }),
      { asSystem: (reason: string) => (reasons.push(reason), db) } as never,
      storage as never,
    );
    handler.now = () => NOW;
    return { handler, objects, deleted, reasons };
  }

  it('deletes export files older than the retention period, bytes then row, and nothing else', async () => {
    const { handler, objects, deleted, reasons } = purgeSetup();
    expect(await handler.purge()).toEqual({ deleted: 2, failed: 0 });
    expect(deleted).toEqual([`exports/users/${UUID.user}/a.json`, `exports/orgs/${UUID.orgA}/b.zip`]);
    expect(objects.map((o) => o.id)).toEqual(['o3', 'o4']);
    expect(reasons).toEqual(['purge']);
  });

  it('keeps the row of a provider failure, finishes the rest, then fails the run', async () => {
    const { handler, objects } = purgeSetup(`exports/users/${UUID.user}/a.json`);
    await expect(handler.process({ id: UUID.job } as never)).rejects.toThrow(/1 expired export file/);
    expect(objects.map((o) => o.id)).toEqual(['o1', 'o3', 'o4']);
  });

  it('is server-only', () => {
    const { handler } = purgeSetup();
    expect((handler as unknown as Record<string, unknown>).nodeResultSchema).toBeUndefined();
    expect((handler as unknown as Record<string, unknown>).persistNodeResult).toBeUndefined();
  });
});
