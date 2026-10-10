// =============================================================================
// GET /api/onboarding, GET /api/admin/onboarding/metrics and the onboarding
// namespace through PATCH /api/user-settings, over HTTP (issue #745)
// =============================================================================
//
// The RBAC matrix (user_settings:read for the checklist, system_settings:read
// for the admin block and the metrics), `refresh` as a string enum forwarded
// to the Doctor, the read-only GET (no row created), the metrics' `days`
// validation, and the stored state written through the existing settings
// route with If-Match (null clears, skipped validated). The Doctor is stubbed
// so the result does not depend on what the mocked database answers.
// =============================================================================

import request from 'supertest';
import type { DoctorReport } from '@marinoscar/platform-api/doctor';
import { DoctorService } from '@marinoscar/platform-api/doctor';

import { TestContext, createTestApp, closeTestApp } from '../helpers/test-app.helper';
import { prismaMock, resetPrismaMock } from '../mocks/prisma.mock';
import { setupBaseMocks, setupMockUserSettings } from '../fixtures/mock-setup.helper';
import { authHeader, createMockAdminUser, createMockViewerUser } from '../helpers/auth-mock.helper';

function report(category: string | undefined): DoctorReport {
  const all = [
    { id: 'storage.config', category: 'storage' },
    { id: 'storage.bucket', category: 'storage' },
    { id: 'email.config', category: 'email' },
    { id: 'ai.enabled', category: 'ai' },
    { id: 'ai.providers', category: 'ai' },
    { id: 'push.vapid', category: 'push' },
    { id: 'backup.schedule', category: 'backup' },
  ];
  return {
    verdict: 'fail',
    generatedAt: new Date(0).toISOString(),
    durationMs: 0,
    checks: all
      .filter((c) => c.category === category)
      .map((c) => ({ ...c, label: c.id, settingsPath: null, status: 'fail', detail: `${c.id} is not set`, remedy: `Configure ${c.id}.`, error: null, data: null, durationMs: 0 })),
  };
}

describe('Onboarding (/api/onboarding)', () => {
  let context: TestContext;
  let doctorRun: jest.SpyInstance;

  beforeAll(async () => {
    context = await createTestApp({ useMockDatabase: true });
  });

  afterAll(async () => {
    await closeTestApp(context);
  });

  beforeEach(() => {
    resetPrismaMock();
    setupBaseMocks();
    (prismaMock.allowedEmail.count as jest.Mock).mockResolvedValue(0);
    (prismaMock.pushSubscription.findFirst as jest.Mock).mockResolvedValue(null);
    doctorRun = jest
      .spyOn(context.app.get(DoctorService), 'run')
      .mockImplementation(async (options = {}) => report(options.category));
  });

  afterEach(() => doctorRun.mockRestore());

  const server = () => context.app.getHttpServer();

  describe('GET /api/onboarding', () => {
    it('answers 401 without a session', async () => {
      await request(server()).get('/api/onboarding').expect(401);
    });

    it('gives an administrator the admin block with the required steps todo and Doctor remedies', async () => {
      const admin = await createMockAdminUser(context);
      const response = await request(server()).get('/api/onboarding').set(authHeader(admin.accessToken)).expect(200);
      const block = response.body.data.admin;

      expect(block.steps.map((s: { id: string }) => s.id)).toEqual(
        expect.arrayContaining(['admin.storage', 'admin.email', 'admin.access', 'admin.push', 'admin.backup']),
      );
      const required = block.steps.filter((s: { tier: string }) => s.tier === 'required');
      expect(required.map((s: { id: string; status: string }) => [s.id, s.status])).toEqual([
        ['admin.storage', 'todo'],
        ['admin.email', 'todo'],
        ['admin.access', 'todo'],
      ]);
      expect(required[0].detail).toBe('Configure storage.config.');
      expect(block.requiredDone).toBe(false);
      expect(response.body.data.settings).toEqual({ welcomeSeenAt: null, checklistDismissedAt: null, adminDismissedAt: null, skipped: [] });
    });

    it('gives a viewer no admin block and never runs the Doctor for them', async () => {
      const viewer = await createMockViewerUser(context);
      const response = await request(server()).get('/api/onboarding').set(authHeader(viewer.accessToken)).expect(200);
      expect(response.body.data.admin).toBeNull();
      expect(response.body.data.user.steps.map((s: { id: string }) => s.id)).toEqual(['user.profile', 'user.notifications']);
      expect(doctorRun).not.toHaveBeenCalled();
    });

    it('reads refresh as a string enum and forwards it to the Doctor', async () => {
      const admin = await createMockAdminUser(context);
      await request(server()).get('/api/onboarding?refresh=false').set(authHeader(admin.accessToken)).expect(200);
      expect(doctorRun.mock.calls.every(([options]) => options.refresh === false)).toBe(true);

      doctorRun.mockClear();
      await request(server()).get('/api/onboarding?refresh=true').set(authHeader(admin.accessToken)).expect(200);
      expect(doctorRun.mock.calls.length).toBeGreaterThan(0);
      expect(doctorRun.mock.calls.every(([options]) => options.refresh === true)).toBe(true);

      await request(server()).get('/api/onboarding?refresh=1').set(authHeader(admin.accessToken)).expect(400);
    });

    it('never writes a settings row', async () => {
      const viewer = await createMockViewerUser(context);
      (prismaMock.userSettings.findUnique as jest.Mock).mockResolvedValue(null);
      await request(server()).get('/api/onboarding').set(authHeader(viewer.accessToken)).expect(200);
      expect(prismaMock.userSettings.create).not.toHaveBeenCalled();
      expect(prismaMock.userSettings.upsert).not.toHaveBeenCalled();
      expect(prismaMock.userSettings.update).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/admin/onboarding/metrics', () => {
    it('answers 403 to a viewer and 400 on a days out of range', async () => {
      const viewer = await createMockViewerUser(context);
      const admin = await createMockAdminUser(context);
      await request(server()).get('/api/admin/onboarding/metrics').set(authHeader(viewer.accessToken)).expect(403);
      await request(server()).get('/api/admin/onboarding/metrics?days=0').set(authHeader(admin.accessToken)).expect(400);
      await request(server()).get('/api/admin/onboarding/metrics?days=366').set(authHeader(admin.accessToken)).expect(400);
    });

    it('returns the cohort and the funnel, aggregates only', async () => {
      const admin = await createMockAdminUser(context);
      (prismaMock.$queryRawUnsafe as jest.Mock).mockResolvedValue([{ cohort_size: 5, f0_completed: 2, f1_completed: 1 }]);
      const response = await request(server()).get('/api/admin/onboarding/metrics?days=7').set(authHeader(admin.accessToken)).expect(200);
      expect(response.body.data).toEqual({
        windowDays: 7,
        cohortSize: 5,
        milestones: [],
        steps: [
          { id: 'user.profile', title: 'Complete your profile', completed: 2, rate: 0.4 },
          { id: 'user.notifications', title: 'Choose your notifications', completed: 1, rate: 0.2 },
        ],
      });
    });
  });

  describe('the onboarding namespace through PATCH /api/user-settings', () => {
    it('writes with If-Match, clears with null and refuses an unskippable id', async () => {
      const viewer = await createMockViewerUser(context);
      setupMockUserSettings(viewer.id, { theme: 'system', profile: { imageSource: 'none' } });
      (prismaMock.user.update as jest.Mock).mockResolvedValue({});

      const seen = await request(server())
        .patch('/api/user-settings')
        .set(authHeader(viewer.accessToken))
        .set('If-Match', '1')
        .send({ onboarding: { welcomeSeenAt: '2026-10-08T00:00:00.000Z', skipped: ['user.profile'] } })
        .expect(200);
      expect(seen.body.data.onboarding).toEqual({ welcomeSeenAt: '2026-10-08T00:00:00.000Z', skipped: ['user.profile'] });

      const after = await request(server()).get('/api/onboarding').set(authHeader(viewer.accessToken)).expect(200);
      expect(after.body.data.settings.welcomeSeenAt).toBe('2026-10-08T00:00:00.000Z');
      expect(after.body.data.user.steps.find((s: { id: string }) => s.id === 'user.profile').skipped).toBe(true);

      const cleared = await request(server())
        .patch('/api/user-settings')
        .set(authHeader(viewer.accessToken))
        .send({ onboarding: { welcomeSeenAt: null } })
        .expect(200);
      expect(cleared.body.data.onboarding).toEqual({ skipped: ['user.profile'] });

      await request(server())
        .patch('/api/user-settings')
        .set(authHeader(viewer.accessToken))
        .send({ onboarding: { skipped: ['admin.storage'] } })
        .expect(400);
      await request(server())
        .patch('/api/user-settings')
        .set(authHeader(viewer.accessToken))
        .send({ onboarding: { unknownKey: true } })
        .expect(400);
      await request(server())
        .patch('/api/user-settings')
        .set(authHeader(viewer.accessToken))
        .set('If-Match', '99')
        .send({ onboarding: { checklistDismissedAt: '2026-10-08T00:00:00.000Z' } })
        .expect(409);
    });
  });
});
