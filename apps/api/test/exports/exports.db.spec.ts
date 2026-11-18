// =============================================================================
// Real-Postgres test: the export framework end to end (issue #744)
// =============================================================================
//
// Over a database that FORCEs row-level security, connected as an ordinary
// role (`createRlsDatabase`), with the REAL clients (`PrismaService` for the
// file's row and the job result, `PrismaSystemService` for the sources):
//
//   - user-data: one dataset per registered user-owned model with
//     `export: 'include'`, the caller's rows only, for every writer, and the
//     SECRET SENTINELS seeded into every credential column (a PAT's hash, an
//     AI key's ciphertext and hint, a BYOK credential, a refresh token) appear
//     in no byte of any output;
//   - the file's `storage_objects` row (owned by the requester, `metadata.source:
//     'export'`, under `exports/users/<userId>/`) and `payload.result` are
//     committed together; `GET /exports/:id` derives `ready` with a signed URL;
//   - org-data with two organizations: only the exported organization's rows,
//     although the bypass client sees both;
//   - export.purge deletes files past the retention period, and the export
//     then reads `expired`.
//
// A `*.db.spec.ts` file: skipped with a warning when no Postgres is reachable.
// =============================================================================

import type { Readable } from 'node:stream';

import { Prisma } from '@prisma/client';
import {
  ExportPurgeHandler,
  ExportRunHandler,
  ExportsService,
  resolveExportsModuleOptions,
  type ExportJobPayload,
} from '@marinoscar/platform-api/exports';
import { exportFileText } from '@marinoscar/platform-api/exports/testing';
import type { Job } from '@marinoscar/platform-api/jobs';

import '../../src/prisma/ownership';
import '../../src/platform/exports/exports.config';
import { resolveDbSuite } from '../jobs/db-test-support';
import { createRlsDatabase, rlsServices, seedTwoOrgs, ORG_A, ORG_B, type RlsDatabase, type TwoOrgFixture } from '../helpers/rls-database.helper';

const { describeWithDb } = resolveDbSuite('exports.db.spec');

const SENTINELS = {
  patHash: 'S3NT1N3L-pat-token-hash',
  aiSecret: 'S3NT1N3L-ai-key-ciphertext',
  aiHint: 'S3NT1N3L-ai-key-hint',
  credSecret: 'S3NT1N3L-user-credential-ciphertext',
  credHint: 'S3NT1N3L-user-credential-hint',
  refreshHash: 'S3NT1N3L-refresh-token-hash',
};

describeWithDb('the export framework over row-level security (real Postgres)', () => {
  let db: RlsDatabase;
  let fx: TwoOrgFixture;
  let services: ReturnType<typeof rlsServices>;
  const files = new Map<string, Buffer>();
  const options = resolveExportsModuleOptions({ datamodel: Prisma.dmmf.datamodel, appSlug: 'test-app' });

  const storage = {
    kind: 's3',
    async upload(key: string, stream: Readable) {
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(Buffer.from(chunk));
      files.set(key, Buffer.concat(chunks));
      return { key, bucket: 'test-bucket', location: key };
    },
    async delete(key: string) {
      files.delete(key);
    },
    async getSignedDownloadUrl(key: string) {
      return `https://storage.test/${key}?signed=1`;
    },
  };

  function handler(): ExportRunHandler {
    return new ExportRunHandler(
      { register: () => undefined } as never,
      options,
      services.prisma as never,
      services.system as never,
      storage as never,
      { record: async () => undefined } as never,
      { notify: async () => undefined } as never,
    );
  }

  function service(): ExportsService {
    return new ExportsService(services.prisma as never, {} as never, storage as never, services.system as never, options);
  }

  /** Creates the export.run job row and runs it, as the worker would. */
  async function run(payload: ExportJobPayload): Promise<Job> {
    const job = (await db.system.job.create({
      data: {
        type: 'export.run',
        reason: 'rerun',
        status: 'running',
        subjectType: payload.scope === 'user' ? 'user' : 'organization',
        subjectId: payload.subjectId,
        payload: payload as never,
        attempts: 1,
        orgId: payload.orgId,
      },
    })) as unknown as Job;
    await handler().process(job);
    await db.system.job.update({ where: { id: job.id }, data: { status: 'succeeded', finishedAt: new Date() } });
    return job;
  }

  beforeAll(async () => {
    db = await createRlsDatabase('exp');
    fx = await seedTwoOrgs(db, 2);
    services = rlsServices(db);

    await db.system.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.rls_bypass', 'on', true)`;
      const role = await tx.role.upsert({ where: { name: 'org_admin' }, create: { name: 'org_admin', scope: 'org' }, update: {} });
      await tx.membership.create({ data: { orgId: ORG_A, userId: fx.userA, roleId: role.id } });
      await tx.membership.create({ data: { orgId: ORG_B, userId: fx.userB, roleId: role.id } });
      await tx.userSettings.create({ data: { userId: fx.userA, value: { theme: 'dark' } } });
      await tx.notification.create({ data: { userId: fx.userA, eventKey: 'user.welcome', title: 'Welcome', body: '=HYPERLINK("x")' } });
      await tx.personalAccessToken.create({
        data: {
          userId: fx.userA,
          name: 'cli',
          tokenHash: SENTINELS.patHash,
          tokenPrefix: 'pat_abcd',
          durationValue: 30,
          durationUnit: 'days',
          expiresAt: new Date(Date.now() + 86_400_000),
        },
      });
      await tx.userAiKey.create({ data: { userId: fx.userA, provider: 'openai', secret: SENTINELS.aiSecret, hint: SENTINELS.aiHint } });
      await tx.userCredential.create({
        data: { userId: fx.userA, purpose: 'example', name: 'default', secret: SENTINELS.credSecret, hint: SENTINELS.credHint },
      });
      await tx.refreshToken.create({ data: { userId: fx.userA, tokenHash: SENTINELS.refreshHash, expiresAt: new Date(Date.now() + 86_400_000) } });
      // Another user's notification must never appear in A's export.
      await tx.notification.create({ data: { userId: fx.userB, eventKey: 'user.welcome', title: 'Not yours', body: 'S3NT1N3L-other-user' } });
    });
  }, 180_000);

  afterAll(async () => {
    await services?.close();
    await db?.destroy();
  }, 60_000);

  const userPayload = (format: string): ExportJobPayload => ({
    source: 'user-data',
    format,
    request: {},
    requestedById: fx.userA,
    scope: 'user',
    subjectId: fx.userA,
    orgId: ORG_A,
  });

  it.each(['json', 'csv', 'xlsx'])('user-data/%s: one dataset per included model, the caller only, no secret byte', async (format) => {
    const job = await run(userPayload(format));
    const ext = format === 'csv' ? 'zip' : format;
    const key = `exports/users/${fx.userA}/${job.id}.${ext}`;
    const text = exportFileText(files.get(key)!);

    for (const sentinel of Object.values(SENTINELS)) expect(text).not.toContain(sentinel);
    expect(text).not.toContain('S3NT1N3L-other-user');
    expect(text).toContain('pat_abcd'); // the PAT's metadata is there
    expect(text).toContain('a@example.test'); // the account dataset
    if (format === 'csv') expect(text).toContain(`'=HYPERLINK`);

    const stored = await db.system.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.rls_bypass', 'on', true)`;
      return tx.storageObject.findUnique({ where: { storageKey: key } });
    });
    expect(stored).toMatchObject({ uploadedById: fx.userA, orgId: ORG_A, status: 'ready', metadata: { source: 'export', exportId: job.id } });

    const row = await db.system.job.findUnique({ where: { id: job.id } });
    const result = (row!.payload as { result: { rowCounts: Record<string, number>; storageObjectId: string } }).result;
    expect(result.storageObjectId).toBe(stored!.id);
    expect(Object.keys(result.rowCounts)).toEqual(
      expect.arrayContaining(['account', 'user_role', 'user_settings', 'personal_access_token', 'membership', 'notification', 'user_ai_key', 'storage_object', 'user_credential']),
    );
    expect(result.rowCounts).not.toHaveProperty('refresh_token');
    expect(result.rowCounts.notification).toBe(1);
    expect(result.rowCounts.storage_object).toBeGreaterThanOrEqual(2);

    const view = await service().get({ id: fx.userA, permissions: ['user_settings:read'], activeOrgId: ORG_A }, job.id);
    expect(view.status).toBe('ready');
    expect(view.download?.url).toBe(`https://storage.test/${key}?signed=1`);
  }, 120_000);

  it("org-data: only the exported organization's rows and members, though the bypass client sees both", async () => {
    const job = await run({ source: 'org-data', format: 'json', request: {}, requestedById: fx.userA, scope: 'org', subjectId: ORG_A, orgId: ORG_A });
    const file = JSON.parse(files.get(`exports/orgs/${ORG_A}/${job.id}.json`)!.toString('utf8'));

    expect(file.datasets.organization.rows.map((r: { id: string }) => r.id)).toEqual([ORG_A]);
    expect(file.datasets.members.rows.map((r: { email: string }) => r.email)).toEqual(['a@example.test']);
    const objectIds = file.datasets.storage_object.rows.map((r: { id: string; orgId: string }) => r.id);
    for (const id of fx.objectsA) expect(objectIds).toContain(id);
    for (const id of fx.objectsB) expect(objectIds).not.toContain(id);
    for (const row of file.datasets.storage_object.rows) expect(row.orgId).toBe(ORG_A);
    expect(file.datasets.ai_run.rows.map((r: { id: string }) => r.id).sort()).toEqual([...fx.runsA].sort());
    expect(JSON.stringify(file)).not.toContain(ORG_B);
  }, 120_000);

  it('export.purge deletes files past the retention period; the export then reads expired', async () => {
    const job = await run(userPayload('json'));
    const key = `exports/users/${fx.userA}/${job.id}.json`;
    await db.system.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.rls_bypass', 'on', true)`;
      await tx.storageObject.update({ where: { storageKey: key }, data: { createdAt: new Date(Date.now() - 8 * 86_400_000) } });
    });

    const purge = new ExportPurgeHandler({ register: () => undefined } as never, options, services.system as never, storage as never);
    const { deleted, failed } = await purge.purge();
    expect(failed).toBe(0);
    expect(deleted).toBeGreaterThanOrEqual(1);
    expect(files.has(key)).toBe(false);

    const view = await service().get({ id: fx.userA, permissions: ['user_settings:read'], activeOrgId: ORG_A }, job.id);
    expect(view.status).toBe('expired');
    expect(view.download).toBeNull();
    // The uploads were not touched.
    const uploads = await db.system.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.rls_bypass', 'on', true)`;
      return tx.storageObject.count({ where: { id: { in: [...fx.objectsA, ...fx.objectsB] } } });
    });
    expect(uploads).toBe(fx.objectsA.length + fx.objectsB.length);
  }, 120_000);

  it("another user's export is not visible to them", async () => {
    const job = await run(userPayload('json'));
    await expect(
      service().get({ id: fx.userB, permissions: ['user_settings:read'], activeOrgId: ORG_B }, job.id),
    ).rejects.toThrow('Export not found');
  }, 120_000);
});
