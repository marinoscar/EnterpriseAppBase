// The Doctor kit's doubles (PP-14.26): the recording Prisma client and the write-failing storage.

import {
  ReadOnlyViolationError,
  createRecordingPrisma,
  createWriteFailingStorage,
  findIdentityProblems,
  findOutcomeProblems,
  runDoctorCheck,
} from '../../../src/doctor/testing';
import type { DoctorCheck, DoctorCheckOutcome } from '../../../src/doctor';

const check = (run: () => Promise<DoctorCheckOutcome>, extra: Partial<DoctorCheck> = {}): DoctorCheck => ({
  id: 'example.thing',
  category: 'example',
  label: 'Example',
  run,
  ...extra,
});

describe('createRecordingPrisma', () => {
  it('answers reads with benign defaults and records them without flagging a violation', async () => {
    const prisma = createRecordingPrisma();

    await expect(prisma.client.user.findMany()).resolves.toEqual([]);
    await expect(prisma.client.user.findFirst()).resolves.toBeNull();
    await expect(prisma.client.job.count()).resolves.toBe(0);
    await expect(prisma.client.$queryRaw`SELECT 1`).resolves.toEqual([]);

    expect(prisma.operations().map((operation) => operation.path)).toEqual(['user.findMany', 'user.findFirst', 'job.count', '$queryRaw']);
    expect(prisma.violations()).toEqual([]);
  });

  it('answers scripted reads, by value or by function', async () => {
    const prisma = createRecordingPrisma({ results: { 'job.count': 7, 'user.findUnique': (args: unknown) => ({ echoed: args }) } });

    await expect(prisma.client.job.count()).resolves.toBe(7);
    await expect(prisma.client.user.findUnique({ where: { id: 'u1' } })).resolves.toEqual({ echoed: { where: { id: 'u1' } } });
  });

  it.each(['create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany'])('records and rejects %s as a write', async (operation) => {
    const prisma = createRecordingPrisma();

    await expect(prisma.client.setting[operation]({})).rejects.toBeInstanceOf(ReadOnlyViolationError);

    expect(prisma.violations().map((entry) => entry.path)).toEqual([`setting.${operation}`]);
  });

  it('treats $executeRaw as a write and a raw query as a write only when its SQL is one', async () => {
    const prisma = createRecordingPrisma();

    await expect(prisma.client.$executeRaw`UPDATE jobs SET status = 'failed'`).rejects.toBeInstanceOf(ReadOnlyViolationError);
    await expect(prisma.client.$queryRaw`INSERT INTO jobs (id) VALUES (1) RETURNING id`).rejects.toBeInstanceOf(ReadOnlyViolationError);
    await expect(prisma.client.$queryRaw`WITH x AS (DELETE FROM jobs RETURNING id) SELECT * FROM x`).rejects.toBeInstanceOf(ReadOnlyViolationError);
    await expect(prisma.client.$queryRawUnsafe('TRUNCATE jobs')).rejects.toBeInstanceOf(ReadOnlyViolationError);
    await expect(prisma.client.$queryRaw`SELECT set_config('app.org_id', 'x', true)`).resolves.toEqual([]);
    await expect(prisma.client.$queryRaw`SELECT updated_at FROM jobs WHERE status = 'pending' FOR UPDATE`).resolves.toEqual([]);

    expect(prisma.violations().map((entry) => entry.path)).toEqual(['$executeRaw', '$queryRaw', '$queryRaw', '$queryRawUnsafe']);
  });

  it('sees a write inside a transaction callback, and keeps recording after forOrg and asSystem', async () => {
    const prisma = createRecordingPrisma();

    await expect(prisma.client.$transaction(async (tx: any) => tx.job.deleteMany({}))).rejects.toBeInstanceOf(ReadOnlyViolationError);
    await prisma.client.forOrg('org-1').job.findMany();
    await prisma.client.runAsSystem('doctor', async (tx: any) => tx.user.count());
    await prisma.client.asSystem().audit.create({ data: {} }).catch(() => undefined);

    expect(prisma.operations().map((entry) => entry.path)).toEqual([
      '$transaction',
      'job.deleteMany',
      'forOrg',
      'job.findMany',
      'runAsSystem',
      'user.count',
      'asSystem',
      'audit.create',
    ]);
    expect(prisma.violations().map((entry) => entry.path)).toEqual(['job.deleteMany', 'audit.create']);
  });

  it('records but allows a write while refusal is off, then rejects once it is on', async () => {
    const prisma = createRecordingPrisma({ refuseWrites: false });

    await expect(prisma.client.setting.upsert({})).resolves.toBeUndefined();
    await expect(prisma.client.$executeRaw`DELETE FROM jobs`).resolves.toBeUndefined();
    expect(prisma.violations().map((entry) => entry.path)).toEqual(['setting.upsert', '$executeRaw']);

    prisma.refuseWrites(true);
    prisma.reset();
    await expect(prisma.client.setting.upsert({})).rejects.toBeInstanceOf(ReadOnlyViolationError);
  });

  it('is not a thenable, so awaiting the client or a delegate does not hang', async () => {
    const prisma = createRecordingPrisma();

    await expect(Promise.resolve(prisma.client)).resolves.toBe(prisma.client);
    expect((prisma.client as { then?: unknown }).then).toBeUndefined();
  });

  it('has no lifecycle hooks, so Nest calls nothing on it when it is bound as a provider value', () => {
    const prisma = createRecordingPrisma();

    for (const hook of ['onModuleInit', 'onApplicationBootstrap', 'onModuleDestroy', 'onApplicationShutdown', 'beforeApplicationShutdown']) {
      expect((prisma.client as Record<string, unknown>)[hook]).toBeUndefined();
    }
  });

  it('forgets everything on reset', async () => {
    const prisma = createRecordingPrisma();
    await prisma.client.job.count();
    prisma.reset();

    expect(prisma.operations()).toEqual([]);
  });
});

describe('createWriteFailingStorage', () => {
  it('answers reads and records them as non-violations', async () => {
    const storage = createWriteFailingStorage({ bucket: 'b', existingKeys: ['k'] });

    expect(storage.provider.getBucket()).toBe('b');
    await expect(storage.provider.exists('k')).resolves.toBe(true);
    await expect(storage.provider.exists('nope')).resolves.toBe(false);
    await expect(storage.provider.getMetadata('nope')).resolves.toBeNull();
    await expect(storage.provider.getSignedDownloadUrl('k')).resolves.toContain('k');

    expect(storage.violations()).toEqual([]);
    expect(storage.operations().length).toBe(5);
  });

  it('records but allows a write while refusal is off', async () => {
    const storage = createWriteFailingStorage({ refuseWrites: false });

    await expect(storage.provider.delete('k')).resolves.toBeUndefined();
    expect(storage.violations()).toEqual([{ method: 'delete', key: 'k', write: true }]);

    storage.refuseWrites(true);
    await expect(storage.provider.delete('k')).rejects.toBeInstanceOf(ReadOnlyViolationError);
  });

  it.each(['upload', 'initMultipartUpload', 'getSignedUploadUrl', 'completeMultipartUpload', 'abortMultipartUpload', 'getSignedPutUrl', 'delete', 'setMetadata'])(
    'records and rejects %s',
    async (method) => {
      const storage = createWriteFailingStorage();

      await expect(storage.provider[method]('probe/object')).rejects.toBeInstanceOf(ReadOnlyViolationError);

      expect(storage.violations()).toEqual([{ method, key: 'probe/object', write: true }]);
    },
  );
});

describe('runDoctorCheck', () => {
  it('returns the outcome of a check that answers', async () => {
    const run = await runDoctorCheck(check(async () => ({ status: 'pass', detail: 'fine' })));

    expect(run).toMatchObject({ outcome: { status: 'pass' }, threw: false, timedOut: false, timeoutMs: 5000 });
  });

  it('reports a throw instead of absorbing it, and a rejected promise the same way', async () => {
    const thrown = await runDoctorCheck(
      check(() => {
        throw new Error('sync boom');
      }),
    );
    const rejected = await runDoctorCheck(check(async () => Promise.reject(new Error('async boom'))));

    expect(thrown).toMatchObject({ threw: true, error: 'sync boom', outcome: undefined });
    expect(rejected).toMatchObject({ threw: true, error: 'async boom' });
  });

  it("reports a hang as a timeout at the check's own ceiling", async () => {
    const run = await runDoctorCheck(check(() => new Promise<DoctorCheckOutcome>(() => undefined), { timeoutMs: 30 }));

    expect(run).toMatchObject({ timedOut: true, threw: false, timeoutMs: 30 });
  });

  it('applies the default ceiling to a check that declares none', async () => {
    const run = await runDoctorCheck(check(() => new Promise<DoctorCheckOutcome>(() => undefined)), { defaultTimeoutMs: 25 });

    expect(run).toMatchObject({ timedOut: true, timeoutMs: 25 });
  });
});

describe('findOutcomeProblems', () => {
  const grade = async (outcome: unknown, secrets?: string[]) => {
    const subject = check(async () => outcome as DoctorCheckOutcome);
    return findOutcomeProblems(subject, await runDoctorCheck(subject), { secrets });
  };

  it('accepts a valid outcome of each status', async () => {
    expect(await grade({ status: 'pass', detail: 'ok', data: { count: 1, on: true, label: 'x', none: null } })).toEqual([]);
    expect(await grade({ status: 'skip', detail: 'off' })).toEqual([]);
    expect(await grade({ status: 'fail', detail: 'down', remedy: 'Open /admin/settings/storage and check the bucket name.' })).toEqual([]);
  });

  it('names an invalid status, an empty detail, a missing or generic remedy and a non-scalar data value', async () => {
    expect(await grade({ status: 'error', detail: 'x' })).toEqual([expect.stringContaining('invalid status "error"')]);
    expect(await grade({ status: 'pass', detail: '  ' })).toEqual([expect.stringContaining('no detail')]);
    expect(await grade({ status: 'warn', detail: 'x' })).toEqual([expect.stringContaining('without a remedy')]);
    expect(await grade({ status: 'fail', detail: 'x', remedy: 'See the API logs for details.' })).toEqual([expect.stringContaining('generic fallback remedy')]);
    expect(await grade({ status: 'pass', detail: 'x', data: { nested: { a: 1 } } })).toEqual([expect.stringContaining('data.nested')]);
    expect(await grade(undefined)).toEqual([expect.stringContaining('instead of a DoctorCheckOutcome')]);
  });

  it('finds a seeded secret and a secret-shaped value anywhere in the result', async () => {
    expect(await grade({ status: 'pass', detail: 'key sk-live-123456 ok' }, ['sk-live-123456'])).toEqual([expect.stringContaining('leaked a secret')]);
    expect(await grade({ status: 'pass', detail: 'x', data: { header: 'Bearer abcdefghijklmnopqrstuvwx' } })).toEqual([expect.stringContaining('bearer token')]);
    expect(await grade({ status: 'pass', detail: '-----BEGIN PRIVATE KEY----- abc' })).toEqual([expect.stringContaining('PEM private key')]);
  });
});

describe('findIdentityProblems', () => {
  it('accepts a well-formed check and names each malformed field', () => {
    expect(findIdentityProblems(check(async () => ({ status: 'pass', detail: 'x' }), { settingsPath: '/admin/settings/x', timeoutMs: 100, dependsOn: ['db.connection'] }))).toEqual([]);
    const bad = check(async () => ({ status: 'pass', detail: 'x' }), {
      id: 'Bad Id',
      category: '',
      label: '',
      settingsPath: 'admin',
      timeoutMs: -1,
      dependsOn: ['Bad Id'],
    });

    expect(findIdentityProblems(bad).length).toBe(6);
  });
});
