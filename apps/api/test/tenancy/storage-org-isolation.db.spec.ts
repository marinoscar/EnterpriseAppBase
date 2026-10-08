// =============================================================================
// Real-Postgres test: the REAL storage service cannot cross organizations,
// even for the same user (issue #725 PP-6.5, ADR 0002 D5)
// =============================================================================
//
// `ObjectsService` authorizes by OWNERSHIP (`uploadedById`) as well as by
// organization. The sharpest cross-tenant case is therefore the one ownership
// cannot help with: ONE user who belongs to two organizations, uploads in A,
// switches to B and asks for the same object. Ownership says "yours"; only
// row-level security says "not in this organization".
//
// This suite runs the real `ObjectsService` over `PrismaService` connected as
// an ordinary role to a database that FORCEs row-level security
// (`createRlsDatabase`), so the answer is the database's, not a mock's.
// A `*.db.spec.ts` file: skipped with a warning when no Postgres is reachable.
// =============================================================================

import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';

import { NotFoundException } from '@nestjs/common';

import { ObjectProcessingService } from '@marinoscar/platform-api/storage';
import { ObjectsService } from '@marinoscar/platform-api/storage';
import type { JobsService } from '@marinoscar/platform-api/jobs';
import type { StorageConfigService } from '@marinoscar/platform-api/storage';
import { resolveDbSuite } from '../jobs/db-test-support';
import { createRlsDatabase, rlsServices, seedTwoOrgs, ORG_A, ORG_B, type RlsDatabase, type TwoOrgFixture } from '../helpers/rls-database.helper';

const { describeWithDb } = resolveDbSuite('storage-org-isolation.db.spec');

const query = { page: 1, pageSize: 50, sortBy: 'createdAt', sortOrder: 'desc' } as never;

describeWithDb('ObjectsService over row-level security (real Postgres)', () => {
  let db: RlsDatabase;
  let fx: TwoOrgFixture;
  let services: ReturnType<typeof rlsServices>;
  let objects: ObjectsService;
  const deleted: string[] = [];

  beforeAll(async () => {
    db = await createRlsDatabase('stor');
    fx = await seedTwoOrgs(db, 2);
    services = rlsServices(db);

    const storage = {
      upload: async (_key: string, stream: Readable) => {
        stream.resume();
        return { bucket: 'test-bucket' };
      },
      getSignedDownloadUrl: async (key: string) => `https://storage.test/${key}`,
      delete: async (key: string) => void deleted.push(key),
    };
    const config = { get: (_key: string, fallback?: unknown) => fallback };
    const storageConfig = { activeProvider: async () => 's3' } as unknown as StorageConfigService;
    const processing = { appliesTo: () => false } as unknown as ObjectProcessingService;

    objects = new ObjectsService(services.prisma, storage as never, storageConfig, config as never, processing, {} as JobsService);

    // The one user belongs to both organizations: give userA ownership of B's rows too.
    await db.system.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.rls_bypass', 'on', true)`;
      await tx.storageObject.updateMany({ where: { id: { in: fx.objectsB } }, data: { uploadedById: fx.userA } });
    });
  }, 120_000);

  afterAll(async () => {
    await services?.close();
    await db?.destroy();
  }, 60_000);

  it("lists only the active organization's objects for a user who owns objects in both", async () => {
    const inA = await objects.list(query, fx.userA, ORG_A);
    const inB = await objects.list(query, fx.userA, ORG_B);

    expect(inA.items.map((o) => o.id).sort()).toEqual([...fx.objectsA].sort());
    expect(inB.items.map((o) => o.id).sort()).toEqual([...fx.objectsB].sort());
    expect(inA.meta.totalItems).toBe(fx.objectsA.length);
  });

  it('answers 404 to org B for org A\'s object on every read and write path, though the user owns it', async () => {
    const target = fx.objectsA[0];

    await expect(objects.getById(target, fx.userA, ORG_B)).rejects.toBeInstanceOf(NotFoundException);
    await expect(objects.getDownloadUrl(target, fx.userA, ORG_B)).rejects.toBeInstanceOf(NotFoundException);
    await expect(objects.updateMetadata(target, { metadata: { x: 1 } } as never, fx.userA, ORG_B)).rejects.toBeInstanceOf(NotFoundException);
    await expect(objects.delete(target, fx.userA, ORG_B)).rejects.toBeInstanceOf(NotFoundException);
    await expect(objects.abortUpload(target, fx.userA, ORG_B)).rejects.toBeInstanceOf(NotFoundException);

    // Nothing happened to it: it is still there in A, and no bytes were deleted.
    expect((await objects.getById(target, fx.userA, ORG_A)).id).toBe(target);
    expect(deleted).toEqual([]);
  });

  it('uploads into the active organization only: org B never sees what org A uploaded', async () => {
    const created = await objects.simpleUpload(
      { filename: 'a.txt', mimetype: 'text/plain', file: Readable.from(['hello']) } as never,
      fx.userA,
      ORG_A,
    );

    expect((await objects.getById(created.id, fx.userA, ORG_A)).id).toBe(created.id);
    await expect(objects.getById(created.id, fx.userA, ORG_B)).rejects.toBeInstanceOf(NotFoundException);
    expect((await objects.list(query, fx.userA, ORG_B)).items.map((o) => o.id)).not.toContain(created.id);

    const row = await db.admin((client) => client.query<{ org_id: string }>('SELECT org_id FROM storage_objects WHERE id = $1', [created.id]));
    expect(row.rows[0].org_id).toBe(ORG_A);
  });

  it('a download URL is issued in the owning organization and not for a made-up id', async () => {
    const issued = await objects.getDownloadUrl(fx.objectsA[1], fx.userA, ORG_A);
    expect(issued.url).toMatch(/^https:\/\/storage\.test\//);

    await expect(objects.getById(randomUUID(), fx.userA, ORG_A)).rejects.toBeInstanceOf(NotFoundException);
  });
});
