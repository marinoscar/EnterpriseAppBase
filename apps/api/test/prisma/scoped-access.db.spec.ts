// =============================================================================
// Real-Postgres test: a user-scoped client never reaches another user's rows
// (issue #688, PP-1.9; mechanism in @marinoscar/platform-api/core since #699)
// =============================================================================
//
// The package's unit tests prove the argument rewriting against a fake
// client (packages/platform-api/test/core/data-access/); only a real
// Prisma client against a real server proves the rewritten arguments are
// accepted (extra filters on a unique where, the owner set on create, the
// relation connect form) and actually isolate users. Two users each own two
// `UserCredential` rows; everything goes through `forUser(A)` and B's rows
// are checked untouched through the unscoped client afterwards.
//
// Every user is created by this suite with a run-unique email and deleted in
// `afterAll` (their credentials cascade), so it neither sees nor disturbs
// other data.
//
// THIS IS A `*.db.spec.ts` FILE: skipped with a warning when no Postgres is
// reachable; see `test/jobs/db-test-support.ts`. Run with `npm run test:db`
// against a migrated database.
// =============================================================================

import { randomUUID } from 'node:crypto';

import { Prisma, type PrismaClient } from '@prisma/client';

import { ScopedAccessError, forUser } from '@marinoscar/platform-api/core';
import { ScopedPrismaService, type UserScopedClient } from '../../src/prisma/ownership';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createDbClient, resolveDbSuite } from '../jobs/db-test-support';

const { describeWithDb } = resolveDbSuite('scoped-access.db.spec');

describeWithDb('scoped data access (real Postgres)', () => {
  let client: PrismaClient;
  let scoped: ScopedPrismaService;
  let asA: UserScopedClient;
  let alice: string;
  let bob: string;
  const run = randomUUID().slice(0, 8);
  const createdUserIds: string[] = [];

  async function makeUser(label: string): Promise<string> {
    const user = await client.user.create({ data: { email: `${label}-${run}@example.com` }, select: { id: true } });
    createdUserIds.push(user.id);
    return user.id;
  }

  /** Bob's rows, read unscoped, with the columns a scoped write could change. */
  const bobsRows = () =>
    client.userCredential.findMany({
      where: { userId: bob },
      select: { id: true, name: true, label: true, secret: true },
      orderBy: { name: 'asc' },
    });

  let bobBefore: Awaited<ReturnType<typeof bobsRows>>;
  let bobFirstId: string;

  beforeAll(async () => {
    client = createDbClient();
    scoped = new ScopedPrismaService(client as unknown as PrismaService);
    alice = await makeUser('scoped-a');
    bob = await makeUser('scoped-b');
    asA = scoped.forUser(alice);

    for (const userId of [alice, bob]) {
      for (const name of ['one', 'two']) {
        await client.userCredential.create({
          data: { userId, purpose: 'scoped-test', name, secret: `${userId}-${name}`, label: 'original' },
        });
      }
    }
    bobBefore = await bobsRows();
    bobFirstId = bobBefore[0].id;
  });

  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await client.$disconnect();
  });

  afterEach(async () => {
    // The invariant every test below relies on.
    await expect(bobsRows()).resolves.toEqual(bobBefore);
  });

  it('findMany returns only the scope user’s rows, even when the where names another user', async () => {
    const all = await asA.userCredential.findMany({ where: { purpose: 'scoped-test' } });
    expect(all.map((row) => row.userId)).toEqual([alice, alice]);

    await expect(asA.userCredential.findMany({ where: { userId: bob } })).resolves.toEqual([]);
  });

  it("findUnique and findFirst treat another user's row as not found", async () => {
    await expect(asA.userCredential.findUnique({ where: { id: bobFirstId } })).resolves.toBeNull();
    await expect(
      asA.userCredential.findUnique({
        where: { userId_purpose_name: { userId: bob, purpose: 'scoped-test', name: 'one' } },
      }),
    ).resolves.toBeNull();
    await expect(asA.userCredential.findFirst({ where: { id: bobFirstId } })).resolves.toBeNull();

    const own = await asA.userCredential.findUnique({
      where: { userId_purpose_name: { userId: alice, purpose: 'scoped-test', name: 'one' } },
    });
    expect(own?.userId).toBe(alice);
  });

  it('count and aggregate count only the scope user’s rows', async () => {
    await expect(asA.userCredential.count({ where: { purpose: 'scoped-test' } })).resolves.toBe(2);
    await expect(asA.userCredential.count({ where: { userId: bob } })).resolves.toBe(0);
    const agg = await asA.userCredential.aggregate({ _count: { _all: true }, where: { purpose: 'scoped-test' } });
    expect(agg._count._all).toBe(2);
  });

  it("update of another user's row fails as not found (P2025)", async () => {
    const error = await asA.userCredential
      .update({ where: { id: bobFirstId }, data: { label: 'hijacked' } })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect((error as Prisma.PrismaClientKnownRequestError).code).toBe('P2025');
  });

  it('updateMany changes only the scope user’s rows', async () => {
    const { count } = await asA.userCredential.updateMany({ where: { purpose: 'scoped-test' }, data: { label: 'mine' } });
    expect(count).toBe(2);
    await expect(asA.userCredential.updateMany({ where: { userId: bob }, data: { label: 'x' } })).resolves.toEqual({
      count: 0,
    });
  });

  it("delete of another user's row fails as not found (P2025)", async () => {
    const error = await asA.userCredential.delete({ where: { id: bobFirstId } }).catch((e: unknown) => e);
    expect((error as Prisma.PrismaClientKnownRequestError).code).toBe('P2025');
  });

  it("upsert on another user's address creates nothing for them and changes nothing of theirs", async () => {
    const error = await asA.userCredential
      .upsert({
        where: { userId_purpose_name: { userId: bob, purpose: 'scoped-test', name: 'one' } },
        create: { userId: bob, purpose: 'scoped-test', name: 'one', secret: 'x' },
        update: { label: 'hijacked' },
      })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ScopedAccessError);

    // The scope user's own upsert, with the owner given as a relation connect.
    const row = await asA.userCredential.upsert({
      where: { userId_purpose_name: { userId: alice, purpose: 'scoped-test', name: 'three' } },
      create: { user: { connect: { id: alice } }, purpose: 'scoped-test', name: 'three', secret: 's' },
      update: { label: 'updated' },
    });
    expect(row.userId).toBe(alice);
    const again = await asA.userCredential.upsert({
      where: { userId_purpose_name: { userId: alice, purpose: 'scoped-test', name: 'three' } },
      create: { user: { connect: { id: alice } }, purpose: 'scoped-test', name: 'three', secret: 's' },
      update: { label: 'updated' },
    });
    expect(again).toMatchObject({ id: row.id, label: 'updated' });
  });

  it('deleteMany deletes only the scope user’s rows', async () => {
    await expect(asA.userCredential.deleteMany({ where: { userId: bob } })).resolves.toEqual({ count: 0 });
    await asA.userCredential.create({ data: { userId: alice, purpose: 'scoped-test', name: 'four', secret: 's' } });
    await expect(asA.userCredential.deleteMany({ where: { name: 'four' } })).resolves.toEqual({ count: 1 });
  });

  it("create sets the scope user as owner, and refuses another user's id", async () => {
    // The scalar is required by the generated types; a scoped create that
    // omits it at runtime gets the scope user.
    const created = await asA.userCredential.create({
      data: { purpose: 'scoped-test', name: 'five', secret: 's' } as Prisma.UserCredentialUncheckedCreateInput,
    });
    expect(created.userId).toBe(alice);

    await expect(
      asA.userCredential.create({ data: { userId: bob, purpose: 'scoped-test', name: 'six', secret: 's' } }),
    ).rejects.toThrow(ScopedAccessError);
    await expect(
      asA.userCredential.create({ data: { user: { connect: { id: bob } }, purpose: 'scoped-test', name: 'six', secret: 's' } }),
    ).rejects.toThrow(ScopedAccessError);
    await expect(client.userCredential.count({ where: { name: 'six' } })).resolves.toBe(0);
  });

  it('refuses an actor-only model and an unregistered model', async () => {
    await expect(asA.auditEvent.findMany()).rejects.toThrow('AuditEvent is not user-owned; use asSystem() with a reason.');
    await expect(asA.user.findUnique({ where: { id: alice } })).rejects.toThrow(ScopedAccessError);
    await expect(asA.role.count()).rejects.toThrow(ScopedAccessError);
  });

  it('refuses raw SQL, also inside an interactive transaction', async () => {
    await expect(asA.$queryRaw`SELECT 1`).rejects.toThrow(ScopedAccessError);
    await expect(asA.$executeRawUnsafe('SELECT 1')).rejects.toThrow(ScopedAccessError);
    await expect(asA.$transaction(async (tx) => tx.$queryRaw`SELECT 1`)).rejects.toThrow(ScopedAccessError);
  });

  it('stays scoped inside an interactive transaction', async () => {
    const rows = await asA.$transaction(async (tx) => tx.userCredential.findMany({ where: { userId: bob } }));
    expect(rows).toEqual([]);
  });

  it('asSystem returns the unscoped client', async () => {
    const system = scoped.asSystem({ kind: 'system', reason: 'test' });
    await expect(system.userCredential.count({ where: { userId: bob } })).resolves.toBe(2);
  });

  it("PrismaService.forUser and the package's forUser isolate the same way on the app's real client", async () => {
    const typed = PrismaService.prototype.forUser.call(client as unknown as PrismaService, { userId: alice });
    await expect(typed.userCredential.count({ where: { userId: bob } })).resolves.toBe(0);
    const alicesOwn = await client.userCredential.count({ where: { userId: alice, purpose: 'scoped-test' } });
    expect(alicesOwn).toBeGreaterThan(0);
    await expect(typed.userCredential.count({ where: { purpose: 'scoped-test' } })).resolves.toBe(alicesOwn);

    // The schema-independent entry point: the client arrives untyped, as a packaged slice sees it.
    const generic = forUser(client, { userId: alice }) as unknown as typeof typed;
    await expect(generic.userCredential.findMany({ where: { userId: bob } })).resolves.toEqual([]);
    await expect(generic.userCredential.updateMany({ where: { id: bobFirstId }, data: { label: 'stolen' } })).resolves.toEqual({ count: 0 });
    await expect(bobsRows()).resolves.toEqual(bobBefore);
  });
});
