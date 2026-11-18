// =============================================================================
// Real-Postgres test: copy-only storage provider migration (issue #1093)
// =============================================================================
//
// A mocked client cannot prove the two things the feature rests on:
//
//   1. `storage_migration_runs_active_uniq_idx` allows exactly one pending or
//      running run, so a concurrent second start loses (409) whatever process
//      it runs in;
//   2. the repoint: the real service, planner and object handler over the
//      application's own two pools (`PrismaService` under row-level security
//      through `JobScope`, `PrismaSystemService` for the deployment-wide run),
//      copying two organizations' objects between two in-memory providers,
//      verifying, repointing the rows and leaving the source bytes in place.
//
// THIS IS A `*.db.spec.ts` FILE — skipped with a warning when no Postgres is
// reachable; see `test/jobs/db-test-support.ts`.
// =============================================================================

import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';

import { JobHandlerRegistry, JobScope, type Job } from '@marinoscar/platform-api/jobs';
import {
  StorageMigrateObjectHandler,
  StorageMigratePlanHandler,
  StorageMigrationService,
  type StorageProvider,
} from '@marinoscar/platform-api/storage';
import { BUILTIN_STORAGE_DRIVERS } from '@marinoscar/platform-api/storage';

import { resolveDbSuite } from '../jobs/db-test-support';
import { createRlsDatabase, rlsServices, seedTwoOrgs, ORG_A, ORG_B, type RlsDatabase, type TwoOrgFixture } from '../helpers/rls-database.helper';

const { describeWithDb } = resolveDbSuite('storage-migration.db.spec');

// The built-in drivers (s3, r2, s3compatible) must be registered for the
// service's driver check; importing the constant is enough.
void BUILTIN_STORAGE_DRIVERS;

/** A Map-backed provider that consumes and produces streams. */
function memoryProvider(bucket: string, store: Map<string, Buffer>): StorageProvider {
  return {
    kind: bucket,
    getBucket: () => bucket,
    async download(key: string) {
      const bytes = store.get(key);
      if (!bytes) throw new Error(`${bucket}: no such key ${key}`);
      return Readable.from([bytes]);
    },
    async upload(key: string, stream: Readable) {
      const parts: Buffer[] = [];
      for await (const chunk of stream) parts.push(chunk as Buffer);
      store.set(key, Buffer.concat(parts));
      return { key, bucket, location: key };
    },
  } as unknown as StorageProvider;
}

describeWithDb('copy-only storage provider migration (real Postgres)', () => {
  let db: RlsDatabase;
  let fx: TwoOrgFixture;
  let services: ReturnType<typeof rlsServices>;

  const admin = <T>(sql: string, params: unknown[] = []) =>
    db.admin(async (client) => (await client.query(sql, params)).rows as T[]);

  beforeAll(async () => {
    db = await createRlsDatabase('smig');
    fx = await seedTwoOrgs(db, 2);
    services = rlsServices(db);
  }, 120_000);

  afterAll(async () => {
    await services?.close();
    await db?.destroy();
  }, 60_000);

  afterEach(async () => {
    await admin('DELETE FROM storage_migration_runs');
  });

  describe('storage_migration_runs_active_uniq_idx', () => {
    const insert = (status: string) =>
      admin(
        `INSERT INTO storage_migration_runs (id, source_provider, target_provider, status, updated_at)
         VALUES ($1, 's3', 'r2', $2::"StorageMigrationRunStatus", now())`,
        [randomUUID(), status],
      );

    it('allows one pending or running run and refuses a second', async () => {
      await insert('pending');
      await expect(insert('pending')).rejects.toThrow(/storage_migration_runs_active_uniq_idx/);
      await expect(insert('running')).rejects.toThrow(/storage_migration_runs_active_uniq_idx/);
    });

    it('allows any number of finished runs beside the active one', async () => {
      await insert('completed');
      await insert('failed');
      await insert('cancelled');
      await insert('running');
      await expect(insert('pending')).rejects.toThrow(/storage_migration_runs_active_uniq_idx/);
    });

    it('turns the violation into a 409 with details.activeRunId through the real service', async () => {
      const service = new StorageMigrationService(
        services.system as never,
        services.prisma as never,
        { resolveDriver: async (id: string) => ({ configured: true, config: { provider: id, bucket: id, region: '', settings: {}, secrets: {} } }) } as never,
        { enqueue: async () => ({ id: randomUUID() }) } as never,
      );
      const first = await service.start({ sourceProvider: 's3', targetProvider: 'r2' }, fx.userA);
      const second = await service.start({ sourceProvider: 's3', targetProvider: 'r2' }, fx.userA).catch((e: unknown) => e);

      expect((second as { getStatus(): number }).getStatus()).toBe(409);
      expect((second as { getResponse(): unknown }).getResponse()).toMatchObject({ details: { activeRunId: first.id } });
    });
  });

  describe('the repoint', () => {
    it('copies every ready object on the source, verifies it, repoints its row, leaves the source, and completes the run', async () => {
      // Bytes for every seeded object, on the "s3" side only.
      const objects = await admin<{ id: string; storage_key: string; size: string; org_id: string }>(
        'SELECT id, storage_key, size::text, org_id FROM storage_objects ORDER BY id',
      );
      const sourceStore = new Map<string, Buffer>();
      for (const o of objects) sourceStore.set(o.storage_key, Buffer.alloc(Number(o.size), o.id.slice(0, 1)));
      const targetStore = new Map<string, Buffer>();
      const source = memoryProvider('old-bucket', sourceStore);
      const target = memoryProvider('new-bucket', targetStore);

      const queued: Job[] = [];
      const jobs = {
        enqueue: async (input: Record<string, unknown>) => {
          const row = { id: randomUUID(), ...input } as unknown as Job;
          queued.push(row);
          return row;
        },
      };
      const storageConfig = {
        resolveDriver: async (id: string) => ({
          configured: true,
          config: { provider: id, bucket: id === 's3' ? 'old-bucket' : 'new-bucket', region: '', settings: {}, secrets: {} },
        }),
      };
      const router = { forObject: async () => source, forLocation: async () => target };

      const service = new StorageMigrationService(services.system as never, services.prisma as never, storageConfig as never, jobs as never);
      const plan = new StorageMigratePlanHandler(new JobHandlerRegistry(), service, jobs as never);
      const copy = new StorageMigrateObjectHandler(
        new JobHandlerRegistry(),
        service,
        new JobScope(services.prisma as never),
        router as never,
        storageConfig as never,
      );

      const run = await service.start({ sourceProvider: 's3', targetProvider: 'r2' }, fx.userA);
      await plan.process(queued.shift()!);

      expect(queued).toHaveLength(objects.length);
      // Each object job carries its object's organization.
      expect(new Set(queued.map((j) => j.orgId))).toEqual(new Set([ORG_A, ORG_B]));

      for (const job of queued) await copy.process(job);

      const rows = await admin<{ storage_provider: string; bucket: string }>('SELECT storage_provider, bucket FROM storage_objects');
      expect(rows.every((r) => r.storage_provider === 'r2' && r.bucket === 'new-bucket')).toBe(true);
      for (const o of objects) {
        expect(targetStore.get(o.storage_key)).toEqual(sourceStore.get(o.storage_key));
        // The source is left in place, untouched.
        expect(sourceStore.has(o.storage_key)).toBe(true);
      }

      const items = await admin<{ status: string; checksum_sha256: string | null; org_id: string }>(
        'SELECT status, checksum_sha256, org_id FROM storage_migration_items',
      );
      expect(items.every((i) => i.status === 'migrated' && /^[0-9a-f]{64}$/.test(i.checksum_sha256 ?? ''))).toBe(true);

      const done = await service.get(run.id);
      expect(done).toMatchObject({ status: 'completed', totalCount: objects.length, migratedCount: objects.length, pendingCount: 0 });

      // Row-level security: org A's scope sees only org A's items, and no run.
      const visible = await services.prisma.runInOrg(ORG_A, async (tx) => ({
        items: await tx.storageMigrationItem.findMany({ select: { orgId: true } }),
        runs: await tx.storageMigrationRun.count(),
      }));
      expect(visible.items.length).toBe(fx.objectsA.length);
      expect(visible.items.every((i) => i.orgId === ORG_A)).toBe(true);
      expect(visible.runs).toBe(0);

      // A re-run skips everything: nothing is on the source any more.
      queued.length = 0;
      const rerun = await service.start({ sourceProvider: 's3', targetProvider: 'r2' }, fx.userA);
      await plan.process(queued.shift()!);
      expect(queued).toHaveLength(0);
      await expect(service.get(rerun.id)).resolves.toMatchObject({ status: 'completed', totalCount: 0 });

      // Put the rows back for any later case.
      await admin(`UPDATE storage_objects SET storage_provider = 's3', bucket = NULL`);
    });

    it('a cancelled run stops before its next unclaimed object', async () => {
      const store = new Map<string, Buffer>();
      const objects = await admin<{ storage_key: string; size: string }>('SELECT storage_key, size::text FROM storage_objects');
      for (const o of objects) store.set(o.storage_key, Buffer.alloc(Number(o.size)));
      const queued: Job[] = [];
      const jobs = { enqueue: async (input: Record<string, unknown>) => { const j = { id: randomUUID(), ...input } as unknown as Job; queued.push(j); return j; } };
      const storageConfig = { resolveDriver: async (id: string) => ({ configured: true, config: { provider: id, bucket: id, region: '', settings: {}, secrets: {} } }) };
      const target = memoryProvider('new-bucket', new Map());
      const router = { forObject: async () => memoryProvider('old', store), forLocation: async () => target };
      const service = new StorageMigrationService(services.system as never, services.prisma as never, storageConfig as never, jobs as never);
      const plan = new StorageMigratePlanHandler(new JobHandlerRegistry(), service, jobs as never);
      const copy = new StorageMigrateObjectHandler(new JobHandlerRegistry(), service, new JobScope(services.prisma as never), router as never, storageConfig as never);

      const run = await service.start({ sourceProvider: 's3', targetProvider: 'r2' }, fx.userA);
      await plan.process(queued.shift()!);
      await copy.process(queued.shift()!);
      await service.cancel(run.id, fx.userA);
      for (const job of queued) await copy.process(job);

      const after = await service.get(run.id);
      expect(after).toMatchObject({ status: 'cancelled', migratedCount: 1, skippedCount: objects.length - 1, pendingCount: 0 });
      const moved = await admin<{ n: string }>(`SELECT count(*)::text AS n FROM storage_objects WHERE storage_provider = 'r2'`);
      expect(Number(moved[0]!.n)).toBe(1);
      await admin(`UPDATE storage_objects SET storage_provider = 's3', bucket = NULL`);
    });
  });
});
