// The android-app data invariants on real Postgres (#746, PP-9.4):
//   - android_app_releases_one_current_uniq_idx arbitrates two concurrent
//     make-current calls: exactly one release stays current, the loser is 409;
//   - sizeBytes (BigInt) round-trips beyond 2^31 and is returned as a string;
//   - push_subscriptions.platform defaults to 'browser', its CHECK constraint
//     refuses anything else, and the subscribe upsert re-tags up, never down.
const ORIGINAL_KEY_ENV = process.env.SECRETS_ENCRYPTION_KEY;
process.env.SECRETS_ENCRYPTION_KEY ??= Buffer.alloc(32, 9).toString('base64');

import type { PrismaClient } from '@prisma/client';
import { Readable } from 'node:stream';
import { AndroidAppService, AndroidReleaseService, resolveAndroidAppModuleOptions } from '@marinoscar/platform-api/android-app';
import { SystemSettingsRowStore } from '@marinoscar/platform-api/settings';
import { InMemoryAuditSink } from '@marinoscar/platform-api/testing';

import { PushSubscriptionService } from '../notifications/support/notifications';
import { createDbClient, resolveDbSuite } from '../jobs/db-test-support';

const { describeWithDb } = resolveDbSuite('android-app-releases.db.spec');

const PACKAGE = `test.androiddb.p${process.pid}`;
const SHA = Array.from({ length: 32 }, (_, i) => ((i * 7 + 1) % 256).toString(16).toUpperCase().padStart(2, '0')).join(':');
const ENDPOINT = `https://fcm.googleapis.com/fcm/send/androiddb-${process.pid}`;

describeWithDb('android-app on real Postgres (#746)', () => {
  let client: PrismaClient;
  let releases: AndroidReleaseService;
  let userId: string;

  async function seedRelease(versionCode: number, isCurrent = false, sizeBytes = 1000n) {
    return client.androidAppRelease.create({
      data: {
        packageName: PACKAGE,
        versionName: `1.0.${versionCode}`,
        versionCode,
        signingSha256: SHA,
        fileSha256: 'a'.repeat(64),
        sizeBytes,
        storageKey: `android-releases/${PACKAGE}-${versionCode}.apk`,
        isCurrent,
      },
    });
  }

  beforeAll(async () => {
    client = createDbClient();
    await client.androidAppRelease.deleteMany({ where: { packageName: PACKAGE } });
    // The index is deployment-wide: no other release may be current while this runs.
    await client.androidAppRelease.updateMany({ where: { isCurrent: true }, data: { isCurrent: false } });
    const user = await client.user.create({ data: { email: `androiddb-${process.pid}@example.test` }, select: { id: true } });
    userId = user.id;
    const rows = new SystemSettingsRowStore(client as never);
    const androidApp = new AndroidAppService(client as never, rows);
    const storage = { upload: jest.fn(), delete: jest.fn(), download: jest.fn(async () => Readable.from([])) };
    const storageConfig = { resolve: jest.fn(async () => ({ configured: true, config: { provider: 's3', bucket: 'b' } })) };
    releases = new AndroidReleaseService(
      client as never,
      storage as never,
      storageConfig as never,
      androidApp,
      new InMemoryAuditSink(),
      resolveAndroidAppModuleOptions({ appName: 'Db Test', apkStem: 'db-test-android' }),
    );
  });

  afterAll(async () => {
    await client.androidAppRelease.deleteMany({ where: { packageName: PACKAGE } });
    await client.pushSubscription.deleteMany({ where: { endpoint: ENDPOINT } });
    await client.systemSettings.deleteMany({ where: { key: 'android_app' } });
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
    if (ORIGINAL_KEY_ENV === undefined) delete process.env.SECRETS_ENCRYPTION_KEY;
    else process.env.SECRETS_ENCRYPTION_KEY = ORIGINAL_KEY_ENV;
  });

  beforeEach(async () => {
    await client.androidAppRelease.deleteMany({ where: { packageName: PACKAGE } });
  });

  it('refuses a second current row at the database (the raw-SQL partial unique index)', async () => {
    await seedRelease(1, true);
    await expect(seedRelease(2, true)).rejects.toMatchObject({ code: 'P2002' });
    const index = await client.$queryRaw<Array<{ indexdef: string }>>`
      SELECT indexdef FROM pg_indexes WHERE indexname = 'android_app_releases_one_current_uniq_idx'`;
    expect(index[0]?.indexdef).toMatch(/WHERE is_current/);
  });

  it('two concurrent make-current calls leave exactly one current release; the loser gets 409', async () => {
    await seedRelease(1, true);
    const b = await seedRelease(2);
    const c = await seedRelease(3);
    const outcomes = await Promise.allSettled([releases.makeCurrent(b.id, userId), releases.makeCurrent(c.id, userId)]);
    const current = await client.androidAppRelease.findMany({ where: { packageName: PACKAGE, isCurrent: true } });
    expect(current).toHaveLength(1);
    const fulfilled = outcomes.filter((o) => o.status === 'fulfilled');
    const rejected = outcomes.filter((o): o is PromiseRejectedResult => o.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason.getStatus()).toBe(409);
    expect(rejected[0]!.reason.getResponse().details.reason).toBe('RELEASE_CURRENT_CONFLICT');
    expect([b.id, c.id]).toContain(current[0]!.id);
  });

  it('round-trips a BigInt sizeBytes beyond 2^31 and returns it as a decimal string', async () => {
    await seedRelease(7, true, 3_000_000_123n);
    const row = await client.androidAppRelease.findFirstOrThrow({ where: { packageName: PACKAGE } });
    expect(row.sizeBytes).toBe(3_000_000_123n);
    expect((await releases.latest()).sizeBytes).toBe('3000000123');
  });

  it('defaults push_subscriptions.platform to browser, refuses other values, and re-tags up only', async () => {
    const push = new PushSubscriptionService(client as never, { resolveActiveVapidConfig: async () => ({ publicKey: 'k', privateKey: 'p', subject: 'mailto:a@b.c' }) } as never);
    const keys = { p256dh: 'p', auth: 'a' };
    await client.pushSubscription.deleteMany({ where: { endpoint: ENDPOINT } });
    const raw = await client.pushSubscription.create({ data: { userId, endpoint: ENDPOINT, ...keys } });
    expect(raw.platform).toBe('browser');
    await expect(
      client.$executeRaw`UPDATE push_subscriptions SET platform = 'ios' WHERE endpoint = ${ENDPOINT}`,
    ).rejects.toThrow(/push_subscriptions_platform_check/);

    expect((await push.subscribe(userId, { endpoint: ENDPOINT, keys, platform: 'android_app' }, undefined)).platform).toBe('android_app');
    expect((await push.subscribe(userId, { endpoint: ENDPOINT, keys, platform: 'browser' }, undefined)).platform).toBe('android_app');
    expect((await push.subscribe(userId, { endpoint: ENDPOINT, keys }, undefined)).platform).toBe('android_app');
    const stored = await client.pushSubscription.findUniqueOrThrow({ where: { endpoint: ENDPOINT } });
    expect(stored.platform).toBe('android_app');
  });
});
