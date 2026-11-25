// =============================================================================
// Real Postgres: auto-claiming pending group invites (seam #1078)
// =============================================================================
//
// Mocked Prisma cannot prove the parts that matter here: the lookup of a
// person's invites across organizations on the bypass pool (reason
// `invite-claim`), each claim then running under its OWN organization's
// row-level security, the upgrade-only merge on real rows, the partial unique
// index, and the audit rows carrying the right organization.
// =============================================================================

import { randomUUID } from 'node:crypto';

import { resolveDbSuite } from '../jobs/db-test-support';
import { createRlsDatabase, ORG_A, ORG_B, type RlsDatabase } from '../helpers/rls-database.helper';
import { principalOf, seedOrgs, seedUser, sharingServices, type SharingDb } from './sharing-db.helper';

const { describeWithDb } = resolveDbSuite('invite-auto-accept.db.spec');

describeWithDb('claimPendingForEmail (real Postgres, ordinary role)', () => {
  let db: RlsDatabase;
  let sharing: SharingDb;
  let alice: string;
  let carol: string;
  let dana: string;
  let groupA: string;
  let groupB: string;
  const asAlice = (org: string) => principalOf(alice, 'alice@example.test', org, 'contributor');

  /** An invite written by the bypass pool, so a test can plant any state (expired, revoked, for a member). */
  async function plant(orgId: string, groupId: string, email: string, role: string, extra: Record<string, unknown> = {}): Promise<string> {
    const id = randomUUID();
    await db.system.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.rls_bypass', 'on', true)`;
      await tx.groupInvite.create({ data: { id, groupId, orgId, email, role, invitedById: alice, ...extra } });
    });
    return id;
  }

  async function newGroup(orgId: string, name: string): Promise<string> {
    return (await sharing.groups.create(asAlice(orgId), { name })).id;
  }

  async function roleOf(orgId: string, groupId: string, userId: string): Promise<string | null> {
    const members = await sharing.members.list(asAlice(orgId), groupId, { page: 1, pageSize: 50 });
    return members.items.find((m) => m.userId === userId)?.role ?? null;
  }

  async function inviteRow(id: string) {
    return db.admin((c) => c.query<{ accepted_at: Date | null; accepted_by_id: string | null }>('SELECT accepted_at, accepted_by_id FROM group_invites WHERE id = $1', [id]));
  }

  beforeAll(async () => {
    db = await createRlsDatabase('ginvauto');
    await seedOrgs(db, [[ORG_A, 'org-a'], [ORG_B, 'org-b']]);
    alice = await seedUser(db, 'alice@example.test', [ORG_A, ORG_B]);
    carol = await seedUser(db, 'carol@example.test', [ORG_A, ORG_B]);
    dana = await seedUser(db, 'dana@example.test', [ORG_A]);
    sharing = await sharingServices(db);
    groupA = await newGroup(ORG_A, 'Family');
    groupB = await newGroup(ORG_B, 'Club');
  }, 180_000);

  afterAll(async () => {
    await sharing?.close();
    await db?.destroy();
  }, 60_000);

  it("joins the groups of every organization with an invite, each under that organization's own scope", async () => {
    const inviteA = (await sharing.invites.create(asAlice(ORG_A), groupA, { email: 'carol@example.test', role: 'editor' })).id;
    const inviteB = (await sharing.invites.create(asAlice(ORG_B), groupB, { email: 'carol@example.test', role: 'viewer' })).id;
    const danaInvite = (await sharing.invites.create(asAlice(ORG_A), groupA, { email: 'dana@example.test', role: 'viewer' })).id;
    sharing.events.length = 0;

    const result = await sharing.invites.claimPendingForEmail(carol, 'Carol@Example.test');

    expect([...result.joined].sort()).toEqual([groupA, groupB].sort());
    expect(result).toMatchObject({ upgraded: [], skipped: [] });
    expect(await roleOf(ORG_A, groupA, carol)).toBe('editor');
    expect(await roleOf(ORG_B, groupB, carol)).toBe('viewer');
    expect((await inviteRow(inviteA)).rows[0]).toMatchObject({ accepted_by_id: carol });
    expect((await inviteRow(inviteB)).rows[0]!.accepted_at).not.toBeNull();
    // Dana's invite and membership are untouched.
    expect((await inviteRow(danaInvite)).rows[0]!.accepted_at).toBeNull();
    expect(await roleOf(ORG_A, groupA, dana)).toBeNull();
    // Audit rows carry the organization of THEIR group and no address.
    const audit = await db.admin((c) =>
      c.query<{ org_id: string; target_id: string; meta: unknown }>("SELECT org_id, target_id, meta FROM audit_events WHERE action = 'group:invite_auto_accepted' ORDER BY org_id"),
    );
    expect(audit.rows.map((r) => [r.org_id, r.target_id])).toEqual([[ORG_A, groupA], [ORG_B, groupB]]);
    expect(JSON.stringify(audit.rows)).not.toContain('@');
    expect(sharing.events.filter((e) => e.name === 'sharing.group.invite_auto_accepted')).toHaveLength(2);
    // Claimed once: a second call finds nothing.
    expect(await sharing.invites.claimPendingForEmail(carol, 'carol@example.test')).toEqual({ joined: [], upgraded: [], skipped: [] });
    // Leave no open invite behind for the later tests.
    await sharing.invites.revoke(asAlice(ORG_A), groupA, danaInvite);
  });

  it('upgrades an existing member and never downgrades one', async () => {
    const group = await newGroup(ORG_A, 'Trip');
    await db.system.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.rls_bypass', 'on', true)`;
      await tx.groupMember.create({ data: { groupId: group, orgId: ORG_A, userId: dana, role: 'viewer' } });
    });
    await plant(ORG_A, group, 'dana@example.test', 'admin');
    expect(await sharing.invites.claimPendingForEmail(dana, 'dana@example.test')).toMatchObject({ upgraded: [group], joined: [] });
    expect(await roleOf(ORG_A, group, dana)).toBe('admin');

    // The partial unique index admits a new pending row once the first was accepted.
    const lower = await plant(ORG_A, group, 'dana@example.test', 'viewer');
    expect(await sharing.invites.claimPendingForEmail(dana, 'dana@example.test')).toEqual({ joined: [], upgraded: [], skipped: [lower] });
    expect(await roleOf(ORG_A, group, dana)).toBe('admin');
    expect((await inviteRow(lower)).rows[0]!.accepted_at).not.toBeNull();
  });

  it('skips expired and revoked invites, and never claims another user\'s', async () => {
    const group = await newGroup(ORG_A, 'Old');
    const expired = await plant(ORG_A, group, 'carol@example.test', 'viewer', { expiresAt: new Date(Date.now() - 86_400_000) });
    const revoked = await plant(ORG_A, group, 'carol@example.test', 'viewer', { revokedAt: new Date() });
    expect(await sharing.invites.claimPendingForEmail(carol, 'carol@example.test')).toEqual({ joined: [], upgraded: [], skipped: [] });
    expect(await roleOf(ORG_A, group, carol)).toBeNull();
    for (const id of [expired, revoked]) expect((await inviteRow(id)).rows[0]!.accepted_at).toBeNull();

    const open = await plant(ORG_A, group, 'dana@example.test', 'viewer');
    // Carol cannot claim Dana's invite, by naming Dana's address or by naming nothing of hers.
    expect(await sharing.invites.claimPendingForEmail(carol, 'dana@example.test')).toEqual({ joined: [], upgraded: [], skipped: [] });
    expect((await inviteRow(open)).rows[0]!.accepted_at).toBeNull();
    expect(await sharing.invites.claimPendingForUser(carol)).toEqual({ joined: [], upgraded: [], skipped: [] });
    await sharing.invites.revoke(asAlice(ORG_A), group, open); // leave no open invite behind
  });

  it('claims each user\'s invites independently, in the organization each belongs to', async () => {
    const full = await newGroup(ORG_A, 'Solo');
    const roomy = await newGroup(ORG_B, 'Roomy');
    // (Per-invite failure isolation is proven in the unit spec; here: two users, two organizations, no crosstalk.)
    const first = await plant(ORG_A, full, 'dana@example.test', 'viewer');
    const second = await plant(ORG_B, roomy, 'carol@example.test', 'viewer');
    expect(await sharing.invites.claimPendingForEmail(dana, 'dana@example.test')).toMatchObject({ joined: [full] });
    expect(await sharing.invites.claimPendingForEmail(carol, 'carol@example.test')).toMatchObject({ joined: [roomy] });
    for (const id of [first, second]) expect((await inviteRow(id)).rows[0]!.accepted_at).not.toBeNull();
  });
});
