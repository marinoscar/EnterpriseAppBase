// The android-app routes through the reference app (#746): every guard
// (public assetlinks and download, @Auth() user routes, system_settings:*
// admin routes), the typed trusted-apps refusal, the 503 when storage is not
// configured, and the Android test notification's reasons.
// The download-link signing sub-key derives from the master key: set it before
// the first derivation (secret-cipher caches the key).
const ORIGINAL_KEY_ENV = process.env.SECRETS_ENCRYPTION_KEY;
process.env.SECRETS_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');

import request from 'supertest';

import { StorageConfigService } from '@marinoscar/platform-api/storage';

import { closeTestApp, createTestApp, type TestContext } from '../helpers/test-app.helper';
import { authHeader, createMockAdminUser, createMockViewerUser } from '../helpers/auth-mock.helper';
import { setupBaseMocks } from '../fixtures/mock-setup.helper';
import { prismaMock, resetPrismaMock } from '../mocks/prisma.mock';

const SHA = Array.from({ length: 32 }, (_, i) => ((i * 11 + 3) % 256).toString(16).toUpperCase().padStart(2, '0')).join(':');

describe('android-app routes (#746)', () => {
  let context: TestContext;
  const storageConfigStub = { resolve: jest.fn() };

  beforeAll(async () => {
    context = await createTestApp({
      useMockDatabase: true,
      overrideProviders: [{ provide: StorageConfigService, useValue: storageConfigStub }],
    });
  });

  afterAll(async () => {
    await closeTestApp(context);
    if (ORIGINAL_KEY_ENV === undefined) delete process.env.SECRETS_ENCRYPTION_KEY;
    else process.env.SECRETS_ENCRYPTION_KEY = ORIGINAL_KEY_ENV;
  });

  beforeEach(() => {
    resetPrismaMock();
    setupBaseMocks();
    storageConfigStub.resolve.mockResolvedValue({ configured: false, provider: 's3', missing: ['bucket', 'accessKeyId'] });
    (prismaMock.androidAppRelease.findFirst as jest.Mock).mockResolvedValue(null);
    (prismaMock.pushSubscription.groupBy as jest.Mock).mockResolvedValue([]);
    (prismaMock.pushSubscription.findMany as jest.Mock).mockResolvedValue([]);
  });

  const server = () => context.app.getHttpServer();

  describe('GET /api/well-known/assetlinks.json (public, deliberately)', () => {
    it('answers without a token: a bare array of statements, cacheable', async () => {
      (prismaMock.systemSettings.findUnique as jest.Mock).mockImplementation(async ({ where }: { where: { key: string } }) =>
        where.key === 'android_app'
          ? { id: 's1', key: 'android_app', value: { trustedApps: [{ packageName: 'com.example.app', sha256: SHA }] }, version: 1, updatedAt: new Date(), updatedByUserId: null }
          : null,
      );
      const response = await request(server()).get('/api/well-known/assetlinks.json').expect(200);
      expect(response.headers['cache-control']).toBe('public, max-age=300');
      expect(response.body).toEqual([
        {
          relation: ['delegate_permission/common.handle_all_urls'],
          target: { namespace: 'android_app', package_name: 'com.example.app', sha256_cert_fingerprints: [SHA] },
        },
      ]);
    });

    it('is [] when nothing is trusted', async () => {
      (prismaMock.systemSettings.findUnique as jest.Mock).mockResolvedValue(null);
      const response = await request(server()).get('/api/well-known/assetlinks.json').expect(200);
      expect(response.body).toEqual([]);
    });
  });

  describe('admin routes require system_settings:*', () => {
    it.each([
      ['get', '/api/admin/android-app'],
      ['put', '/api/admin/android-app'],
      ['post', '/api/admin/android-app/test-notification'],
      ['get', '/api/admin/android-app/releases'],
      ['post', '/api/admin/android-app/releases'],
      ['post', '/api/admin/android-app/releases/00000000-0000-4000-8000-000000000001/make-current'],
      ['delete', '/api/admin/android-app/releases/00000000-0000-4000-8000-000000000001'],
    ] as const)('%s %s: 401 without a token, 403 for a viewer', async (method, path) => {
      await request(server())[method](path).expect(401);
      const viewer = await createMockViewerUser(context);
      await request(server())[method](path).set(authHeader(viewer.accessToken)).send({}).expect(403);
    });

    it('GET /api/admin/android-app gives an administrator the view, with no reported apps from the empty source', async () => {
      (prismaMock.systemSettings.findUnique as jest.Mock).mockResolvedValue(null);
      const admin = await createMockAdminUser(context);
      const response = await request(server()).get('/api/admin/android-app').set(authHeader(admin.accessToken)).expect(200);
      expect(response.body.data).toEqual({
        trustedApps: [],
        reportedApps: [],
        assetLinks: [],
        pushSubscriptions: { androidApp: 0, browser: 0, androidAppUsers: 0 },
      });
    });

    it('PUT /api/admin/android-app refuses an invalid list with a typed reason', async () => {
      const admin = await createMockAdminUser(context);
      const response = await request(server())
        .put('/api/admin/android-app')
        .set(authHeader(admin.accessToken))
        .send({ trustedApps: [{ packageName: 'com.example.app', sha256: 'not-a-fingerprint' }] })
        .expect(400);
      expect(response.body.details.reason).toBe('INVALID_FINGERPRINT');
    });

    it('POST /api/admin/android-app/releases is 503 STORAGE_NOT_CONFIGURED without storage', async () => {
      const admin = await createMockAdminUser(context);
      const response = await request(server())
        .post('/api/admin/android-app/releases')
        .set(authHeader(admin.accessToken))
        .field('packageName', 'com.example.app')
        .field('versionName', '1.0.0')
        .field('versionCode', '1')
        .field('signingSha256', SHA)
        .attach('apk', Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]), 'app.apk')
        .expect(503);
      expect(response.body.details.reason).toBe('STORAGE_NOT_CONFIGURED');
    });

    it('POST /api/admin/android-app/test-notification reports PUSH_NOT_CONFIGURED', async () => {
      const admin = await createMockAdminUser(context);
      const response = await request(server()).post('/api/admin/android-app/test-notification').set(authHeader(admin.accessToken)).send({}).expect(200);
      expect(response.body.data).toMatchObject({ reason: 'PUSH_NOT_CONFIGURED', results: [] });
    });
  });

  describe('user routes are @Auth() for any signed-in user', () => {
    it('GET /api/android-app/releases/latest: 401 without a token, 404 NO_RELEASE for a viewer', async () => {
      await request(server()).get('/api/android-app/releases/latest').expect(401);
      const viewer = await createMockViewerUser(context);
      const response = await request(server()).get('/api/android-app/releases/latest').set(authHeader(viewer.accessToken)).expect(404);
      expect(response.body.details.reason).toBe('NO_RELEASE');
    });

    it('POST download-link: 401 without a token, 404 for an unknown release', async () => {
      const path = '/api/android-app/releases/00000000-0000-4000-8000-000000000001/download-link';
      await request(server()).post(path).expect(401);
      (prismaMock.androidAppRelease.findUnique as jest.Mock).mockResolvedValue(null);
      const viewer = await createMockViewerUser(context);
      await request(server()).post(path).set(authHeader(viewer.accessToken)).expect(404);
    });

    it('GET /api/android-app/download/:token is public but refuses a bad token', async () => {
      const response = await request(server()).get('/api/android-app/download/not-a-token').expect(404);
      expect(response.body.details.reason).toBe('DOWNLOAD_LINK_INVALID');
    });
  });
});
