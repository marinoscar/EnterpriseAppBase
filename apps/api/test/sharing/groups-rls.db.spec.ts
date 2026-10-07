// =============================================================================
// Real Postgres: groups are isolated per organization under row-level
// security (issue #728, PP-7.1)
// =============================================================================
//
// The REAL sharing services over a database owned by an ordinary role that
// FORCEs row-level security (`createRlsDatabase`): a user of organization A
// cannot list, read, change or join organization B's groups, even with B's
// group id in hand, and the database itself refuses the cross-organization
// rows a bug might try to write (the policy's WITH CHECK, the composite key).
// A `*.db.spec.ts` file: skipped with a warning when no Postgres is reachable.
// =============================================================================

import { randomUUID } from 'node:crypto';

import { resolveDbSuite } from '../jobs/db-test-support';
import { createRlsDatabase, ORG_A, ORG_B, type RlsDatabase } from '../helpers/rls-database.helper';
import { principalOf, seedOrgs, seedUser, sharingServices, type SharingDb } from './sharing-db.helper';

const { describeWithDb } = resolveDbSuite('groups-rls.db.spec');

describeWithDb('groups under row-level security (real Postgres, ordinary role)', () => {
  let db: RlsDatabase;
  let sharing: SharingDb;
  let alice: string;
  let bob: string;
  let groupA: string;
  let groupB: string;
  const asAlice = () => principalOf(alice, 'alice@example.test', ORG_A, 'org_admin');
  const asBob = () => principalOf(bob, 'bob@example.test', ORG_B, 'org_admin');

  beforeAll(async () => {
    db = await createRlsDatabase('grp');
    await seedOrgs(db, [[ORG_A, 'org-a'], [ORG_B, 'org-b']]);
    alice = await seedUser(db, 'alice@example.test', [ORG_A]);
    bob = await seedUser(db, 'bob@example.test', [ORG_B]);
    sharing = await sharingServices(db, 'multi');
    groupA = (await sharing.groups.create(asAlice(), { name: 'A team' })).id;
    groupB = (await sharing.groups.create(asBob(), { name: 'B team' })).id;
  }, 180_000);

  afterAll(async () => {
    await sharing?.close();
    await db?.destroy();
  }, 60_000);

  it('runs as an ordinary role that owns the tables, with row-level security forced on all three', async () => {
    const rows = await db.admin((c) =>
      c.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
        "SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname IN ('groups','group_members','group_invites') ORDER BY relname",
      ),
    );
    expect(rows.rows).toEqual([
      { relname: 'group_invites', relrowsecurity: true, relforcerowsecurity: true },
      { relname: 'group_members', relrowsecurity: true, relforcerowsecurity: true },
      { relname: 'groups', relrowsecurity: true, relforcerowsecurity: true },
    ]);
    const role = await db.admin((c) => c.query<{ rolsuper: boolean; rolbypassrls: boolean }>('SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = $1', [db.role]));
    expect(role.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  });

  it("lists only the active organization's groups, even with scope=all for groups:admin", async () => {
    expect((await sharing.groups.list(asAlice(), { scope: 'all', page: 1, pageSize: 50 })).items.map((g) => g.id)).toEqual([groupA]);
    expect((await sharing.groups.list(asBob(), { scope: 'all', page: 1, pageSize: 50 })).items.map((g) => g.id)).toEqual([groupB]);
  });

  it("answers 404 to org A for org B's group on every route, with the id in hand", async () => {
    const me = asAlice();
    const notFound = { status: 404 };
    await expect(sharing.groups.get(me, groupB)).rejects.toMatchObject(notFound);
    await expect(sharing.groups.update(me, groupB, { name: 'mine now' })).rejects.toMatchObject(notFound);
    await expect(sharing.groups.delete(me, groupB)).rejects.toMatchObject(notFound);
    await expect(sharing.members.list(me, groupB, { page: 1, pageSize: 20 })).rejects.toMatchObject(notFound);
    await expect(sharing.members.add(me, groupB, { userId: alice, role: 'admin' })).rejects.toMatchObject(notFound);
    await expect(sharing.members.remove(me, groupB, bob)).rejects.toMatchObject(notFound);
    await expect(sharing.invites.create(me, groupB, { email: 'alice@example.test', role: 'admin' })).rejects.toMatchObject(notFound);
    // Nothing changed in B.
    expect(await sharing.groups.get(asBob(), groupB)).toMatchObject({ name: 'B team', memberCount: 1 });
  });

  it("cannot join org B's group through an invite: it never appears and cannot be accepted", async () => {
    const invite = await sharing.invites.create(asBob(), groupB, { email: 'carol@example.test', role: 'viewer' }).catch((e) => e);
    // multi mode: an address that is no member of B (and has no org invite to it) -> 422.
    expect(invite).toMatchObject({ status: 422 });

    // An invite in B addressed to Alice, written by the system pool (a bug or a
    // stale membership): Alice, who is not in B, neither sees nor accepts it.
    const id = randomUUID();
    await db.system.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.rls_bypass', 'on', true)`;
      await tx.groupInvite.create({ data: { id, groupId: groupB, orgId: ORG_B, email: 'alice@example.test', role: 'admin' } });
    });
    expect((await sharing.invites.mine(asAlice())).items).toEqual([]);
    await expect(sharing.invites.accept(asAlice(), id)).rejects.toMatchObject({ status: 404 });
    expect(await sharing.groups.get(asBob(), groupB)).toMatchObject({ memberCount: 1 });
  });

  it("refuses at the database a member row in A's scope that names B's group (composite key) or B's organization (WITH CHECK)", async () => {
    // Org A's scope, naming B's group with A's org: the composite key (group_id, org_id) has no such group.
    await expect(
      db.tenant.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.org_id', ${ORG_A}, true)`;
        await tx.groupMember.create({ data: { groupId: groupB, orgId: ORG_A, userId: alice, role: 'admin' } });
      }),
    ).rejects.toThrow();
    // Org A's scope, naming B's organization: the policy's WITH CHECK refuses it.
    await expect(
      db.tenant.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.org_id', ${ORG_A}, true)`;
        await tx.groupMember.create({ data: { groupId: groupB, orgId: ORG_B, userId: alice, role: 'admin' } });
      }),
    ).rejects.toThrow(/row-level security/);
  });

  it('shows an unscoped client of the same role no group, member or invite', async () => {
    expect(await db.tenant.group.count()).toBe(0);
    expect(await db.tenant.groupMember.count()).toBe(0);
    expect(await db.tenant.groupInvite.count()).toBe(0);
    expect(await db.tenant.$queryRaw<Array<{ n: bigint }>>`SELECT count(*)::bigint AS n FROM groups`).toEqual([{ n: 0n }]);
  });

  it("fills Scope.groupIds from the active organization's memberships only", async () => {
    expect((await sharing.principalGroups.scopeFor(asAlice())).groupIds).toEqual([groupA]);
    expect((await sharing.principalGroups.scopeFor(asBob())).groupIds).toEqual([groupB]);
  });

  it('writes the audit rows with the organization and no e-mail address', async () => {
    const rows = await db.admin((c) => c.query<{ action: string; org_id: string; meta: unknown }>("SELECT action, org_id, meta FROM audit_events WHERE action LIKE 'group:%' ORDER BY created_at"));
    expect(rows.rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.rows.filter((r) => r.action === 'group:created').map((r) => r.org_id).sort()).toEqual([ORG_A, ORG_B].sort());
    expect(JSON.stringify(rows.rows.map((r) => r.meta))).not.toContain('@');
  });
});
