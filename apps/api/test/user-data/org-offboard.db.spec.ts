// =============================================================================
// Real Postgres: organization offboarding (#743)
// =============================================================================
//
// Two organizations on a throwaway RLS database; offboarding one deletes only
// its org-owned rows (AI runs and usage, storage objects and chunks, org
// settings), its invites and memberships and the organization row. With
// `userDisposition: 'purge'` the members left without any organization are
// purged and deleted; a member of the other organization is kept, and the
// other organization is untouched.
// =============================================================================

import { resolveDbSuite } from '../jobs/db-test-support';
import { createRlsDatabase, ORG_A, ORG_B, type RlsDatabase } from '../helpers/rls-database.helper';
import { seedOrgs } from '../sharing/sharing-db.helper';
import { ownedCounts, runningJob, seedRichUser, sys, userDataServices, type UserDataDb } from './user-data-db.helper';

const { describeWithDb } = resolveDbSuite('org-offboard.db.spec');

describeWithDb('org.offboard (real Postgres, RLS on)', () => {
  let db: RlsDatabase;
  let svc: UserDataDb;

  beforeAll(async () => {
    db = await createRlsDatabase('offboard');
    await seedOrgs(db, [
      [ORG_A, 'org-a'],
      [ORG_B, 'org-b'],
    ]);
    svc = userDataServices(db);
  }, 240_000);

  afterAll(async () => {
    await svc?.close();
    await db?.destroy();
  }, 60_000);

  const orgRows = (orgId: string) =>
    sys(db, async (tx) => ({
      aiRuns: await tx.aiRun.count({ where: { orgId } }),
      usage: await tx.aiUsageEvent.count({ where: { orgId } }),
      objects: await tx.storageObject.count({ where: { orgId } }),
      chunks: await tx.storageObjectChunk.count({ where: { orgId } }),
      memberships: await tx.membership.count({ where: { orgId } }),
      invites: await tx.invite.count({ where: { orgId } }),
      settings: await tx.orgSettings.count({ where: { orgId } }),
      org: await tx.organization.count({ where: { id: orgId } }),
    }));

  it('purges only the offboarded organization and, with purge, the users it leaves without one', async () => {
    const alice = await seedRichUser(db, 'alice@example.test', [ORG_A]);
    const bob = await seedRichUser(db, 'bob@example.test', [ORG_A, ORG_B]);
    const carol = await seedRichUser(db, 'carol@example.test', [ORG_B]);
    const admin = await seedRichUser(db, 'admin@example.test', [ORG_B]);
    await sys(db, async (tx) => {
      await tx.invite.create({ data: { orgId: ORG_A, email: 'new@example.test' } });
      await tx.invite.create({ data: { orgId: ORG_B, email: 'new@example.test' } });
      await tx.orgSettings.create({ data: { orgId: ORG_A, value: {} } });
      await tx.orgSettings.create({ data: { orgId: ORG_B, value: {} } });
    });
    const beforeB = await orgRows(ORG_B);
    const job = await runningJob(db, 'org.offboard', { orgId: ORG_A, actorUserId: admin.userId, userDisposition: 'purge' }, { type: 'organization', id: ORG_A });

    await svc.offboard.process(job);

    expect(await orgRows(ORG_A)).toEqual({ aiRuns: 0, usage: 0, objects: 0, chunks: 0, memberships: 0, invites: 0, settings: 0, org: 0 });
    expect(await orgRows(ORG_B)).toEqual(beforeB);
    const users = await sys(db, (tx) => tx.user.findMany({ select: { id: true } }));
    const ids = users.map((u: { id: string }) => u.id);
    expect(ids).not.toContain(alice.userId);
    expect(ids).toEqual(expect.arrayContaining([bob.userId, carol.userId, admin.userId]));
    // Bob keeps his own data outside the offboarded organization.
    expect((await ownedCounts(db, bob.userId)).Membership).toBe(1);
    expect((await ownedCounts(db, bob.userId)).PersonalAccessToken).toBe(1);
    expect(svc.storage.deleted).toEqual(expect.arrayContaining([...alice.objectKeys, bob.objectKeys[0]]));
    expect(svc.storage.deleted).not.toContain(carol.objectKeys[0]);

    const stored = await sys(db, (tx) => tx.job.findUnique({ where: { id: job.id } }));
    const counts = (stored.payload as { result: { counts: Record<string, number> } }).result.counts;
    expect(counts).toMatchObject({ memberships: 2, invites: 1, usersPurged: 1, organizations: 1 });
    expect(svc.audit.map((event) => event.action)).toContain('org.offboard.completed');
  });
});
