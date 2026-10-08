// =============================================================================
// The REAL user-data services over a row-level-security database (#743)
// =============================================================================
//
// Builds the slice's runner, handlers and services exactly as the app wires
// them (the app's `UserDataDbAdapter` over `PrismaSystemService`, the real
// `JobsService`, the planner reading the app's composed schema), on a
// throwaway database owned by an ORDINARY role (`createRlsDatabase`), so a
// row hidden by row-level security would make these suites fail. The storage
// provider and the audit sink are recording doubles.
//
// NOT A `*.spec.ts` FILE, so Jest never runs it as a suite.
// =============================================================================

import { randomUUID } from 'node:crypto';

import { JobsService } from '@marinoscar/platform-api/jobs';
import { readSchemaDatamodel } from '@marinoscar/platform-api/testing';
import {
  FactoryResetHandler,
  OrgOffboardHandler,
  UserDataPlanService,
  UserPurgeRunner,
  resolveUserDataModuleOptions,
  type UserRemovalHook,
} from '@marinoscar/platform-api/user-data';

// The app's registries, as the running app fills them.
import '../../src/prisma/ownership/user-owned-model.manifest';
import '../../src/prisma/ownership/model-ownership.manifest';
import '../../src/platform/storage/storage-key-prefix.manifest';
import '../../src/platform/user-data/user-data.manifest';
import { appSchemaPath } from '../../src/platform/user-data/user-data.config';
import { UserDataDbAdapter } from '../../src/platform/user-data/user-data-db.adapter';
import { rlsServices, type RlsDatabase } from '../helpers/rls-database.helper';

export interface UserDataDb {
  port: UserDataDbAdapter;
  runner: UserPurgeRunner;
  factory: FactoryResetHandler;
  offboard: OrgOffboardHandler;
  jobs: JobsService;
  storage: { deleted: string[]; failKeys: Set<string>; delete(key: string): Promise<void>; abortMultipartUpload(key: string, id: string): Promise<void> };
  audit: Array<{ action: string; meta?: unknown }>;
  close(): Promise<void>;
}

/** The slice over `db`, with an optional removal hook (the offboarding suite passes the sharing one). */
export function userDataServices(db: RlsDatabase, options: { userRemovalHooks?: UserRemovalHook[]; moduleRef?: { get(token: unknown, o: unknown): unknown } } = {}): UserDataDb {
  const { prisma, system, close } = rlsServices(db);
  const port = new UserDataDbAdapter(system);
  const resolved = resolveUserDataModuleOptions({
    datamodel: () => readSchemaDatamodel(appSchemaPath()),
    userRemovalHooks: options.userRemovalHooks ?? [],
    factoryReset: { keepJobsReferencedBy: [{ model: 'DatabaseBackupRun', field: 'jobId' }] },
  });
  const plans = new UserDataPlanService(resolved);
  plans.onModuleInit();
  const jobs = new JobsService(prisma as never);
  const deleted: string[] = [];
  const failKeys = new Set<string>();
  const storage = {
    deleted,
    failKeys,
    async delete(key: string) {
      if (failKeys.has(key)) throw new Error(`provider refused ${key}`);
      deleted.push(key);
    },
    async abortMultipartUpload() {},
  };
  const audit: UserDataDb['audit'] = [];
  const sink = { record: async (event: { action: string; meta?: unknown }) => void audit.push(event) };
  const runner = new UserPurgeRunner(port, storage as never, plans, jobs, sink as never, resolved, options.moduleRef as never);
  const registry = { register: () => undefined };
  return {
    port,
    runner,
    factory: new FactoryResetHandler(registry as never, port, storage as never, plans, runner, sink as never, resolved),
    offboard: new OrgOffboardHandler(registry as never, port, storage as never, plans, runner, sink as never, resolved),
    jobs,
    storage,
    audit,
    close,
  };
}

/** One transaction on the bypass pool of `db`. */
export function sys<T>(db: RlsDatabase, fn: (tx: any) => Promise<T>): Promise<T> {
  return db.system.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.rls_bypass', 'on', true)`;
    return fn(tx);
  });
}

/** A role row by name (created when absent). */
async function role(tx: any, name: string, scope: 'org' | 'system'): Promise<string> {
  const found = await tx.role.findFirst({ where: { name } });
  return (found ?? (await tx.role.create({ data: { name, description: name, scope } }))).id;
}

/** Creates a user with every kind of row the platform's categories cover, in `orgIds`. */
export async function seedRichUser(db: RlsDatabase, email: string, orgIds: string[]): Promise<{ userId: string; objectKeys: string[] }> {
  const userId = randomUUID();
  const tag = randomUUID().slice(0, 8);
  const objectKeys: string[] = [];
  await sys(db, async (tx) => {
    const viewer = await role(tx, 'viewer', 'org');
    const admin = await role(tx, 'admin', 'system');
    await tx.user.create({ data: { id: userId, email, providerDisplayName: email, displayName: `Name ${tag}`, profileImageUrl: `/img/${tag}` } });
    await tx.userIdentity.create({ data: { userId, provider: 'google', providerSubject: `sub-${tag}` } });
    await tx.userRole.create({ data: { userId, roleId: admin } });
    await tx.refreshToken.create({ data: { userId, tokenHash: `rt-${tag}`, expiresAt: new Date(Date.now() + 86_400_000) } });
    await tx.allowedEmail.create({ data: { email, claimedById: userId } });
    await tx.auditEvent.create({ data: { actorUserId: userId, action: 'test.seed', targetType: 'user', targetId: userId } });
    await tx.personalAccessToken.create({
      data: { userId, name: 'cli', tokenHash: `pat-${tag}`, tokenPrefix: 'pat_x', durationValue: 1, durationUnit: 'days', expiresAt: new Date(Date.now() + 86_400_000) },
    });
    await tx.deviceCode.create({ data: { userId, deviceCode: `dc-${tag}`, userCode: `UC-${tag}`, expiresAt: new Date(Date.now() + 600_000) } });
    await tx.pushSubscription.create({ data: { userId, endpoint: `https://push.example.test/${tag}`, p256dh: 'k', auth: 'a' } });
    await tx.notification.create({ data: { userId, eventKey: 'test', title: 't', body: 'b' } });
    await tx.notificationDelivery.create({ data: { userId, eventKey: 'test', recipient: email, channel: 'email' } });
    await tx.userAiKey.create({ data: { userId, provider: 'openai', secret: 'ciphertext' } });
    await tx.userCredential.create({ data: { userId, purpose: 'test', name: 'k', secret: 'ciphertext' } });
    await tx.userSettings.create({ data: { userId, value: { theme: 'dark' } } });
    for (const orgId of orgIds) {
      await tx.membership.create({ data: { orgId, userId, roleId: viewer, status: 'active' } });
      await tx.aiRun.create({ data: { userId, orgId, provider: 'openai', modelId: 'm', request: {} } });
      await tx.aiUsageEvent.create({ data: { userId, orgId, provider: 'openai', modelId: 'm', operation: 'chat', keySource: 'byok', latencyMs: 1, status: 'succeeded' } });
      const key = `uploads/${orgId}/${tag}.bin`;
      objectKeys.push(key);
      const object = await tx.storageObject.create({ data: { name: 'f.bin', size: 3, mimeType: 'application/octet-stream', storageKey: key, orgId, uploadedById: userId, status: 'ready' } });
      await tx.storageObjectChunk.create({ data: { objectId: object.id, orgId, partNumber: 1, eTag: 'e', size: 3 } });
    }
  });
  return { userId, objectKeys };
}

/** Rows of `userId` per model, read on the bypass pool. */
export async function ownedCounts(db: RlsDatabase, userId: string): Promise<Record<string, number>> {
  return sys(db, async (tx) => ({
    UserIdentity: await tx.userIdentity.count({ where: { userId } }),
    UserRole: await tx.userRole.count({ where: { userId } }),
    RefreshToken: await tx.refreshToken.count({ where: { userId } }),
    AllowedEmail: await tx.allowedEmail.count({ where: { claimedById: userId } }),
    AuditEvent: await tx.auditEvent.count({ where: { actorUserId: userId } }),
    Membership: await tx.membership.count({ where: { userId } }),
    PersonalAccessToken: await tx.personalAccessToken.count({ where: { userId } }),
    DeviceCode: await tx.deviceCode.count({ where: { userId } }),
    PushSubscription: await tx.pushSubscription.count({ where: { userId } }),
    Notification: await tx.notification.count({ where: { userId } }),
    NotificationDelivery: await tx.notificationDelivery.count({ where: { userId } }),
    AiRun: await tx.aiRun.count({ where: { userId } }),
    AiUsageEvent: await tx.aiUsageEvent.count({ where: { userId } }),
    UserAiKey: await tx.userAiKey.count({ where: { userId } }),
    UserCredential: await tx.userCredential.count({ where: { userId } }),
    UserSettings: await tx.userSettings.count({ where: { userId } }),
    StorageObject: await tx.storageObject.count({ where: { uploadedById: userId } }),
  }));
}

/** Inserts a running job row the handler under test can write its payload to. */
export async function runningJob(db: RlsDatabase, type: string, payload: Record<string, unknown>, subject?: { type: string; id: string }): Promise<any> {
  return sys(db, (tx) =>
    tx.job.create({
      data: {
        type,
        reason: 'rerun',
        status: 'running',
        payload,
        ...(subject ? { subjectType: subject.type, subjectId: subject.id } : {}),
      },
    }),
  );
}
