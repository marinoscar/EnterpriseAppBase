// The per-user purge (#743): registry-driven decisions, retry accumulation,
// storage tolerance, delegates, the legacy alias and the handler contracts.

import { registerUserOwnedModels } from '../../src/core/index';
import { JobHandlerRegistry } from '../../src/jobs/index';
import { parsePrismaSchema } from '../../src/testing/index';
import {
  FactoryResetHandler,
  LegacyUserDataPurgeHandler,
  LegacyUserDataPurgeHandlers,
  OrgOffboardHandler,
  UserDataPlanService,
  UserDataPurgeHandler,
  UserPurgeRunner,
  registerPlatformUserData,
  registerUserDataCategory,
  registerUserDataModels,
  registerUserDataScope,
  resolveUserDataModuleOptions,
} from '../../src/user-data/index';
import { createFakeDb, type FakeDb } from './fake-db';

const USER = '00000000-0000-4000-8000-0000000000a1';
const OTHER = '00000000-0000-4000-8000-0000000000b2';
const JOB = '00000000-0000-4000-8000-00000000f001';

const datamodel = parsePrismaSchema(`
model User {
  id String @id
  displayName String?
  profileImageUrl String?
}
model UserIdentity {
  id String @id
  userId String
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
}
model PersonalAccessToken {
  id String @id
  userId String
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
}
model Notification {
  id String @id
  userId String
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
}
model UserSettings {
  id String @id
  userId String
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
}
model StorageObject {
  id String @id
  storageKey String
  size BigInt
  s3UploadId String?
  uploadedById String?
  uploadedBy User? @relation(fields: [uploadedById], references: [id], onDelete: SetNull)
  transcripts Transcript[]
}
model Transcript {
  id String @id
  userId String
  audioObjectId String?
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  audio StorageObject? @relation(fields: [audioObjectId], references: [id], onDelete: SetNull)
}
model GraphNode {
  id String @id
  userId String
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
}
model Job {
  id String @id
}
`);

beforeAll(() => {
  registerUserOwnedModels([
    { model: 'UserIdentity', ownerField: 'userId', purge: 'delete', export: 'include', rationale: 'r' },
    { model: 'PersonalAccessToken', ownerField: 'userId', purge: 'delete', export: 'include', rationale: 'r' },
    { model: 'Notification', ownerField: 'userId', purge: 'delete', export: 'include', rationale: 'r' },
    { model: 'UserSettings', ownerField: 'userId', purge: 'delete', export: 'include', rationale: 'r' },
    { model: 'StorageObject', ownerField: 'uploadedById', purge: 'detach', export: 'include', rationale: 'r' },
    { model: 'Transcript', ownerField: 'userId', purge: 'delete', export: 'include', rationale: 'r' },
    { model: 'GraphNode', ownerField: 'userId', purge: 'delete', export: 'include', rationale: 'r' },
  ]);
  registerPlatformUserData();
  registerUserDataCategory({ id: 'transcripts', label: 'Transcripts', description: 'd', content: true });
  registerUserDataCategory({ id: 'graph', label: 'Graph', description: 'd', content: true });
  registerUserDataModels([
    { model: 'Transcript', category: 'transcripts', storageObjectColumns: ['audioObjectId'] },
    { model: 'GraphNode', category: 'graph', delegate: { jobType: 'kg.purge', payload: (userId) => ({ userId }) } },
  ]);
  registerUserDataScope({ id: 'transcripts', label: 'Transcripts', description: 'd', categories: ['transcripts'], confirmation: 'TRANSCRIPTS', layer: 'specific' });
});

function seed(): Record<string, any[]> {
  return {
    user: [
      { id: USER, displayName: 'Me', profileImageUrl: '/a.png' },
      { id: OTHER, displayName: 'Them', profileImageUrl: null },
    ],
    userIdentity: [{ id: 'i1', userId: USER }],
    personalAccessToken: [{ id: 'p1', userId: USER }, { id: 'p2', userId: OTHER }],
    notification: [{ id: 'n1', userId: USER }, { id: 'n2', userId: USER }, { id: 'n3', userId: OTHER }],
    userSettings: [{ id: 's1', userId: USER }],
    storageObject: [
      { id: 'o1', storageKey: 'uploads/o1', size: 10, s3UploadId: null, uploadedById: USER },
      { id: 'o2', storageKey: 'uploads/o2', size: 5, s3UploadId: 'u-2', uploadedById: USER },
      { id: 'o3', storageKey: 'uploads/o3', size: 1, s3UploadId: null, uploadedById: OTHER },
      { id: 'o4', storageKey: 'ai/o4', size: 7, s3UploadId: null, uploadedById: null },
    ],
    transcript: [{ id: 't1', userId: USER, audioObjectId: 'o4' }],
    graphNode: [{ id: 'g1', userId: USER }],
    job: [
      { id: JOB, status: 'running', subjectId: USER, payload: { userId: USER, scope: 'everything' } },
      { id: 'pending-about-n1', status: 'pending', subjectId: 'n1' },
      { id: 'running-about-n2', status: 'running', subjectId: 'n2' },
    ],
  };
}

function harness(fake: FakeDb, failKeys: string[] = []) {
  const options = resolveUserDataModuleOptions({ datamodel });
  const plans = new UserDataPlanService(options);
  const storage = {
    delete: jest.fn(async (key: string) => {
      if (failKeys.includes(key)) throw new Error('provider down');
    }),
    abortMultipartUpload: jest.fn(async () => undefined),
  };
  const jobs = { enqueue: jest.fn(async (input: any) => ({ id: 'delegated', status: 'pending', ...input })) };
  const audit = { record: jest.fn(async () => undefined) };
  const runner = new UserPurgeRunner(fake as any, storage as any, plans, jobs as any, audit, options);
  return { runner, storage, jobs, audit, plans, options };
}

const job = (fake: FakeDb): any => fake.tables.job!.find((row) => row.id === JOB)!;

describe('user.data.purge: everything', () => {
  it('deletes the caller\'s owned rows and objects, clears the profile fields, keeps the account and other users', async () => {
    const fake = createFakeDb(seed());
    const { runner, storage, jobs, audit } = harness(fake);
    const result = await runner.runJob(job(fake), { userId: USER, scope: 'everything' });

    expect(fake.tables.personalAccessToken!.map((r) => r.id)).toEqual(['p2']);
    expect(fake.tables.notification!.map((r) => r.id)).toEqual(['n3']);
    expect(fake.tables.userSettings).toEqual([]);
    expect(fake.tables.transcript).toEqual([]);
    expect(fake.tables.userIdentity).toHaveLength(1);
    expect(fake.tables.user!.find((u) => u.id === USER)).toMatchObject({ displayName: null, profileImageUrl: null });
    expect(fake.tables.user!.find((u) => u.id === OTHER)).toMatchObject({ displayName: 'Them' });
    // Own uploads and the transcript's audio (collected first), never the other user's.
    expect(fake.tables.storageObject!.map((r) => r.id)).toEqual(['o3']);
    expect(storage.abortMultipartUpload).toHaveBeenCalledWith('uploads/o2', 'u-2');
    expect(storage.delete).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({ storageObjectsDeleted: 3, storageObjectsFailed: 0, delegatedJobs: 1 });
    expect(result.categories).toMatchObject({ notifications: 2, credentials: 1, settings: 1, transcripts: 1, files: 3 });
    expect(jobs.enqueue).toHaveBeenCalledWith(expect.objectContaining({ type: 'kg.purge', subjectType: 'user', subjectId: USER, orgId: null }));
    expect(fake.tables.graphNode).toHaveLength(1); // delegated, not deleted inline
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'user_data.purge.completed', targetId: USER }));
    expect(job(fake).payload.result).toEqual(result);
  });

  it('writes the object ids to the payload before any row is deleted', async () => {
    const fake = createFakeDb(seed());
    const { runner } = harness(fake);
    await runner.runJob(job(fake), { userId: USER, scope: 'everything' });
    const firstDelete = fake.calls.findIndex((call) => call.op === 'deleteMany');
    const firstWrite = fake.calls.findIndex((call) => call.delegate === 'job' && call.op === 'update');
    expect(firstWrite).toBeLessThan(firstDelete);
    expect(fake.calls[firstWrite]!.args.data.payload.objectIds.sort()).toEqual(['o1', 'o2', 'o4']);
  });

  it('cancels pending jobs about deleted rows, never a running one nor itself', async () => {
    const fake = createFakeDb(seed());
    const { runner } = harness(fake);
    const result = await runner.runJob(job(fake), { userId: USER, scope: 'everything' });
    expect(fake.tables.job!.map((r) => r.id).sort()).toEqual([JOB, 'running-about-n2'].sort());
    expect(result.cancelledJobs).toBe(1);
  });
});

describe('user.data.purge: scopes', () => {
  it('content keeps credentials and settings', async () => {
    const fake = createFakeDb(seed());
    const { runner } = harness(fake);
    await runner.runJob(job(fake), { userId: USER, scope: 'content' });
    expect(fake.tables.personalAccessToken).toHaveLength(2);
    expect(fake.tables.userSettings).toHaveLength(1);
    expect(fake.tables.user!.find((u) => u.id === USER)!.displayName).toBe('Me');
    expect(fake.tables.notification!.map((r) => r.id)).toEqual(['n3']);
  });

  it('a narrow scope deletes only its categories', async () => {
    const fake = createFakeDb(seed());
    const { runner, jobs } = harness(fake);
    const result = await runner.runJob(job(fake), { userId: USER, scope: 'transcripts' });
    expect(fake.tables.transcript).toEqual([]);
    expect(fake.tables.notification).toHaveLength(3);
    expect(fake.tables.storageObject!.map((r) => r.id).sort()).toEqual(['o1', 'o2', 'o3']); // only the transcript's audio
    expect(jobs.enqueue).not.toHaveBeenCalled();
    expect(Object.keys(result.categories)).toEqual(['transcripts']);
  });

  it('refuses an unknown scope', async () => {
    const fake = createFakeDb(seed());
    const { runner } = harness(fake);
    await expect(runner.runJob(job(fake), { userId: USER, scope: 'nope' })).rejects.toThrow(/unknown scope/);
  });
});

describe('user.data.purge: retry safety', () => {
  it('keeps the row of an object the provider refuses, counts it and still succeeds', async () => {
    const fake = createFakeDb(seed());
    const { runner } = harness(fake, ['uploads/o1']);
    const result = await runner.runJob(job(fake), { userId: USER, scope: 'everything' });
    expect(result.storageObjectsFailed).toBe(1);
    expect(fake.tables.storageObject!.map((r) => r.id).sort()).toEqual(['o1', 'o3']);
  });

  it('adds to the counts an earlier attempt committed and unions its object ids', async () => {
    const fake = createFakeDb(seed());
    // An earlier attempt deleted the rows (committed with their counts) and then failed before the media.
    job(fake).payload = {
      userId: USER,
      scope: 'everything',
      objectIds: ['o9'],
      deleted: { models: { Notification: 4 }, categories: { notifications: 4 }, cancelledJobs: 2 },
    };
    fake.tables.storageObject!.push({ id: 'o9', storageKey: 'uploads/o9', size: 1, s3UploadId: null, uploadedById: null });
    const { runner } = harness(fake);
    const result = await runner.runJob(job(fake), { userId: USER, scope: 'everything' });
    expect(result.models.Notification).toBe(6);
    expect(result.cancelledJobs).toBe(3);
    expect(fake.tables.storageObject!.map((r) => r.id)).toEqual(['o3']);
    expect(result.storageObjectsDeleted).toBe(4);
  });
});

describe('handlers', () => {
  function registry(fake: FakeDb) {
    const { runner, options } = harness(fake);
    const reg = new JobHandlerRegistry();
    const purge = new UserDataPurgeHandler(reg, runner);
    const legacy = new LegacyUserDataPurgeHandlers(reg, runner, resolveUserDataModuleOptions({
      datamodel,
      legacyJobTypes: [{ type: 'user.data_reset', toPayload: (old) => ({ userId: String((old as { userId: string }).userId), scope: 'everything' }) }],
    }));
    const factory = new FactoryResetHandler(reg, fake as any, {} as any, new UserDataPlanService(options), runner, { record: jest.fn() } as any, options);
    const offboard = new OrgOffboardHandler(reg, fake as any, {} as any, new UserDataPlanService(options), runner, { record: jest.fn() } as any, options);
    for (const handler of [purge, legacy, factory, offboard]) handler.onModuleInit();
    return { reg, purge, factory, offboard, runner };
  }

  it('declares the three permanent types, their profiles, and no node eligibility', () => {
    const { reg, purge, factory, offboard } = registry(createFakeDb(seed()));
    expect([purge.type, factory.type, offboard.type]).toEqual(['user.data.purge', 'admin.factory_reset', 'org.offboard']);
    expect(purge.profile).toEqual({ maxRuntimeMs: 15 * 60_000, maxAttempts: 3 });
    expect(factory.profile).toEqual({ maxRuntimeMs: 30 * 60_000, maxAttempts: 3 });
    expect(offboard.profile).toEqual({ maxRuntimeMs: 60 * 60_000, maxAttempts: 3 });
    for (const handler of [purge, factory, offboard] as any[]) {
      expect(handler.nodeResultSchema).toBeUndefined();
      expect(handler.persistNodeResult).toBeUndefined();
    }
    expect(reg.serverOnlyTypes()).toEqual(expect.arrayContaining(['user.data.purge', 'admin.factory_reset', 'org.offboard', 'user.data_reset']));
  });

  it('runs a queued legacy job through the new work, mapping its payload', async () => {
    const fake = createFakeDb(seed());
    fake.tables.job!.push({ id: 'legacy-1', type: 'user.data_reset', status: 'running', payload: { userId: USER } });
    const { reg } = registry(fake);
    const legacy = reg.get('user.data_reset') as LegacyUserDataPurgeHandler;
    expect(legacy).toBeInstanceOf(LegacyUserDataPurgeHandler);
    await legacy.process(fake.tables.job!.find((r) => r.id === 'legacy-1') as any);
    expect(fake.tables.notification!.map((r) => r.id)).toEqual(['n3']);
    const payload = fake.tables.job!.find((r) => r.id === 'legacy-1')!.payload;
    expect(payload).toMatchObject({ userId: USER, scope: 'everything', result: { storageObjectsDeleted: 3 } });
  });

  it('rejects a malformed payload', async () => {
    const fake = createFakeDb(seed());
    const { purge } = registry(fake);
    await expect(purge.process({ id: 'x', payload: { userId: 'not-a-uuid' } } as any)).rejects.toThrow(/payload/);
  });
});

describe('user removal hooks', () => {
  it('resolve their provider across modules and prefix their counts with the hook id', async () => {
    const fake = createFakeDb(seed());
    const purge = { purgeUser: jest.fn(async (_userId: string) => ({ membershipsRemoved: 2, adminsPromoted: 1, groupsDeleted: 0, groupsOrphaned: 0 })) };
    const moduleRef = { get: jest.fn(() => purge) };
    const options = resolveUserDataModuleOptions({
      datamodel,
      userRemovalHooks: [{ id: 'sharing.group-memberships', inject: 'GroupMembershipPurge', run: async (p: typeof purge, userId: string) => ({ ...(await p.purgeUser(userId)) }) }],
    });
    const runner = new UserPurgeRunner(fake as any, {} as any, new UserDataPlanService(options), {} as any, { record: jest.fn() } as any, options, moduleRef as any);
    await expect(runner.runRemovalHooks(USER)).resolves.toMatchObject({ 'sharing.group-memberships.membershipsRemoved': 2, 'sharing.group-memberships.adminsPromoted': 1 });
    expect(moduleRef.get).toHaveBeenCalledWith('GroupMembershipPurge', { strict: false });
    expect(purge.purgeUser).toHaveBeenCalledWith(USER);
  });

  it('fail loudly when the provider is missing', async () => {
    const options = resolveUserDataModuleOptions({ datamodel, userRemovalHooks: [{ id: 'h', inject: 'Missing', run: async () => ({}) }] });
    const runner = new UserPurgeRunner({} as any, {} as any, new UserDataPlanService(options), {} as any, { record: jest.fn() } as any, options, { get: () => undefined } as any);
    await expect(runner.runRemovalHooks(USER)).rejects.toThrow(/not available/);
  });
});
