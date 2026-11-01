// =============================================================================
// Real Postgres: group_invites_pending_uniq_idx (issue #728, PP-7.1)
// =============================================================================
//
// The raw-SQL partial unique index allows ONE pending invite per (group,
// address); an accepted, declined or revoked one does not count, so the
// address can be invited again. Proven on the index itself and through the
// real service (409 INVITE_PENDING, then a re-invite after decline / revoke).
// =============================================================================

import { resolveDbSuite } from '../jobs/db-test-support';
import { createRlsDatabase, ORG_A, type RlsDatabase } from '../helpers/rls-database.helper';
import { principalOf, seedOrgs, seedUser, sharingServices, type SharingDb } from './sharing-db.helper';

const { describeWithDb } = resolveDbSuite('group-invites-uniq.db.spec');

describeWithDb('group_invites_pending_uniq_idx (real Postgres)', () => {
  let db: RlsDatabase;
  let sharing: SharingDb;
  let alice: string;
  let bob: string;
  let groupId: string;
  const asAlice = () => principalOf(alice, 'alice@example.test', ORG_A, 'contributor');
  const asBob = () => principalOf(bob, 'bob@example.test', ORG_A, 'viewer');

  /** Inserts an invite row directly in org A's scope. */
  async function insert(email: string, extra: Record<string, unknown> = {}) {
    return db.tenant.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.org_id', ${ORG_A}, true)`;
      return tx.groupInvite.create({ data: { groupId, orgId: ORG_A, email, role: 'viewer', ...extra } });
    });
  }

  beforeAll(async () => {
    db = await createRlsDatabase('ginv');
    await seedOrgs(db, [[ORG_A, 'org-a']]);
    alice = await seedUser(db, 'alice@example.test', [ORG_A]);
    bob = await seedUser(db, 'bob@example.test', [ORG_A]);
    sharing = await sharingServices(db);
    groupId = (await sharing.groups.create(asAlice(), { name: 'Family' })).id;
  }, 180_000);

  afterAll(async () => {
    await sharing?.close();
    await db?.destroy();
  }, 60_000);

  it('exists with its partial definition', async () => {
    const { rows } = await db.admin((c) => c.query<{ indexdef: string }>("SELECT indexdef FROM pg_indexes WHERE indexname = 'group_invites_pending_uniq_idx'"));
    expect(rows[0]?.indexdef).toBe(
      'CREATE UNIQUE INDEX group_invites_pending_uniq_idx ON public.group_invites USING btree (group_id, email) WHERE ((accepted_at IS NULL) AND (declined_at IS NULL) AND (revoked_at IS NULL))',
    );
  });

  it('refuses a second pending row for the same address and admits it once the first is answered', async () => {
    await insert('x@example.test');
    await expect(insert('x@example.test')).rejects.toMatchObject({ code: 'P2002' });
    await insert('y@example.test'); // another address is fine
    await insert('x@example.test', { declinedAt: new Date() }); // a declined row does not count
    await insert('x@example.test', { revokedAt: new Date() });
    await insert('x@example.test', { acceptedAt: new Date() });
  });

  it('answers 409 INVITE_PENDING through the service, and lets the address be re-invited after decline or revoke', async () => {
    const first = await sharing.invites.create(asAlice(), groupId, { email: 'bob@example.test', role: 'editor' });
    const again = await sharing.invites.create(asAlice(), groupId, { email: 'bob@example.test', role: 'editor' }).catch((e) => e);
    expect(again.getResponse()).toMatchObject({ details: { reason: 'INVITE_PENDING' } });

    await sharing.invites.decline(asBob(), first.id);
    const second = await sharing.invites.create(asAlice(), groupId, { email: 'bob@example.test', role: 'viewer' });
    await sharing.invites.revoke(asAlice(), groupId, second.id);
    const third = await sharing.invites.create(asAlice(), groupId, { email: 'bob@example.test', role: 'viewer' });

    expect((await sharing.invites.mine(asBob())).items.map((i) => i.id)).toEqual([third.id]);
    expect(await sharing.invites.accept(asBob(), third.id)).toEqual({ groupId, orgId: ORG_A, role: 'viewer' });
    // Accepted: no longer pending for Bob, and Bob is a member.
    expect((await sharing.invites.mine(asBob())).items).toEqual([]);
    expect((await sharing.members.list(asAlice(), groupId, { page: 1, pageSize: 20 })).items.map((m) => [m.userId, m.role])).toEqual([
      [alice, 'admin'],
      [bob, 'viewer'],
    ]);
    // The notification went to Bob's account once per invite.
    expect(sharing.notifications.filter((n) => n.to === bob)).toHaveLength(3);
  });

  it('answers 410 for an expired invite and lets the address be invited again (the expired row is closed)', async () => {
    await db.system.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.rls_bypass', 'on', true)`;
      await tx.groupInvite.create({ data: { groupId, orgId: ORG_A, email: 'late@example.test', role: 'viewer', expiresAt: new Date(Date.now() - 60_000) } });
    });
    const late = await seedUser(db, 'late@example.test', [ORG_A]);
    const asLate = principalOf(late, 'late@example.test', ORG_A, 'viewer');
    const [expired] = await db.system.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.rls_bypass', 'on', true)`;
      return tx.groupInvite.findMany({ where: { email: 'late@example.test' } });
    });
    await expect(sharing.invites.accept(asLate, expired!.id)).rejects.toMatchObject({ status: 410 });
    // A fresh invite to the same address succeeds although the expired row was still "pending" in SQL terms.
    await expect(sharing.invites.create(asAlice(), groupId, { email: 'late@example.test', role: 'viewer' })).resolves.toMatchObject({ status: 'pending' });
  });
});
