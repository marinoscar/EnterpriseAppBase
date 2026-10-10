// The factory reset and organization offboarding handlers (#743), against an
// in-memory client: what goes, what stays, nodes, steps, storage tolerance,
// retry accumulation, the default organization.

import { registerModelOwnership, registerUserOwnedModels } from '../../src/core/index';
import { JobHandlerRegistry } from '../../src/jobs/index';
import { registerKeyPrefix } from '../../src/storage/index';
import { parsePrismaSchema } from '../../src/testing/index';
import {
  FactoryResetHandler,
  OrgOffboardHandler,
  UserDataPlanService,
  UserPurgeRunner,
  registerFactoryResetStep,
  registerPlatformUserData,
  resolveUserDataModuleOptions,
} from '../../src/user-data/index';
import { createFakeDb, type FakeDb } from './fake-db';

const ACTOR = '00000000-0000-4000-8000-0000000000a1';
const BOB = '00000000-0000-4000-8000-0000000000b2';
const CAROL = '00000000-0000-4000-8000-0000000000c3';
const DEFAULT_ORG = '00000000-0000-4000-8000-0000000000d0';
const ACME = '00000000-0000-4000-8000-0000000000e1';
const JOB = '00000000-0000-4000-8000-00000000f001';

const datamodel = parsePrismaSchema(`
model User { id String @id }
model Organization { id String @id }
model Notification {
  id String @id
  userId String
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
}
model StorageObject {
  id String @id
  storageKey String
  s3UploadId String?
  uploadedById String?
  orgId String
  uploadedBy User? @relation(fields: [uploadedById], references: [id], onDelete: SetNull)
  org Organization @relation(fields: [orgId], references: [id], onDelete: Restrict)
}
model AiRun {
  id String @id
  userId String?
  orgId String
  user User? @relation(fields: [userId], references: [id], onDelete: SetNull)
  org Organization @relation(fields: [orgId], references: [id], onDelete: Restrict)
}
model OrgSettings {
  id String @id
  orgId String
  org Organization @relation(fields: [orgId], references: [id], onDelete: Cascade)
}
model Job { id String @id }
`);

const steps: string[] = [];
beforeAll(() => {
  registerUserOwnedModels([
    { model: 'Notification', ownerField: 'userId', purge: 'delete', export: 'include', rationale: 'r' },
    { model: 'StorageObject', ownerField: 'uploadedById', purge: 'detach', export: 'include', rationale: 'r' },
    { model: 'AiRun', ownerField: 'userId', purge: 'detach', export: 'include', rationale: 'r' },
  ]);
  registerModelOwnership([
    { model: 'StorageObject', kind: 'org', rationale: 'r' },
    { model: 'AiRun', kind: 'org', rationale: 'r' },
    { model: 'OrgSettings', kind: 'org', rationale: 'r' },
  ]);
  registerPlatformUserData();
  registerKeyPrefix({ id: 'database-backups', prefix: 'database-backups/', owner: 'db-backup', description: 'Backups.', survivesFactoryReset: true });
  registerFactoryResetStep({
    id: 'app.catalog',
    phase: 'before-users',
    async run() {
      steps.push('app.catalog');
      return { rows: 2 };
    },
  });
});

function seed(): Record<string, any[]> {
  return {
    user: [{ id: ACTOR, email: 'admin@x.test' }, { id: BOB, email: 'bob@x.test' }, { id: CAROL, email: 'carol@x.test' }],
    organization: [{ id: DEFAULT_ORG, isDefault: true }, { id: ACME, isDefault: false }],
    membership: [
      { id: 'm1', orgId: DEFAULT_ORG, userId: ACTOR, roleId: 'r-member', status: 'active' },
      { id: 'm2', orgId: ACME, userId: BOB, roleId: 'r-member' },
      { id: 'm3', orgId: ACME, userId: CAROL, roleId: 'r-member' },
      { id: 'm4', orgId: DEFAULT_ORG, userId: CAROL, roleId: 'r-member' },
    ],
    invite: [{ id: 'inv1', orgId: ACME }, { id: 'inv2', orgId: DEFAULT_ORG }],
    role: [{ id: 'r-admin', name: 'org_admin' }, { id: 'r-member', name: 'contributor' }],
    notification: [{ id: 'n1', userId: ACTOR }, { id: 'n2', userId: BOB }],
    aiRun: [{ id: 'a1', userId: BOB, orgId: ACME }, { id: 'a2', userId: null, orgId: DEFAULT_ORG }],
    orgSettings: [{ id: 'os1', orgId: DEFAULT_ORG }, { id: 'os2', orgId: ACME }],
    storageObject: [
      { id: 's1', storageKey: 'uploads/s1', s3UploadId: null, uploadedById: BOB, orgId: ACME },
      { id: 's2', storageKey: 'uploads/s2', s3UploadId: null, uploadedById: null, orgId: DEFAULT_ORG },
      { id: 's3', storageKey: 'database-backups/s3', s3UploadId: null, uploadedById: null, orgId: ACME },
    ],
    workerNode: [
      { id: 'w1', name: 'alpha', createdById: ACTOR },
      { id: 'w2', name: 'beta', createdById: BOB },
      { id: 'w3', name: 'alpha', createdById: CAROL },
    ],
    nodeCredential: [{ id: 'nc1', userId: BOB }],
    notificationBroadcast: [{ id: 'b1' }],
    deviceCode: [{ id: 'd1', userId: null }],
    jobStatsRollup: [{ type: 'x' }],
    allowedEmail: [{ id: 'ae1', email: 'admin@x.test', claimedById: ACTOR }, { id: 'ae2', email: 'bob@x.test', claimedById: BOB }],
    databaseBackupRun: [{ id: 'br1', jobId: 'backup-job' }],
    job: [
      { id: JOB, status: 'running', type: 'admin.factory_reset', payload: { actorUserId: ACTOR } },
      { id: 'backup-job', status: 'succeeded' },
      { id: 'old-1', status: 'succeeded' },
      { id: 'pending-acme', status: 'pending', orgId: ACME },
      { id: 'running-1', status: 'running' },
    ],
  };
}

function build(fake: FakeDb, failKeys: string[] = []) {
  const options = resolveUserDataModuleOptions({
    datamodel,
    factoryReset: { keepJobsReferencedBy: [{ model: 'DatabaseBackupRun', field: 'jobId' }] },
  });
  const plans = new UserDataPlanService(options);
  const storage = { delete: jest.fn(async (key: string) => { if (failKeys.includes(key)) throw new Error('down'); }), abortMultipartUpload: jest.fn() };
  const audit = { record: jest.fn(async () => undefined) };
  const runner = new UserPurgeRunner(fake as any, storage as any, plans, { enqueue: jest.fn() } as any, audit, options);
  const reg = new JobHandlerRegistry();
  return {
    factory: new FactoryResetHandler(reg, fake as any, storage as any, plans, runner, audit, options),
    offboard: new OrgOffboardHandler(reg, fake as any, storage as any, plans, runner, audit, options),
    storage,
    audit,
  };
}

const ids = (rows: any[] | undefined) => (rows ?? []).map((row) => row.id).sort();

describe('admin.factory_reset', () => {
  it('deletes everything but the actor, configuration, backups, running jobs and surviving prefixes', async () => {
    const fake = createFakeDb(seed());
    const { factory, audit } = build(fake);
    await factory.process(fake.tables.job!.find((r) => r.id === JOB) as any);

    expect(ids(fake.tables.user)).toEqual([ACTOR]);
    expect(ids(fake.tables.job)).toEqual(['backup-job', JOB, 'running-1'].sort());
    expect(fake.tables.notification).toEqual([]);
    expect(fake.tables.aiRun).toEqual([]);
    expect(ids(fake.tables.orgSettings)).toContain('os1'); // configuration kept (Acme's cascades with Acme in Postgres)
    expect(ids(fake.tables.storageObject)).toEqual(['s3']); // the backup archive survives...
    expect(fake.tables.storageObject![0]!.orgId).toBe(DEFAULT_ORG); // ...moved to the default org
    expect(ids(fake.tables.organization)).toEqual([DEFAULT_ORG]);
    expect(fake.tables.membership!.find((m) => m.userId === ACTOR)).toMatchObject({ orgId: DEFAULT_ORG, roleId: 'r-admin' });
    expect(fake.tables.notificationBroadcast).toEqual([]);
    expect(fake.tables.deviceCode).toEqual([]);
    expect(fake.tables.jobStatsRollup).toEqual([]);
    expect(ids(fake.tables.allowedEmail)).toEqual(['ae1']);
    // Nodes: beta moves to the actor; Carol's "alpha" clashes with the actor's and is removed.
    expect(fake.tables.workerNode!.map((n) => [n.id, n.createdById]).sort()).toEqual([['w1', ACTOR], ['w2', ACTOR]]);
    expect(fake.tables.nodeCredential![0]!.userId).toBe(ACTOR);
    expect(steps).toContain('app.catalog');

    const result = fake.tables.job!.find((r) => r.id === JOB)!.payload.result.counts;
    expect(result).toMatchObject({ users: 2, workerNodesReassigned: 1, workerNodesRemoved: 1, organizations: 1, 'step.app.catalog.rows': 2 });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'admin.factory_reset.completed', actorUserId: ACTOR }));
  });

  it('is retry-safe: a second run deletes nothing more and keeps the counts', async () => {
    const fake = createFakeDb(seed());
    const { factory } = build(fake);
    const row = () => fake.tables.job!.find((r) => r.id === JOB) as any;
    await factory.process(row());
    const first = row().payload.result.counts;
    await factory.process(row());
    const second = row().payload.result.counts;
    expect(second.users).toBe(first.users);
    expect(second.jobs).toBe(first.jobs);
    expect(ids(fake.tables.user)).toEqual([ACTOR]);
  });

  it('keeps an object the provider refuses, counts it and still succeeds', async () => {
    const fake = createFakeDb(seed());
    const { factory } = build(fake, ['uploads/s2']);
    await factory.process(fake.tables.job!.find((r) => r.id === JOB) as any);
    expect(ids(fake.tables.storageObject)).toEqual(['s2', 's3']);
    expect(fake.tables.job!.find((r) => r.id === JOB)!.payload.result.counts.storageObjectsFailed).toBe(1);
  });

  it('fails before deleting anything when the actor is gone', async () => {
    const fake = createFakeDb(seed());
    const { factory } = build(fake);
    await expect(factory.process({ id: JOB, payload: { actorUserId: '00000000-0000-4000-8000-000000000999' } } as any)).rejects.toThrow(/does not exist/);
    expect(fake.tables.user).toHaveLength(3);
  });
});

describe('org.offboard', () => {
  const offboardJob = (disposition: 'keep' | 'purge') => ({
    id: 'off-1',
    status: 'running',
    payload: { orgId: ACME, actorUserId: ACTOR, userDisposition: disposition },
  });

  it('purges only that organization, keeping its orphaned members by default', async () => {
    const fake = createFakeDb(seed());
    fake.tables.job!.push(offboardJob('keep'));
    const { offboard } = build(fake);
    await offboard.process(fake.tables.job!.find((r) => r.id === 'off-1') as any);

    expect(ids(fake.tables.organization)).toEqual([DEFAULT_ORG]);
    expect(ids(fake.tables.aiRun)).toEqual(['a2']);
    expect(ids(fake.tables.orgSettings)).toEqual(['os1']);
    expect(ids(fake.tables.storageObject)).toEqual(['s2']);
    expect(ids(fake.tables.invite)).toEqual(['inv2']);
    expect(ids(fake.tables.membership)).toEqual(['m1', 'm4']);
    expect(ids(fake.tables.user)).toEqual([ACTOR, BOB, CAROL].sort());
    expect(fake.tables.job!.find((r) => r.id === 'pending-acme')).toBeUndefined();
    const result = fake.tables.job!.find((r) => r.id === 'off-1')!.payload.result.counts;
    expect(result).toMatchObject({ memberships: 2, invites: 1, usersKept: 1, organizations: 1 });
  });

  it('purges and deletes the members left without an organization when asked', async () => {
    const fake = createFakeDb(seed());
    fake.tables.job!.push(offboardJob('purge'));
    const { offboard } = build(fake);
    await offboard.process(fake.tables.job!.find((r) => r.id === 'off-1') as any);
    expect(ids(fake.tables.user)).toEqual([ACTOR, CAROL].sort()); // Carol is still in the default org
    expect(ids(fake.tables.notification)).toEqual(['n1']);
  });

  it('fails while a storage object is kept, so the organization stays for a retry', async () => {
    const fake = createFakeDb(seed());
    fake.tables.job!.push(offboardJob('keep'));
    const { offboard } = build(fake, ['uploads/s1']);
    await expect(offboard.process(fake.tables.job!.find((r) => r.id === 'off-1') as any)).rejects.toThrow(/could not be deleted/);
    expect(ids(fake.tables.organization)).toEqual([ACME, DEFAULT_ORG].sort());
  });

  it('refuses the default organization', async () => {
    const fake = createFakeDb(seed());
    const { offboard } = build(fake);
    await expect(offboard.process({ id: 'x', payload: { orgId: DEFAULT_ORG, actorUserId: ACTOR } } as any)).rejects.toThrow(/default organization/);
  });
});
