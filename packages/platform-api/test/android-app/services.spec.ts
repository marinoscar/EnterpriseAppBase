// The android-app slice's services over doubles (#746): trusted apps through
// the row store, release upload / make-current / delete / download, and the
// Android test notification.
import { Readable } from 'node:stream';

import { ConflictException, GoneException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';

import { InMemoryAuditSink } from '../../src/testing/index';
import { AndroidAppService } from '../../src/android-app/android-app.service';
import { resolveAndroidAppModuleOptions } from '../../src/android-app/android-app.options';
import { AndroidAppPushService } from '../../src/android-app/android-app-push.service';
import { androidDeviceSourceRegistry } from '../../src/android-app/device-sources';
import { AndroidReleaseService, type ReleaseUploadPart } from '../../src/android-app/releases/android-release.service';
import { withTemporaryEntries } from '../../src/core/registry/index';
import { OTHER_SHA, SHA, chunked, drain, fixtureApk, useTestEncryptionKey } from './support';

useTestEncryptionKey();

const ADMIN = '00000000-0000-4000-8000-000000000001';
const OPTIONS = resolveAndroidAppModuleOptions({ appName: 'Fixture App', apkStem: 'fixture-android' });

/** An in-memory `system_settings` row store. */
function rowStore(initial: unknown = undefined) {
  let value = initial;
  const writes: Array<{ key: string; value: unknown; options: Record<string, unknown> }> = [];
  return {
    writes,
    read: jest.fn(async (_key: string, schema: { safeParse(v: unknown): { success: boolean; data?: unknown } }, defaults: unknown) => {
      const parsed = schema.safeParse(value);
      return { value: parsed.success ? parsed.data : defaults, version: 0, updatedAt: null, updatedByUserId: null };
    }),
    write: jest.fn(async (key: string, next: unknown, options: Record<string, unknown>) => {
      writes.push({ key, value: next, options });
      value = next;
      return { value: next, version: writes.length, updatedAt: new Date(), updatedByUserId: ADMIN };
    }),
  };
}

/** An in-memory `android_app_releases` table with the one-current rule. */
function releaseTable() {
  const rows: Array<Record<string, any>> = [];
  const pick = (where: Record<string, unknown> = {}) =>
    rows.filter((row) =>
      Object.entries(where).every(([field, wanted]) =>
        field === 'packageName_versionCode'
          ? row.packageName === (wanted as any).packageName && row.versionCode === (wanted as any).versionCode
          : row[field] === wanted,
      ),
    );
  const assertOneCurrent = () => {
    if (rows.filter((row) => row.isCurrent).length > 1) {
      throw Object.assign(new Error('unique violation android_app_releases_one_current_uniq_idx'), { code: 'P2002', meta: {} });
    }
  };
  const delegate = {
    rows,
    findUnique: jest.fn(async ({ where }: any) => pick(where)[0] ?? null),
    findFirst: jest.fn(async ({ where }: any = {}) => pick(where)[0] ?? null),
    findMany: jest.fn(async () => [...rows].reverse()),
    create: jest.fn(async ({ data }: any) => {
      if (pick({ packageName: data.packageName, versionCode: data.versionCode }).length) throw Object.assign(new Error('dup'), { code: 'P2002', meta: {} });
      const row = { createdAt: new Date('2026-10-08T00:00:00Z'), uploadedBy: null, ...data };
      rows.push(row);
      assertOneCurrent();
      return row;
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const row = pick(where)[0];
      if (!row) throw Object.assign(new Error('missing'), { code: 'P2025' });
      Object.assign(row, data);
      assertOneCurrent();
      return row;
    }),
    updateMany: jest.fn(async ({ where, data }: any) => {
      const hit = pick(where);
      hit.forEach((row) => Object.assign(row, data));
      return { count: hit.length };
    }),
    deleteMany: jest.fn(async ({ where }: any) => {
      const hit = pick(where);
      hit.forEach((row) => rows.splice(rows.indexOf(row), 1));
      return { count: hit.length };
    }),
    count: jest.fn(),
    groupBy: jest.fn(),
  };
  return delegate;
}

function storage() {
  const objects = new Map<string, Buffer>();
  const calls: string[] = [];
  return {
    objects,
    calls,
    upload: jest.fn(async (key: string, stream: Readable) => {
      objects.set(key, await drain(stream));
      calls.push(`upload ${key}`);
      return { key, bucket: 'b', location: key };
    }),
    delete: jest.fn(async (key: string) => {
      calls.push(`delete ${key}`);
      objects.delete(key);
    }),
    download: jest.fn(async (key: string) => Readable.from([objects.get(key) ?? Buffer.alloc(0)])),
  };
}

function build(options: { trusted?: unknown; configured?: boolean } = {}) {
  const table = releaseTable();
  const prisma: any = {
    androidAppRelease: table,
    user: { findUnique: jest.fn(async () => ({ isActive: true, id: ADMIN })) },
    pushSubscription: { groupBy: jest.fn(async () => []), findMany: jest.fn(async () => []) },
  };
  prisma.$transaction = jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma));
  const rows = rowStore(options.trusted);
  const androidApp = new AndroidAppService(prisma, rows as never);
  const objects = storage();
  const storageConfig = {
    resolve: jest.fn(async () =>
      options.configured === false
        ? { configured: false, provider: 's3', missing: ['bucket'] }
        : { configured: true, config: { provider: 's3', bucket: 'releases-bucket' } },
    ),
  };
  const audit = new InMemoryAuditSink();
  const releases = new AndroidReleaseService(prisma, objects as never, storageConfig as never, androidApp, audit, OPTIONS);
  return { table, prisma, rows, androidApp, objects, releases, audit };
}

function parts(fields: Record<string, string>, apk: Buffer | null = fixtureApk()): AsyncIterable<ReleaseUploadPart> {
  const list: ReleaseUploadPart[] = Object.entries(fields).map(([fieldname, value]) => ({ type: 'field', fieldname, value }));
  if (apk) list.push({ type: 'file', fieldname: 'apk', file: chunked(apk) });
  return (async function* () {
    yield* list;
  })();
}

const FIELDS = { packageName: 'com.example.app', versionName: '1.0.0', versionCode: '1', signingSha256: SHA };

describe('AndroidAppService', () => {
  it('reads an empty list without a row and saves through the row store, audited', async () => {
    const { androidApp, rows } = build();
    expect(await androidApp.getTrustedApps()).toEqual([]);
    const view = await androidApp.replace({ trustedApps: [{ packageName: 'com.example.app', sha256: SHA }] }, ADMIN);
    expect(view.trustedApps).toEqual([{ packageName: 'com.example.app', sha256: SHA }]);
    expect(view.assetLinks[0]!.target.sha256_cert_fingerprints).toEqual([SHA]);
    expect(rows.writes[0]).toMatchObject({ key: 'android_app', options: { actorId: ADMIN, auditAction: 'android_app.trusted_apps.updated' } });
    expect(view.pushSubscriptions).toEqual({ androidApp: 0, browser: 0, androidAppUsers: 0 });
  });

  it("reads EvoPath's stored format back unchanged", async () => {
    const { androidApp } = build({ trusted: { trustedApps: [{ packageName: 'com.example.app', sha256: SHA }] } });
    expect(await androidApp.getTrustedApps()).toEqual([{ packageName: 'com.example.app', sha256: SHA }]);
  });

  it('merges every registered device source and survives a failing one', async () => {
    const { androidApp } = build();
    await withTemporaryEntries(
      androidDeviceSourceRegistry,
      [
        { id: 'empty', reportedApps: async () => [] },
        { id: 'one', reportedApps: async () => [{ packageName: 'com.example.app', signingSha256: SHA, deviceCount: 2, lastSeenAt: null }] },
        { id: 'broken', reportedApps: async () => Promise.reject(new Error('down')) },
      ],
      async () => {
        expect(await androidApp.getReportedApps([])).toEqual([
          { packageName: 'com.example.app', sha256: SHA, deviceCount: 2, lastSeenAt: null, trusted: false },
        ]);
      },
    );
    expect(await androidApp.getReportedApps([])).toEqual([]);
  });
});

describe('AndroidReleaseService', () => {
  it('streams an upload to storage, records provider and bucket, returns sizeBytes as a string and bootstraps trust', async () => {
    const { releases, objects, androidApp, audit } = build();
    const apk = fixtureApk(5000);
    const release = await releases.upload(parts(FIELDS, apk), ADMIN);
    expect(release).toMatchObject({ packageName: 'com.example.app', sizeBytes: '5000', isCurrent: true, storageProvider: 's3' });
    expect(objects.objects.get(`android-releases/${release.id}.apk`)).toEqual(apk);
    expect(await androidApp.getTrustedApps()).toEqual([{ packageName: 'com.example.app', sha256: SHA }]);
    expect(audit.events.map((event) => event.action)).toEqual(['android_app.release.uploaded']);
  });

  it('refuses an untrusted package or signing key once the list holds one, unless trust=true', async () => {
    const { releases, objects, androidApp } = build({ trusted: { trustedApps: [{ packageName: 'com.example.app', sha256: SHA }] } });
    await expect(releases.upload(parts({ ...FIELDS, signingSha256: OTHER_SHA }), ADMIN)).rejects.toMatchObject({
      response: { details: { reason: 'RELEASE_UNTRUSTED_APP' } },
    });
    await expect(releases.upload(parts({ ...FIELDS, packageName: 'com.example.other' }), ADMIN)).rejects.toBeInstanceOf(ConflictException);
    expect(objects.upload).not.toHaveBeenCalled();
    await releases.upload(parts({ ...FIELDS, signingSha256: OTHER_SHA, trust: 'true', makeCurrent: 'false' }), ADMIN);
    expect((await androidApp.getTrustedApps()).map((app) => app.sha256)).toEqual([SHA, OTHER_SHA]);
  });

  it('answers 503 STORAGE_NOT_CONFIGURED when storage is not configured', async () => {
    const { releases } = build({ configured: false });
    const error = await releases.resolveUploadTarget().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect((error as ServiceUnavailableException).getResponse()).toMatchObject({ details: { reason: 'STORAGE_NOT_CONFIGURED' } });
  });

  it('refuses a not-newer versionCode for the current package, a duplicate, and deletes what it stored for a late refusal', async () => {
    const { releases, objects } = build();
    await releases.upload(parts({ ...FIELDS, versionCode: '5' }), ADMIN);
    await expect(releases.upload(parts({ ...FIELDS, versionCode: '4' }), ADMIN)).rejects.toMatchObject({
      response: { details: { reason: 'RELEASE_VERSION_NOT_NEWER' } },
    });
    await expect(releases.upload(parts({ ...FIELDS, versionCode: '5', makeCurrent: 'false' }), ADMIN)).rejects.toMatchObject({
      response: { details: { reason: 'RELEASE_VERSION_EXISTS' } },
    });
    // Fields after the file: stored, then refused, then deleted.
    const late: AsyncIterable<ReleaseUploadPart> = (async function* () {
      yield { type: 'file' as const, fieldname: 'apk', file: chunked(fixtureApk()) };
      for (const [fieldname, value] of Object.entries({ ...FIELDS, versionCode: '3' })) yield { type: 'field' as const, fieldname, value };
    })();
    await expect(releases.upload(late, ADMIN)).rejects.toMatchObject({ response: { details: { reason: 'RELEASE_VERSION_NOT_NEWER' } } });
    expect(objects.objects.size).toBe(1);
  });

  it('refuses a non-APK body and a missing file', async () => {
    const { releases, objects } = build();
    await expect(releases.upload(parts(FIELDS, Buffer.from('plain text, no zip')), ADMIN)).rejects.toMatchObject({
      response: { details: { reason: 'RELEASE_NOT_AN_APK' } },
    });
    await expect(releases.upload(parts(FIELDS, null), ADMIN)).rejects.toMatchObject({ response: { details: { reason: 'RELEASE_INVALID_UPLOAD' } } });
    expect(objects.objects.size).toBe(0);
  });

  it('makes an older release current (rollback) and maps a concurrent winner to 409', async () => {
    const { releases, table, prisma } = build();
    const first = await releases.upload(parts({ ...FIELDS, versionCode: '1' }), ADMIN);
    const second = await releases.upload(parts({ ...FIELDS, versionCode: '2' }), ADMIN);
    expect((await releases.makeCurrent(first.id, ADMIN)).isCurrent).toBe(true);
    expect(table.rows.filter((row) => row.isCurrent).map((row) => row.id)).toEqual([first.id]);
    prisma.$transaction.mockRejectedValueOnce(
      Object.assign(new Error('x'), { code: 'P2002', meta: { driverAdapterError: { cause: { constraint: { index: 'android_app_releases_one_current_uniq_idx' } } } } }),
    );
    await expect(releases.makeCurrent(second.id, ADMIN)).rejects.toMatchObject({ response: { details: { reason: 'RELEASE_CURRENT_CONFLICT' } } });
  });

  it('deletes the object, then the row, and never the current release', async () => {
    const { releases, objects, table } = build();
    const old = await releases.upload(parts({ ...FIELDS, versionCode: '1' }), ADMIN);
    const current = await releases.upload(parts({ ...FIELDS, versionCode: '2' }), ADMIN);
    await expect(releases.remove(current.id, ADMIN)).rejects.toMatchObject({ response: { details: { reason: 'RELEASE_IS_CURRENT' } } });
    const order: string[] = [];
    objects.delete.mockImplementationOnce(async (key: string) => {
      order.push('object');
      objects.objects.delete(key);
    });
    table.deleteMany.mockImplementationOnce(async ({ where }: any) => {
      order.push('row');
      table.rows.splice(table.rows.findIndex((row) => row.id === where.id), 1);
      return { count: 1 };
    });
    await releases.remove(old.id, ADMIN);
    expect(order).toEqual(['object', 'row']);
    await expect(releases.remove(old.id, ADMIN)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('serves latest, signs a link that expires, and streams the APK under the configured stem', async () => {
    const { releases } = build();
    await expect(releases.latest()).rejects.toMatchObject({ response: { details: { reason: 'NO_RELEASE' } } });
    const apk = fixtureApk(1234);
    const release = await releases.upload(parts({ ...FIELDS, versionName: '2.1.0' }, apk), ADMIN);
    expect(await releases.latest()).toMatchObject({ id: release.id, sizeBytes: '1234' });
    const now = new Date('2026-10-08T12:00:00Z');
    const link = await releases.createDownloadLink(release.id, ADMIN, now);
    expect(link.url).toMatch(/^\/api\/android-app\/download\//);
    expect(link.expiresAt).toBe('2026-10-08T12:10:00.000Z');
    const token = link.url.split('/').pop()!;
    const opened = await releases.openDownload(token, now);
    expect(opened).toMatchObject({ sizeBytes: 1234, fileName: 'fixture-android-2.1.0.apk' });
    expect(await drain(opened.stream)).toEqual(apk);
    await expect(releases.openDownload(token, new Date('2026-10-08T12:11:00Z'))).rejects.toBeInstanceOf(GoneException);
    const tampered = `${token.slice(0, 3)}${token[3] === 'A' ? 'B' : 'A'}${token.slice(4)}`;
    await expect(releases.openDownload(tampered, now)).rejects.toMatchObject({ response: { details: { reason: 'DOWNLOAD_LINK_INVALID' } } });
  });
});

describe('AndroidAppPushService', () => {
  function push(active: unknown, subscriptions: unknown[], sent: unknown[] = []) {
    const prisma: any = {
      user: { findUnique: jest.fn(async () => null) },
      pushSubscription: { findMany: jest.fn(async () => subscriptions) },
    };
    const audit = new InMemoryAuditSink();
    const service = new AndroidAppPushService(
      prisma,
      { resolveActiveVapidConfig: jest.fn(async () => active) } as never,
      { sendToSubscriptions: jest.fn(async () => sent) } as never,
      audit,
      OPTIONS,
    );
    return { service, prisma, audit };
  }
  const active = { publicKey: 'k', privateKey: 'p', subject: 'mailto:a@b.c' };

  it('reports PUSH_NOT_CONFIGURED and NO_ANDROID_SUBSCRIPTION', async () => {
    expect(await push(null, []).service.sendTest(ADMIN)).toMatchObject({ reason: 'PUSH_NOT_CONFIGURED', results: [] });
    expect(await push(active, []).service.sendTest(ADMIN)).toMatchObject({ reason: 'NO_ANDROID_SUBSCRIPTION', androidSubscriptions: 0 });
  });

  it('reports per-subscription outcomes with the host only, scoped to android_app, audited', async () => {
    const { service, prisma, audit } = push(
      active,
      [
        { id: 's1', endpoint: 'https://fcm.googleapis.com/fcm/send/secret-1' },
        { id: 's2', endpoint: 'https://fcm.googleapis.com/fcm/send/secret-2' },
        { id: 's3', endpoint: 'https://updates.push.services.mozilla.com/x' },
      ],
      [{ status: 'sent' }, { status: 'pruned' }, { status: 'failed', message: 'HTTP 500' }],
    );
    const result = await service.sendTest(ADMIN);
    expect(prisma.pushSubscription.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: ADMIN, platform: 'android_app' } }));
    expect(result.results.map((row) => [row.status, row.endpointHost])).toEqual([
      ['sent', 'fcm.googleapis.com'],
      ['gone', 'fcm.googleapis.com'],
      ['failed', 'updates.push.services.mozilla.com'],
    ]);
    expect(JSON.stringify(result)).not.toContain('secret-1');
    expect(audit.events[0]).toMatchObject({ action: 'android_app.test_notification.sent', meta: { sent: 1, gone: 1, failed: 1 } });
  });

  it('refuses an unknown target user', async () => {
    await expect(push(active, []).service.sendTest(ADMIN, '00000000-0000-4000-8000-000000000009')).rejects.toBeInstanceOf(NotFoundException);
  });
});
