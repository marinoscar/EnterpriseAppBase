// =============================================================================
// Real Postgres: the admin factory reset (#743)
// =============================================================================
//
// On a throwaway RLS database: a full run satisfies every foreign key and
// keeps the actor, the access model, configuration, backups (their runs,
// archives and linked jobs) and the default organization with the actor as
// its org admin; a re-run deletes nothing more; a run interrupted by a
// failing step resumes on retry and accumulates its counts.
// =============================================================================

import { randomUUID } from 'node:crypto';

import { registerFactoryResetStep } from '@marinoscar/platform-api/user-data';

import { resolveDbSuite } from '../jobs/db-test-support';
import { createRlsDatabase, ORG_A, ORG_B, type RlsDatabase } from '../helpers/rls-database.helper';
import { seedOrgs } from '../sharing/sharing-db.helper';
import { ownedCounts, runningJob, seedRichUser, sys, userDataServices, type UserDataDb } from './user-data-db.helper';

const { describeWithDb } = resolveDbSuite('factory-reset.db.spec');

let failOnce = false;
registerFactoryResetStep({
  id: 'test.interrupt',
  phase: 'deployment',
  async run() {
    if (failOnce) {
      failOnce = false;
      throw new Error('interrupted on purpose');
    }
    return { ran: 1 };
  },
});

describeWithDb('admin.factory_reset (real Postgres, RLS on)', () => {
  let db: RlsDatabase;
  let svc: UserDataDb;

  beforeAll(async () => {
    db = await createRlsDatabase('freset');
    svc = userDataServices(db);
  }, 240_000);

  afterAll(async () => {
    await svc?.close();
    await db?.destroy();
  }, 60_000);

  /** A deployment: an actor, two users with data in two extra orgs, a backup, nodes, history. */
  async function seedDeployment() {
    await seedOrgs(db, [
      [ORG_A, 'org-a'],
      [ORG_B, 'org-b'],
    ]);
    const defaultOrg = await sys(db, (tx) => tx.organization.findFirstOrThrow({ where: { isDefault: true } }));
    const actor = await seedRichUser(db, `admin-${randomUUID().slice(0, 6)}@example.test`, [defaultOrg.id]);
    const bob = await seedRichUser(db, `bob-${randomUUID().slice(0, 6)}@example.test`, [ORG_A, defaultOrg.id]);
    const carol = await seedRichUser(db, `carol-${randomUUID().slice(0, 6)}@example.test`, [ORG_B]);
    const backupKey = `database-backups/${randomUUID()}.dump`;
    const backupJob = await sys(db, async (tx) => {
      const job = await tx.job.create({ data: { type: 'db.backup.run', reason: 'rerun', status: 'succeeded' } });
      await tx.databaseBackupRun.create({ data: { status: 'completed', trigger: 'manual', storageProvider: 's3', storageKey: backupKey, bucket: 'b', format: 'custom', jobId: job.id } });
      // An archive tracked as an object too: under a prefix that survives.
      await tx.storageObject.create({ data: { name: 'b.dump', size: 1, mimeType: 'application/octet-stream', storageKey: backupKey, orgId: ORG_A, status: 'ready' } });
      await tx.job.create({ data: { type: 'job.history.purge', reason: 'rerun', status: 'succeeded' } });
      await tx.workerNode.create({ data: { name: 'alpha', hostname: 'h', platform: 'linux', cliVersion: '1', concurrency: 1, createdById: actor.userId } });
      await tx.workerNode.create({ data: { name: 'beta', hostname: 'h', platform: 'linux', cliVersion: '1', concurrency: 1, createdById: bob.userId } });
      await tx.workerNode.create({ data: { name: 'alpha', hostname: 'h', platform: 'linux', cliVersion: '1', concurrency: 1, createdById: carol.userId } });
      await tx.notificationBroadcast.create({ data: { title: 't', body: 'b', eventKey: 'broadcast', channels: [] } });
      return job;
    });
    return { defaultOrg, actor, bob, carol, backupKey, backupJob };
  }

  it('deletes everything but the actor, configuration and backups, then re-runs cleanly', async () => {
    const d = await seedDeployment();
    const rolesBefore = await sys(db, (tx) => tx.role.count());
    const job = await runningJob(db, 'admin.factory_reset', { actorUserId: d.actor.userId });

    await svc.factory.process(job);

    const after = await sys(db, async (tx) => ({
      users: await tx.user.findMany({ select: { id: true } }),
      orgs: await tx.organization.findMany({ select: { id: true } }),
      memberships: await tx.membership.findMany({ where: { userId: d.actor.userId }, include: { role: true } }),
      roles: await tx.role.count(),
      backupRuns: await tx.databaseBackupRun.count(),
      backupJob: await tx.job.findUnique({ where: { id: d.backupJob.id } }),
      jobs: await tx.job.findMany({ select: { id: true } }),
      objects: await tx.storageObject.findMany({ select: { storageKey: true, orgId: true } }),
      nodes: await tx.workerNode.findMany({ select: { name: true, createdById: true } }),
      broadcasts: await tx.notificationBroadcast.count(),
      allowlist: await tx.allowedEmail.findMany({ select: { claimedById: true } }),
    }));
    expect(after.users.map((u: { id: string }) => u.id)).toEqual([d.actor.userId]);
    expect(after.orgs.map((o: { id: string }) => o.id)).toEqual([d.defaultOrg.id]);
    expect(after.memberships).toHaveLength(1);
    expect(after.memberships[0].role.name).toBe('org_admin');
    expect(after.roles).toBe(rolesBefore);
    expect(after.backupRuns).toBe(1);
    expect(after.backupJob).not.toBeNull();
    expect(after.jobs.map((j: { id: string }) => j.id).sort()).toEqual([d.backupJob.id, job.id].sort());
    expect(after.objects).toEqual([{ storageKey: d.backupKey, orgId: d.defaultOrg.id }]);
    expect(after.nodes.every((n: { createdById: string }) => n.createdById === d.actor.userId)).toBe(true);
    expect(after.nodes.map((n: { name: string }) => n.name).sort()).toEqual(['alpha', 'beta']);
    expect(after.broadcasts).toBe(0);
    expect(after.allowlist).toEqual([{ claimedById: d.actor.userId }]);
    const actorData = await ownedCounts(db, d.actor.userId);
    expect(actorData).toMatchObject({ PersonalAccessToken: 0, Notification: 0, StorageObject: 0, UserIdentity: 1, RefreshToken: 1 });

    const stored = await sys(db, (tx) => tx.job.findUnique({ where: { id: job.id } }));
    const counts = (stored.payload as { result: { counts: Record<string, number> } }).result.counts;
    expect(counts).toMatchObject({ users: 2, workerNodesReassigned: 1, workerNodesRemoved: 1, organizations: 2 });

    // A re-run of the same job deletes nothing more and keeps the counts.
    await svc.factory.process(stored);
    const again = await sys(db, (tx) => tx.job.findUnique({ where: { id: job.id } }));
    expect((again.payload as { result: { counts: Record<string, number> } }).result.counts.users).toBe(2);
    expect(await sys(db, (tx) => tx.user.count())).toBe(1);
  });

  it('resumes after an interrupted run and accumulates its counts', async () => {
    const d = await seedDeployment();
    const others = (await sys(db, (tx) => tx.user.count())) - 1; // the first test's actor is one of them
    const job = await runningJob(db, 'admin.factory_reset', { actorUserId: d.actor.userId });
    failOnce = true;
    await expect(svc.factory.process(job)).rejects.toThrow(/interrupted on purpose/);
    // Steps before the failure committed with their counts.
    const partial = await sys(db, (tx) => tx.job.findUnique({ where: { id: job.id } }));
    expect((partial.payload as { deleted: Record<string, number> }).deleted.users).toBe(others);
    expect(await sys(db, (tx) => tx.user.count())).toBe(1);

    await svc.factory.process(partial);
    const done = await sys(db, (tx) => tx.job.findUnique({ where: { id: job.id } }));
    const counts = (done.payload as { result: { counts: Record<string, number> } }).result.counts;
    expect(counts.users).toBe(others);
    expect(counts['step.test.interrupt.ran']).toBe(1);
    expect(await sys(db, (tx) => tx.organization.count())).toBe(1);
  });
});
