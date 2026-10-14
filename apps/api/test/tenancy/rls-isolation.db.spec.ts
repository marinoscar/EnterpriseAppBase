// =============================================================================
// Real-Postgres test: the database enforces organization isolation
// (issue #725 PP-6.5, ADR 0002 D5)
// =============================================================================
//
// The acceptance test of the story. Every claim here is about a SERVER and an
// ORDINARY ROLE, which the mocked tier cannot make:
//
//   - `forOrg(A)` never reads, updates or deletes organization B's
//     `storage_objects`, `storage_object_chunks`, `ai_runs` or
//     `ai_usage_events`, through the model API OR raw SQL on the application
//     connection;
//   - an insert naming organization B under `forOrg(A)` fails (`WITH CHECK`),
//     and so does moving a row to B;
//   - an UNSCOPED client of the same role sees nothing and cannot insert: the
//     tables FAIL CLOSED, including on a connection that has held a scope
//     before (current_setting is '' there, not NULL);
//   - the system client sees both organizations, and is the only one that sees
//     an organization-less usage event;
//   - two concurrent scoped transactions for A and B on one small pool never
//     cross, and nothing leaks out of a transaction (the settings are
//     transaction-local);
//   - the composite foreign key refuses a chunk that names another
//     organization's object.
//
// The database is a THROWAWAY one owned by an ordinary role created here (a
// superuser ignores every policy), migrated with the real `prisma migrate
// deploy` as that role. See `../helpers/rls-database.helper.ts`.
//
// THIS IS A `*.db.spec.ts` FILE, skipped with a warning when no Postgres is
// reachable; the connecting credentials must be able to CREATE ROLE and
// CREATE DATABASE (the compose test database's superuser).
// =============================================================================

import { ScopedAccessError, orgScopeExtension, runInOrg } from '@marinoscar/platform-api/core';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaService } from '../../src/prisma/prisma.service';
import { PrismaSystemService } from '../../src/prisma/prisma-system.service';
import { resolveDbSuite } from '../jobs/db-test-support';
import { ORG_A, ORG_B, createRlsDatabase, seedTwoOrgs, type RlsDatabase, type TwoOrgFixture } from '../helpers/rls-database.helper';

const { describeWithDb } = resolveDbSuite('rls-isolation.db.spec');

jest.setTimeout(180_000);

const PER_ORG = 3;

describeWithDb('row-level security isolates organizations (real Postgres, ordinary role)', () => {
  let db: RlsDatabase;
  let f: TwoOrgFixture;
  /** The REAL app classes, built on the scratch database as the ordinary role. */
  let prisma: PrismaService;
  let system: PrismaSystemService;

  beforeAll(async () => {
    db = await createRlsDatabase('iso', { pool: 4 });
    f = await seedTwoOrgs(db, PER_ORG);

    // `PrismaService` and `PrismaSystemService` read `POSTGRES_*` when they are
    // constructed; point them at the scratch database for exactly that long.
    const saved = { ...process.env };
    try {
      delete process.env.DATABASE_URL;
      Object.assign(process.env, db.env);
      prisma = new PrismaService();
      system = new PrismaSystemService();
      await prisma.$connect();
      await system.$connect();
    } finally {
      process.env = saved;
    }
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await system?.$disconnect();
    await db?.destroy();
  });

  it('runs as an ordinary role that owns the tables, with row-level security forced', async () => {
    const [row] = await db.tenant.$queryRaw<Array<{ rolsuper: boolean; rolbypassrls: boolean }>>`
      SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
    expect(row).toEqual({ rolsuper: false, rolbypassrls: false });

    const forced = await db.tenant.$queryRaw<Array<{ relname: string; owner: string }>>`
      SELECT c.relname, pg_get_userbyid(c.relowner) AS owner FROM pg_class c
      WHERE c.relname IN ('storage_objects', 'storage_object_chunks', 'ai_runs', 'ai_usage_events') AND c.relforcerowsecurity
      ORDER BY c.relname`;
    expect(forced.map((r) => r.relname)).toEqual(['ai_runs', 'ai_usage_events', 'storage_object_chunks', 'storage_objects']);
    expect(new Set(forced.map((r) => r.owner))).toEqual(new Set([db.role]));
  });

  describe('forOrg(A) sees only organization A', () => {
    it('lists only its own rows in all four tables', async () => {
      const a = prisma.forOrg(ORG_A);

      expect((await a.storageObject.findMany()).map((o) => o.id).sort()).toEqual([...f.objectsA].sort());
      expect(await a.storageObjectChunk.count()).toBe(2);
      expect((await a.aiRun.findMany()).map((r) => r.id).sort()).toEqual([...f.runsA].sort());
      expect((await a.aiUsageEvent.findMany()).map((r) => r.id).sort()).toEqual([...f.usageA].sort());

      const b = prisma.forOrg(ORG_B);
      expect((await b.storageObject.findMany()).map((o) => o.id).sort()).toEqual([...f.objectsB].sort());
    });

    it("cannot read B's row by id, by relation or by raw SQL", async () => {
      const a = prisma.forOrg(ORG_A);
      const target = f.objectsB[0]!;

      expect(await a.storageObject.findUnique({ where: { id: target } })).toBeNull();
      expect(await a.storageObject.findFirst({ where: { id: target } })).toBeNull();
      expect(await a.aiRun.findUnique({ where: { id: f.runsB[0]! } })).toBeNull();
      expect(await a.aiUsageEvent.findUnique({ where: { id: f.usageB[0]! } })).toBeNull();
      expect(await a.$queryRaw`SELECT id FROM storage_objects WHERE id = ${target}::uuid`).toEqual([]);
      expect(await a.$queryRawUnsafe(`SELECT id FROM ai_runs WHERE id = '${f.runsB[0]}'`)).toEqual([]);

      const count = await a.$queryRaw<Array<{ n: number }>>`SELECT count(*)::int AS n FROM storage_objects`;
      expect(count[0]!.n).toBe(PER_ORG);
    });

    it("cannot update or delete B's rows (they do not exist for it)", async () => {
      const a = prisma.forOrg(ORG_A);

      expect((await a.storageObject.updateMany({ where: { id: f.objectsB[0]! }, data: { name: 'hijacked' } })).count).toBe(0);
      expect((await a.storageObject.deleteMany({ where: { id: f.objectsB[0]! } })).count).toBe(0);
      expect((await a.aiRun.updateMany({ where: {}, data: { status: 'failed' } })).count).toBe(PER_ORG);
      expect((await a.aiUsageEvent.deleteMany({ where: { id: { in: f.usageB } } })).count).toBe(0);
      await expect(a.storageObject.update({ where: { id: f.objectsB[0]! }, data: { name: 'x' } })).rejects.toThrow();
      await expect(a.storageObject.delete({ where: { id: f.objectsB[0]! } })).rejects.toThrow();
      expect((await a.$executeRaw`DELETE FROM ai_runs WHERE id = ${f.runsB[0]!}::uuid`)).toBe(0);

      // B's rows are untouched: checked through the system client.
      const asSystem = system.asSystem('doctor');
      expect((await asSystem.storageObject.findUniqueOrThrow({ where: { id: f.objectsB[0]! } })).name).not.toBe('hijacked');
      expect(await asSystem.aiRun.count({ where: { orgId: ORG_B, status: 'succeeded' } })).toBe(PER_ORG);
      expect(await asSystem.aiUsageEvent.count({ where: { orgId: ORG_B } })).toBe(PER_ORG);
    });

    it('cannot insert a row naming B (WITH CHECK), through the model API or raw SQL', async () => {
      const a = prisma.forOrg(ORG_A);
      const data = {
        orgId: ORG_B,
        name: 'planted.txt',
        size: BigInt(1),
        mimeType: 'text/plain',
        storageKey: `uploads/planted/${Date.now()}.txt`,
        status: 'ready' as const,
      };

      await expect(a.storageObject.create({ data })).rejects.toThrow(/row-level security/i);
      await expect(
        a.aiRun.create({ data: { orgId: ORG_B, provider: 'openai', modelId: 'm', request: {} } }),
      ).rejects.toThrow(/row-level security/i);
      await expect(
        a.$executeRaw`INSERT INTO ai_usage_events (id, org_id, provider, model_id, operation, key_source, latency_ms, status)
                      VALUES (gen_random_uuid(), ${ORG_B}::uuid, 'p', 'm', 'responses', 'user', 1, 'succeeded')`,
      ).rejects.toThrow(/row-level security/i);
    });

    it("cannot move one of its rows to B (the policy's WITH CHECK also guards UPDATE)", async () => {
      const a = prisma.forOrg(ORG_A);
      await expect(a.storageObject.update({ where: { id: f.objectsA[1]! }, data: { orgId: ORG_B } })).rejects.toThrow(/row-level security/i);
      await expect(a.aiRun.updateMany({ where: { id: f.runsA[0]! }, data: { orgId: ORG_B } })).rejects.toThrow(/row-level security/i);
    });

    it('writes its own row when the insert names its own organization', async () => {
      const a = prisma.forOrg(ORG_A);
      const row = await a.storageObject.create({
        data: { orgId: ORG_A, name: 'mine.txt', size: BigInt(1), mimeType: 'text/plain', storageKey: `uploads/mine/${Date.now()}.txt`, status: 'ready' },
      });
      expect((await a.storageObject.findUnique({ where: { id: row.id } }))?.name).toBe('mine.txt');
      expect(await prisma.forOrg(ORG_B).storageObject.findUnique({ where: { id: row.id } })).toBeNull();
      await a.storageObject.delete({ where: { id: row.id } });
    });
  });

  describe('an unscoped client of the same role fails closed', () => {
    it('sees no rows through the model API or raw SQL, and cannot insert', async () => {
      expect(await prisma.storageObject.findMany()).toEqual([]);
      expect(await prisma.storageObject.count()).toBe(0);
      expect(await prisma.storageObjectChunk.count()).toBe(0);
      expect(await prisma.aiRun.findMany()).toEqual([]);
      expect(await prisma.aiUsageEvent.findMany()).toEqual([]);
      expect(await prisma.$queryRaw`SELECT id FROM storage_objects`).toEqual([]);

      await expect(
        prisma.storageObject.create({
          data: { orgId: ORG_A, name: 'x', size: BigInt(1), mimeType: 'text/plain', storageKey: `uploads/unscoped/${Date.now()}`, status: 'ready' },
        }),
      ).rejects.toThrow(/row-level security/i);
    });

    it('fails closed on a connection that has held a scope before (current_setting is empty there, not NULL)', async () => {
      // A pool of ONE connection: the unscoped query runs on the connection the scoped one just used.
      const single = new PrismaClient({
        adapter: new PrismaPg({
          connectionString: `postgresql://${db.role}:${db.password}@${db.connection.host}:${db.connection.port}/${db.database}`,
          max: 1,
        }),
      });
      try {
        const scoped = single.$extends(orgScopeExtension(single, { orgId: ORG_A }));
        expect((await scoped.storageObject.findMany()).length).toBe(PER_ORG);
        expect(await single.storageObject.findMany()).toEqual([]);
        expect(await single.$queryRaw`SELECT current_setting('app.org_id', true) AS v`).toEqual([{ v: '' }]);
      } finally {
        await single.$disconnect();
      }
    });
  });

  describe('the system client (separate pool, bypass flag)', () => {
    it('sees both organizations, including the organization-less usage event', async () => {
      const s = system.asSystem('admin-aggregate');

      expect(await s.storageObject.count()).toBe(2 * PER_ORG);
      expect(await s.storageObjectChunk.count()).toBe(4);
      expect(await s.aiRun.count()).toBe(2 * PER_ORG);
      expect(await s.aiUsageEvent.count()).toBe(2 * PER_ORG + 1);
      expect((await s.aiUsageEvent.findUnique({ where: { id: f.usageNone[0]! } }))?.orgId).toBeNull();
    });

    it('is the only client that sees the organization-less usage event', async () => {
      expect(await prisma.forOrg(ORG_A).aiUsageEvent.findUnique({ where: { id: f.usageNone[0]! } })).toBeNull();
      expect(await prisma.forOrg(ORG_B).aiUsageEvent.count({ where: { orgId: null } })).toBe(0);
    });

    it('lifts the flag at the end of its transaction: the tenant pool stays fail-closed afterwards', async () => {
      await system.runAsSystem('doctor', async (tx) => {
        expect(await tx.storageObject.count()).toBe(2 * PER_ORG);
      });
      expect(await system.storageObject.count()).toBe(0); // the bare system PrismaClient has no scope either
      expect(await prisma.storageObject.count()).toBe(0);
      const flag = await system.$queryRaw<Array<{ v: string | null }>>`SELECT current_setting('app.rls_bypass', true) AS v`;
      expect(flag[0]!.v === null || flag[0]!.v === '').toBe(true);
    });

    it('uses its own pool and a distinct application_name', async () => {
      const sys = await system.$queryRaw<Array<{ name: string; pid: number }>>`SELECT current_setting('application_name') AS name, pg_backend_pid() AS pid`;
      const ten = await prisma.$queryRaw<Array<{ name: string; pid: number }>>`SELECT current_setting('application_name') AS name, pg_backend_pid() AS pid`;
      expect(sys[0]!.name).toMatch(/-system$/);
      expect(ten[0]!.name).not.toMatch(/-system$/);
    });

    it('refuses a reason outside the closed list', () => {
      expect(() => system.asSystem('because' as never)).toThrow(ScopedAccessError);
    });
  });

  describe('transaction-local settings', () => {
    it('keeps 200 interleaved scoped operations for A and B apart on a pool of four', async () => {
      const a = prisma.forOrg(ORG_A);
      const b = prisma.forOrg(ORG_B);

      const results = await Promise.all(
        Array.from({ length: 200 }, async (_, i) => {
          const useA = i % 2 === 0;
          const rows = await (useA ? a : b).storageObject.findMany({ select: { id: true } });
          return { useA, ids: rows.map((r) => r.id).sort() };
        }),
      );

      for (const r of results) expect(r.ids).toEqual(([...(r.useA ? f.objectsA : f.objectsB)]).sort());
    });

    it('keeps concurrent interactive transactions apart (runInOrg) and sees its own writes inside', async () => {
      const results = await Promise.all(
        Array.from({ length: 60 }, (_, i) => {
          const org = i % 2 === 0 ? ORG_A : ORG_B;
          return prisma.runInOrg(
            org,
            async (tx) => {
              const first = await tx.storageObject.count();
              const second = await tx.aiRun.count();
              return { org, first, second };
            },
            { maxWait: 60_000 },
          );
        }),
      );

      for (const r of results) expect([r.first, r.second]).toEqual([PER_ORG, PER_ORG]);
    });

    it('rolls a scoped transaction back when the unit of work throws', async () => {
      await expect(
        prisma.runInOrg(ORG_A, async (tx) => {
          await tx.storageObject.create({
            data: { orgId: ORG_A, name: 'rolled-back', size: BigInt(1), mimeType: 'text/plain', storageKey: `uploads/rb/${Date.now()}`, status: 'ready' },
          });
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');
      expect(await prisma.forOrg(ORG_A).storageObject.count({ where: { name: 'rolled-back' } })).toBe(0);
    });

    it('reuses the outer transaction when nested in the same scope, and refuses another organization', async () => {
      // The nested call goes through the core function with the outer `tx`.
      const total = await prisma.runInOrg(ORG_A, (tx) =>
        runInOrg(tx, { orgId: ORG_A }, (inner) => (inner as unknown as typeof tx).storageObject.count()),
      );
      expect(total).toBe(PER_ORG);

      await expect(
        prisma.runInOrg(ORG_A, (tx) => runInOrg(tx, { orgId: ORG_B }, async () => 1)),
      ).rejects.toThrow(ScopedAccessError);
    });

    it('refuses a scoped client used inside $transaction(async tx => ...)', async () => {
      const a = prisma.forOrg(ORG_A);
      await expect(a.$transaction(async (tx) => tx.storageObject.count())).rejects.toThrow(/escape the transaction/);
    });

    it('refuses a malformed organization id before any SQL', () => {
      expect(() => prisma.forOrg('not-a-uuid')).toThrow(ScopedAccessError);
      expect(() => prisma.forOrg("x'; DROP TABLE storage_objects; --")).toThrow(ScopedAccessError);
    });
  });

  describe('composite foreign keys between org-owned tables', () => {
    it("refuses a chunk naming another organization's object, even through the system client", async () => {
      await expect(
        system.runAsSystem('migration-tooling', (tx) =>
          tx.storageObjectChunk.create({ data: { objectId: f.objectsA[2]!, orgId: ORG_B, partNumber: 9, eTag: 'x', size: BigInt(1) } }),
        ),
      ).rejects.toThrow(/foreign key/i);
    });

    it('cascades a deleted object to its chunks within the organization', async () => {
      const a = prisma.forOrg(ORG_A);
      expect(await a.storageObjectChunk.count({ where: { objectId: f.objectsA[0]! } })).toBe(2);
      await a.storageObject.delete({ where: { id: f.objectsA[0]! } });
      expect(await system.asSystem('doctor').storageObjectChunk.count({ where: { objectId: f.objectsA[0]! } })).toBe(0);
    });
  });
});
