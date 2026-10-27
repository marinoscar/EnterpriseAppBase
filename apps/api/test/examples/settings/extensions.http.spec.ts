// =============================================================================
// Every settings extension point, through the real application (PP-14.21)
// =============================================================================
//
// The reference app registers none of the examples (its settings document is
// exactly the platform's). This spec boots the real `AppModule` with all of
// them in a fresh module registry:
//
//   - `telemetry.query.slowQuerySeconds`: a nested extension, organization-tightenable
//   - `notifications.weeklyDigest`: an org-overridable field on a namespace with an org layer
//   - `retention` and `jobs` defaults, changed (data form and call form)
//   - a package-style contribution (`platform-extensions/settings/contribution.ts`)
//   - `profile.pronouns` (extension) and the `high-contrast` theme (`profile.timezone` is core)
//
// and drives them over HTTP. The registries are module-level, so the spec
// resets the module registry and registers BEFORE the application is built;
// the application, the mocks and supertest are required after that.
// =============================================================================

import request from 'supertest';

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any */

describe('settings extension points (PP-14.21)', () => {
  let context: any;
  let helpers: { admin: () => Promise<{ accessToken: string; id: string; email: string }>; user: () => Promise<{ accessToken: string; id: string }>; auth: (token: string) => Record<string, string> };
  let mocks: { prismaMock: any; reset: () => void; base: () => void };
  let DEFAULTS: any;
  let orgRows: Map<string, any>;
  let ORG_ID: string;

  beforeAll(async () => {
    jest.resetModules();
    jest.doMock('../../../src/app-registrations/settings', () => {
      const { TELEMETRY_QUERY_EXTENSION } = require('../../../src/platform-extensions/settings/examples/telemetry-query.extension');
      const { NOTIFICATIONS_DIGEST_EXTENSION } = require('../../../src/platform-extensions/settings/examples/notifications-digest.extension');
      const { RETENTION_DEFAULTS_OVERRIDE } = require('../../../src/platform-extensions/settings/examples/defaults.override');
      return {
        APP_SYSTEM_SETTINGS_NAMESPACES: [],
        APP_USER_SETTINGS_NAMESPACES: [],
        APP_SYSTEM_SETTINGS_EXTENSIONS: [TELEMETRY_QUERY_EXTENSION, NOTIFICATIONS_DIGEST_EXTENSION],
        APP_USER_SETTINGS_EXTENSIONS: [],
        APP_SYSTEM_SETTINGS_DEFAULT_OVERRIDES: [RETENTION_DEFAULTS_OVERRIDE],
      };
    });
    // What a package's side-effect import does, in the order the app would list them.
    require('../../../src/platform-extensions/settings/contribution');
    const { overrideSettingsNamespaceDefaults } = require('@marinoscar/platform-api/settings');
    const { JOBS_STUCK_THRESHOLD_MINUTES } = require('../../../src/platform-extensions/settings/examples/defaults.override');
    overrideSettingsNamespaceDefaults('jobs', { stuckThresholdMinutes: JOBS_STUCK_THRESHOLD_MINUTES });
    const profile = require('../../../src/platform-extensions/settings/examples/profile-pronouns');
    profile.registerProfilePronouns();
    profile.registerHighContrastTheme();

    const app = require('../../helpers/test-app.helper');
    const auth = require('../../helpers/auth-mock.helper');
    const prisma = require('../../mocks/prisma.mock');
    const setup = require('../../fixtures/mock-setup.helper');
    ORG_ID = require('../../fixtures/test-data.factory').MOCK_DEFAULT_ORG_ID;
    DEFAULTS = require('../../../src/common/types/settings.types').DEFAULT_SYSTEM_SETTINGS;

    context = await app.createTestApp({ useMockDatabase: true });
    helpers = {
      admin: () => auth.createMockAdminUser(context),
      user: () => auth.createMockTestUser(context),
      auth: auth.authHeader,
    };
    mocks = { prismaMock: prisma.prismaMock, reset: prisma.resetPrismaMock, base: setup.setupBaseMocks };
    (global as any).__closeApp = () => app.closeTestApp(context);
  }, 120_000);

  afterAll(async () => {
    await (global as any).__closeApp?.();
    delete (global as any).__closeApp;
    jest.dontMock('../../../src/app-registrations/settings');
  });

  beforeEach(() => {
    mocks.reset();
    mocks.base();
    orgRows = new Map();
    const orgSettings = mocks.prismaMock.orgSettings as Record<string, jest.Mock>;
    orgSettings.findUnique.mockImplementation(async ({ where }: any) => orgRows.get(where.orgId) ?? null);
    orgSettings.create.mockImplementation(async ({ data }: any) => {
      const row = { id: 'org-settings-1', version: 1, updatedAt: new Date(), ...data };
      orgRows.set(data.orgId, row);
      return row;
    });
    orgSettings.update.mockImplementation(async ({ where, data }: any) => {
      const row = { ...orgRows.get(where.orgId), value: data.value, version: orgRows.get(where.orgId).version + 1, updatedAt: new Date() };
      orgRows.set(where.orgId, row);
      return row;
    });
    mocks.prismaMock.auditEvent.create.mockResolvedValue({ id: 'audit-1' });
  });

  const server = () => context.app.getHttpServer();
  const stored = (value: unknown, version = 1) => ({
    id: 'settings-1',
    key: 'global',
    value,
    version,
    updatedAt: new Date(),
    updatedByUserId: null,
    updatedByUser: null,
  });

  describe('the system document', () => {
    it('serves the nested field, the org-capable field, the contribution and the changed defaults', async () => {
      const admin = await helpers.admin();
      mocks.prismaMock.systemSettings.findUnique.mockResolvedValue(stored(DEFAULTS));
      const { body } = await request(server()).get('/api/system-settings').set(helpers.auth(admin.accessToken)).expect(200);

      expect(body.data.telemetry.query).toEqual({ maxRows: 10000, timeoutSeconds: 30, slowQuerySeconds: 10 });
      expect(body.data.telemetry.assistant.citations).toBe(true); // the contribution's nested extension
      expect(body.data.notifications).toMatchObject({ browserEnabled: true, disabledEvents: [], weeklyDigest: true });
      expect(body.data.quotaPolicy).toEqual({ dailyLimit: 1000, warnAtPercent: 80 }); // the contribution's namespace
      expect(body.data.retention.notifications).toEqual({ enabled: true, days: 30 }); // data override
      expect(body.data.retention.auditEvents).toEqual({ enabled: true, days: 365 });
      expect(body.data.jobs.stuckThresholdMinutes).toBe(45); // call override
      expect(body.data.jobs.history).toEqual({ retentionDays: 30, purgeEnabled: true }); // the rest untouched
    });

    it('registers the namespaces in the documented order: platform, then the contribution', async () => {
      const { systemSettingsNamespaceRegistry } = require('@marinoscar/platform-api/settings');
      const keys: string[] = systemSettingsNamespaceRegistry.ids();
      expect(keys.slice(0, 9)).toEqual(['notifications', 'jobs', 'nodes', 'databaseBackup', 'maintenance', 'storage', 'ai', 'telemetry', 'retention']);
      expect(keys.slice(9)).toEqual(['quotaPolicy']);
    });

    it('keeps what an administrator saved when the stored row predates the nested field', async () => {
      const admin = await helpers.admin();
      const older = { ...DEFAULTS, telemetry: { ...DEFAULTS.telemetry, query: { maxRows: 500, timeoutSeconds: 7 } } };
      mocks.prismaMock.systemSettings.findUnique.mockResolvedValue(stored(older));
      const { body } = await request(server()).get('/api/system-settings').set(helpers.auth(admin.accessToken)).expect(200);
      // The base fields survive; the added one reads as its default.
      expect(body.data.telemetry.query).toEqual({ maxRows: 500, timeoutSeconds: 7, slowQuerySeconds: 10 });
    });

    it('patches the nested field and keeps its siblings through a base merge that does not know it', async () => {
      const admin = await helpers.admin();
      mocks.prismaMock.systemSettings.findUnique.mockResolvedValue(stored(DEFAULTS));
      mocks.prismaMock.systemSettings.update.mockImplementation(async ({ data }: any) => stored(data.value, 2));
      const { body } = await request(server())
        .patch('/api/system-settings')
        .set(helpers.auth(admin.accessToken))
        .send({ telemetry: { query: { slowQuerySeconds: 30 } } })
        .expect(200);
      expect(body.data.telemetry.query).toEqual({ maxRows: 10000, timeoutSeconds: 30, slowQuerySeconds: 30 });
      const written = mocks.prismaMock.systemSettings.update.mock.calls[0][0].data.value;
      expect(written.telemetry.query.slowQuerySeconds).toBe(30);
      expect(written.telemetry.assistant.citations).toBe(true);
      expect(written.notifications.weeklyDigest).toBe(true);

      // A later patch of a base field keeps the added one.
      mocks.prismaMock.systemSettings.findUnique.mockResolvedValue(stored(written, 2));
      const next = await request(server())
        .patch('/api/system-settings')
        .set(helpers.auth(admin.accessToken))
        .send({ telemetry: { query: { maxRows: 77 } } })
        .expect(200);
      expect(next.body.data.telemetry.query).toEqual({ maxRows: 77, timeoutSeconds: 30, slowQuerySeconds: 30 });
    });

    it('validates the nested field on the way in', async () => {
      const admin = await helpers.admin();
      mocks.prismaMock.systemSettings.findUnique.mockResolvedValue(stored(DEFAULTS));
      await request(server()).patch('/api/system-settings').set(helpers.auth(admin.accessToken)).send({ telemetry: { query: { slowQuerySeconds: 0 } } }).expect(400);
      await request(server()).patch('/api/system-settings').set(helpers.auth(admin.accessToken)).send({ telemetry: { query: { slowQuerySeconds: 500 } } }).expect(400);
    });
  });

  describe('the organization layer of the extensions', () => {
    const orgPatch = (token: string, body: unknown) =>
      request(server()).patch('/api/org-settings').set(helpers.auth(token)).set('If-Match', String(orgRows.get(ORG_ID)?.version ?? 0)).send(body as object);

    beforeEach(() => {
      mocks.prismaMock.systemSettings.findUnique.mockResolvedValue(stored(DEFAULTS));
    });

    it('describes the added fields on the generated page: the nested one as an object, the top-level one as a switch', async () => {
      const admin = await helpers.admin();
      const { body } = await request(server()).get('/api/org-settings').set(helpers.auth(admin.accessToken)).expect(200);
      const byKey = Object.fromEntries(body.data.namespaces.map((n: any) => [n.key, n]));
      expect(Object.keys(byKey)).toEqual(['notifications', 'ai', 'telemetry', 'quotaPolicy']);
      expect(byKey.telemetry).toMatchObject({ merge: 'tighten', writable: true, fields: [{ name: 'query', kind: 'other' }] });
      expect(byKey.notifications.fields.map((f: any) => [f.name, f.kind])).toEqual(expect.arrayContaining([['weeklyDigest', 'boolean']]));
      // The base fields of the extended namespaces did not become org-overridable.
      expect(byKey.telemetry.fields.map((f: any) => f.name)).toEqual(['query']);
      expect(byKey.notifications.fields.map((f: any) => f.name)).not.toContain('retentionDays');
    });

    it('tightens the nested field: lower applies, higher is refused, the siblings stay the deployment\'s', async () => {
      const admin = await helpers.admin();
      const lower = await orgPatch(admin.accessToken, { telemetry: { query: { slowQuerySeconds: 4 } } }).expect(200);
      expect(lower.body.data.value.telemetry).toEqual({ query: { slowQuerySeconds: 4 } });
      // The organization sees the field it may set, not the rest of the deployment's telemetry policy.
      expect(lower.body.data.effective.telemetry).toEqual({ query: { slowQuerySeconds: 4 } });

      const higher = await orgPatch(admin.accessToken, { telemetry: { query: { slowQuerySeconds: 90 } } }).expect(200);
      expect(higher.body.data.value.telemetry).toEqual({ query: { slowQuerySeconds: 90 } });
      // Stored as asked, but the effective value never exceeds the deployment's 10.
      expect(higher.body.data.effective.telemetry).toEqual({ query: { slowQuerySeconds: 10 } });
    });

    it('never shows an organization the telemetry settings it may not change', async () => {
      const admin = await helpers.admin();
      const { body } = await request(server()).get('/api/org-settings').set(helpers.auth(admin.accessToken)).expect(200);
      expect(body.data.effective.telemetry).toEqual({ query: { slowQuerySeconds: 10 } });
      expect(JSON.stringify(body.data.effective.telemetry)).not.toMatch(/retentionDays|instanceId|assistant|maxRows|provider/);
      // The namespaces that were designed per organization keep showing their whole policy.
      expect(body.data.effective.notifications).toMatchObject({ browserEnabled: true, weeklyDigest: true });
    });

    it('refuses an organization that names a system-only field, beside the extension or at the top', async () => {
      const admin = await helpers.admin();
      await orgPatch(admin.accessToken, { telemetry: { query: { maxRows: 1 } } }).expect(400);
      await orgPatch(admin.accessToken, { telemetry: { query: { slowQuerySeconds: 5, maxRows: 1 } } }).expect(400);
      await orgPatch(admin.accessToken, { telemetry: { enabled: true } }).expect(400);
      await orgPatch(admin.accessToken, { telemetry: { retentionDays: 1 } }).expect(400);
      await orgPatch(admin.accessToken, { notifications: { retentionDays: 1 } }).expect(400);
      expect(orgRows.size).toBe(0);
    });

    it('lets an organization switch the digest off and never on again', async () => {
      const admin = await helpers.admin();
      const off = await orgPatch(admin.accessToken, { notifications: { weeklyDigest: false } }).expect(200);
      expect(off.body.data.effective.notifications).toMatchObject({ weeklyDigest: false, browserEnabled: true });

      // The deployment turns the digest off: an organization's `true` cannot bring it back.
      mocks.prismaMock.systemSettings.findUnique.mockResolvedValue(stored({ ...DEFAULTS, notifications: { ...DEFAULTS.notifications, weeklyDigest: false } }));
      const on = await orgPatch(admin.accessToken, { notifications: { weeklyDigest: true } }).expect(200);
      expect(on.body.data.effective.notifications.weeklyDigest).toBe(false);
    });

    it('lets an organization lower the contributed quota and not raise it', async () => {
      const admin = await helpers.admin();
      const lowered = await orgPatch(admin.accessToken, { quotaPolicy: { dailyLimit: 10 } }).expect(200);
      expect(lowered.body.data.effective.quotaPolicy).toEqual({ dailyLimit: 10, warnAtPercent: 80 });
      const raised = await orgPatch(admin.accessToken, { quotaPolicy: { dailyLimit: 5000 } }).expect(200);
      expect(raised.body.data.effective.quotaPolicy.dailyLimit).toBe(1000);
      await orgPatch(admin.accessToken, { quotaPolicy: { warnAtPercent: 5 } }).expect(400);
    });
  });

  describe('the core user fields', () => {
    const userValue = (extra: Record<string, unknown> = {}) => ({ theme: 'system', profile: { imageSource: 'none', imageObjectId: null }, ...extra });

    it('stores and returns the core timezone and the pronouns extension and lists the registered theme', async () => {
      const user = await helpers.user();
      const row = (value: unknown, version = 1) => ({ id: `settings-${user.id}`, userId: user.id, value, version, updatedAt: new Date() });
      mocks.prismaMock.userSettings.findUnique.mockResolvedValue(row(userValue()));
      mocks.prismaMock.userSettings.update.mockImplementation(async ({ data }: any) => row(data.value, 2));
      mocks.prismaMock.user.update.mockResolvedValue({});

      const { body } = await request(server())
        .patch('/api/user-settings')
        .set(helpers.auth(user.accessToken))
        .send({ theme: 'high-contrast', profile: { timezone: 'Europe/Paris', pronouns: 'she/her' } })
        .expect(200);
      expect(body.data.theme).toBe('high-contrast');
      expect(body.data.profile).toMatchObject({ timezone: 'Europe/Paris', pronouns: 'she/her', imageSource: 'none', imageObjectId: null });
      expect(body.data.themeOptions).toEqual([{ id: 'high-contrast', label: 'High contrast' }]);
      expect(mocks.prismaMock.userSettings.update.mock.calls[0][0].data.value.profile.timezone).toBe('Europe/Paris');
    });

    it('rejects an unregistered theme, an invalid timezone and oversized pronouns', async () => {
      const user = await helpers.user();
      mocks.prismaMock.userSettings.findUnique.mockResolvedValue({ id: 's', userId: user.id, value: userValue(), version: 1, updatedAt: new Date() });
      await request(server()).patch('/api/user-settings').set(helpers.auth(user.accessToken)).send({ theme: 'sepia' }).expect(400);
      await request(server()).patch('/api/user-settings').set(helpers.auth(user.accessToken)).send({ profile: { timezone: 'Mars/Olympus' } }).expect(400);
      await request(server()).patch('/api/user-settings').set(helpers.auth(user.accessToken)).send({ profile: { pronouns: 'x'.repeat(33) } }).expect(400);
    });

    it('deletes the timezone with null and keeps it through an unrelated write', async () => {
      const user = await helpers.user();
      const row = (value: unknown, version = 1) => ({ id: 's', userId: user.id, value, version, updatedAt: new Date() });
      mocks.prismaMock.userSettings.findUnique.mockResolvedValue(row(userValue({ profile: { imageSource: 'none', imageObjectId: null, timezone: 'UTC' } })));
      mocks.prismaMock.userSettings.update.mockImplementation(async ({ data }: any) => row(data.value, 2));
      const kept = await request(server()).patch('/api/user-settings').set(helpers.auth(user.accessToken)).send({ theme: 'dark' }).expect(200);
      expect(kept.body.data.profile.timezone).toBe('UTC');
      const cleared = await request(server()).patch('/api/user-settings').set(helpers.auth(user.accessToken)).send({ profile: { timezone: null } }).expect(200);
      expect(cleared.body.data.profile).not.toHaveProperty('timezone');
    });
  });
});
