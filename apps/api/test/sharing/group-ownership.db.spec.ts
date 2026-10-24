// =============================================================================
// Real Postgres: resources owned by a group (issue #728, PP-7.1)
// =============================================================================
//
// 1. Deleting a group is refused while a registered resource type still has
//    rows the group owns: `test_albums`, a TEST-ONLY table created here with
//    the documented column convention (owner_user_id / owner_group_id, ON
//    DELETE RESTRICT, exactly one owner). No production migration.
// 2. `ownedByMeOrMyGroups()` selects exactly the rows owned by the user or by
//    a group they belong to, against real rows. The stand-in model is `Group`
//    itself (owner fields `createdById` and `id`): "groups I created or
//    belong to".
// =============================================================================

import { randomUUID } from 'node:crypto';

import { withTemporaryEntries } from '@marinoscar/platform-api/core';
import { groupOwnedResourceRegistry, ownedByMeOrMyGroups } from '@marinoscar/platform-api/sharing';

import { resolveDbSuite } from '../jobs/db-test-support';
import { createRlsDatabase, ORG_A, type RlsDatabase } from '../helpers/rls-database.helper';
import { principalOf, seedOrgs, seedUser, sharingServices, type SharingDb } from './sharing-db.helper';

const { describeWithDb } = resolveDbSuite('group-ownership.db.spec');

describeWithDb('group-owned resources (real Postgres)', () => {
  let db: RlsDatabase;
  let sharing: SharingDb;
  let alice: string;
  let bob: string;
  const asAlice = () => principalOf(alice, 'alice@example.test', ORG_A, 'contributor');
  const asBob = () => principalOf(bob, 'bob@example.test', ORG_A, 'contributor');

  const albums = {
    type: 'test_album',
    countOwnedByGroup: async (groupId: string, tx: unknown) => {
      const rows = await (tx as RlsDatabase['tenant']).$queryRaw<Array<{ n: number }>>`SELECT count(*)::int AS n FROM test_albums WHERE owner_group_id = ${groupId}::uuid`;
      return rows[0]?.n ?? 0;
    },
  };

  beforeAll(async () => {
    db = await createRlsDatabase('gown');
    await seedOrgs(db, [[ORG_A, 'org-a']]);
    alice = await seedUser(db, 'alice@example.test', [ORG_A]);
    bob = await seedUser(db, 'bob@example.test', [ORG_A]);
    // The documented convention, on a table owned by the application role.
    await db.tenant.$executeRawUnsafe(`
      CREATE TABLE test_albums (
        id uuid PRIMARY KEY,
        owner_user_id uuid NULL REFERENCES users(id),
        owner_group_id uuid NULL REFERENCES groups(id) ON DELETE RESTRICT,
        CHECK (num_nonnulls(owner_user_id, owner_group_id) = 1)
      )`);
    sharing = await sharingServices(db);
  }, 180_000);

  afterAll(async () => {
    await sharing?.close();
    await db?.destroy();
  }, 60_000);

  it('enforces exactly one owner at the database', async () => {
    await expect(db.tenant.$executeRaw`INSERT INTO test_albums (id) VALUES (${randomUUID()}::uuid)`).rejects.toThrow();
  });

  it('refuses to delete a group that owns a registered resource (409 with counts), then deletes it with its members and invites', async () => {
    const group = await sharing.groups.create(asAlice(), { name: 'Album club' });
    await sharing.members.add(asAlice(), group.id, { userId: bob, role: 'editor' });
    await sharing.invites.create(asAlice(), group.id, { email: 'someone@example.test', role: 'viewer' });
    const album = randomUUID();
    await db.tenant.$executeRaw`INSERT INTO test_albums (id, owner_group_id) VALUES (${album}::uuid, ${group.id}::uuid)`;

    await withTemporaryEntries(groupOwnedResourceRegistry, [albums], async () => {
      const refused = await sharing.groups.delete(asAlice(), group.id).catch((e) => e);
      expect(refused.getStatus()).toBe(409);
      expect(refused.getResponse()).toMatchObject({ details: { reason: 'GROUP_OWNS_RESOURCES', counts: { test_album: 1 } } });
      expect(await sharing.groups.get(asAlice(), group.id)).toMatchObject({ memberCount: 2 });

      await db.tenant.$executeRaw`DELETE FROM test_albums WHERE id = ${album}::uuid`;
      await sharing.groups.delete(asAlice(), group.id);
    });

    const left = await db.admin((c) =>
      c.query<{ g: number; m: number; i: number }>(
        'SELECT (SELECT count(*)::int FROM groups WHERE id = $1) AS g, (SELECT count(*)::int FROM group_members WHERE group_id = $1) AS m, (SELECT count(*)::int FROM group_invites WHERE group_id = $1) AS i',
        [group.id],
      ),
    );
    expect(left.rows[0]).toEqual({ g: 0, m: 0, i: 0 });
  });

  it('keeps the database half of the rule too: ON DELETE RESTRICT refuses a raw delete of an owning group', async () => {
    const group = await sharing.groups.create(asAlice(), { name: 'Raw' });
    await db.tenant.$executeRaw`INSERT INTO test_albums (id, owner_group_id) VALUES (${randomUUID()}::uuid, ${group.id}::uuid)`;
    await expect(
      db.system.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.rls_bypass', 'on', true)`;
        await tx.group.delete({ where: { id: group.id } });
      }),
    ).rejects.toThrow();
  });

  it('ownedByMeOrMyGroups selects only rows owned by the user or by a group they belong to', async () => {
    const created = await sharing.groups.create(asAlice(), { name: 'Created by Alice' }); // owned by Alice (createdById)
    const joined = await sharing.groups.create(asBob(), { name: 'Bob, Alice joins' });
    await sharing.members.add(asBob(), joined.id, { userId: alice, role: 'viewer' });
    const foreign = await sharing.groups.create(asBob(), { name: 'Bob only' });

    const me = await sharing.principalGroups.enrich(asAlice());
    const where = ownedByMeOrMyGroups(me, { ownerUserField: 'createdById', ownerGroupField: 'id' });
    const visible = await db.tenant.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.org_id', ${ORG_A}, true)`;
      return tx.group.findMany({ where, select: { id: true } });
    });
    const ids = visible.map((g) => g.id);
    expect(ids).toEqual(expect.arrayContaining([created.id, joined.id]));
    expect(ids).not.toContain(foreign.id);

    const editors = ownedByMeOrMyGroups(me, { ownerUserField: 'createdById', ownerGroupField: 'id' }, { minGroupRole: 'editor' });
    const asEditor = await db.tenant.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.org_id', ${ORG_A}, true)`;
      return tx.group.findMany({ where: editors, select: { id: true } });
    });
    // Alice is only a viewer of `joined`: it drops out; she still created `created`.
    expect(asEditor.map((g) => g.id)).toContain(created.id);
    expect(asEditor.map((g) => g.id)).not.toContain(joined.id);
  });
});
