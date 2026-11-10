// =============================================================================
// Real Postgres: the per-user purge (#743)
// =============================================================================
//
// On a throwaway database owned by an ORDINARY role (row-level security is
// live, so a purge that relied on a tenant scope would miss rows in the other
// organization and these assertions would fail):
//
//   - `everything` deletes the caller's PATs, device codes, push
//     subscriptions, notifications and deliveries, AI runs, usage and keys,
//     user credentials, settings and storage objects (bytes, then rows), in
//     BOTH organizations, and clears displayName and profileImageUrl;
//   - the account, identities, roles, refresh tokens, allowlist entry,
//     memberships and audit events remain, as do the other user's rows;
//   - every foreign key holds (the transaction commits);
//   - the kept list is derived from the registry;
//   - a provider failure keeps the row and a retry finishes it.
// =============================================================================

import { userDataModelRegistry } from '@marinoscar/platform-api/user-data';

import { resolveDbSuite } from '../jobs/db-test-support';
import { createRlsDatabase, ORG_A, ORG_B, type RlsDatabase } from '../helpers/rls-database.helper';
import { seedOrgs } from '../sharing/sharing-db.helper';
import { ownedCounts, runningJob, seedRichUser, sys, userDataServices, type UserDataDb } from './user-data-db.helper';

const { describeWithDb } = resolveDbSuite('user-data-purge.db.spec');

describeWithDb('user.data.purge (real Postgres, RLS on)', () => {
  let db: RlsDatabase;
  let svc: UserDataDb;

  beforeAll(async () => {
    db = await createRlsDatabase('udpurge');
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

  it('the plan keeps exactly the models the registry marks keep', () => {
    const kept = userDataModelRegistry
      .list()
      .filter((hint) => hint.keep !== undefined)
      .map((hint) => hint.model)
      .sort();
    expect(kept).toEqual(['GroupMember', 'Grant', 'Membership', 'NodeCredential', 'RefreshToken', 'UserIdentity', 'UserRole', 'WorkerNode'].sort());
  });

  it('everything deletes the caller\'s data in every organization and keeps the account and other users', async () => {
    const me = await seedRichUser(db, 'me@example.test', [ORG_A, ORG_B]);
    const other = await seedRichUser(db, 'other@example.test', [ORG_A]);
    const job = await runningJob(db, 'user.data.purge', { userId: me.userId, scope: 'everything' }, { type: 'user', id: me.userId });

    const result = await svc.runner.runJob(job, { userId: me.userId, scope: 'everything' });

    const mine = await ownedCounts(db, me.userId);
    expect(mine).toEqual({
      UserIdentity: 1,
      UserRole: 1,
      RefreshToken: 1,
      AllowedEmail: 1,
      AuditEvent: 1,
      Membership: 2,
      PersonalAccessToken: 0,
      DeviceCode: 0,
      PushSubscription: 0,
      Notification: 0,
      NotificationDelivery: 0,
      AiRun: 0,
      AiUsageEvent: 0,
      UserAiKey: 0,
      UserCredential: 0,
      UserSettings: 0,
      StorageObject: 0,
    });
    const user = await sys(db, (tx) => tx.user.findUnique({ where: { id: me.userId } }));
    expect(user).toMatchObject({ displayName: null, profileImageUrl: null, email: 'me@example.test' });

    const theirs = await ownedCounts(db, other.userId);
    expect(Object.values(theirs).every((n) => n >= 1)).toBe(true);

    expect(svc.storage.deleted.sort()).toEqual([...me.objectKeys].sort());
    expect(result).toMatchObject({ storageObjectsDeleted: 2, storageObjectsFailed: 0 });
    expect(result.categories).toMatchObject({ credentials: 3, notifications: 3, ai: 5, settings: 1, files: 2 });
    const stored = await sys(db, (tx) => tx.job.findUnique({ where: { id: job.id } }));
    expect((stored.payload as { result: unknown }).result).toEqual(result);
  });

  it('keeps an object the provider refuses, and a retry after the row step finishes it and adds to the counts', async () => {
    const me = await seedRichUser(db, 'retry@example.test', [ORG_A]);
    const job = await runningJob(db, 'user.data.purge', { userId: me.userId, scope: 'everything' }, { type: 'user', id: me.userId });
    svc.storage.failKeys.add(me.objectKeys[0]!);

    const first = await svc.runner.runJob(job, { userId: me.userId, scope: 'everything' });
    expect(first.storageObjectsFailed).toBe(1);
    expect((await ownedCounts(db, me.userId)).StorageObject).toBe(1);

    svc.storage.failKeys.clear();
    const reread = await sys(db, (tx) => tx.job.findUnique({ where: { id: job.id } }));
    const second = await svc.runner.runJob(reread, { userId: me.userId, scope: 'everything' });
    expect(second.storageObjectsFailed).toBe(0);
    expect(second.storageObjectsDeleted).toBe(1);
    expect(second.models.PersonalAccessToken).toBe(1); // read back from the payload, not lost
    expect((await ownedCounts(db, me.userId)).StorageObject).toBe(0);
  });

  it('dedups a second request onto the purge in flight', async () => {
    const me = await seedRichUser(db, 'dedup@example.test', [ORG_A]);
    const input = { type: 'user.data.purge', reason: 'rerun' as const, subjectType: 'user', subjectId: me.userId, payload: { userId: me.userId, scope: 'everything' }, orgId: null };
    const first = await svc.jobs.enqueue(input);
    const second = await svc.jobs.enqueue({ ...input, payload: { userId: me.userId, scope: 'content' } });
    expect(second.id).toBe(first.id);
  });
});
