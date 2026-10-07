// =============================================================================
// Integration tests for GET /api/admin/doctor/support-bundle (issue #772)
// =============================================================================
//
// The package's own tests (`packages/platform-api/test/doctor/support-bundle/`)
// prove what the service and the redaction pass DECIDE. This suite drives the
// route through the REAL AppModule, guard stack and app sections:
//
//   1. RBAC in both directions (anonymous 401, viewer 403, admin 200), and the
//      exact permission the controller declares (system_settings:read, no new
//      permission).
//   2. The attachment: headers, filename, `supportBundleSchema` parse, the
//      sections the app registers (meta, doctor, versions, telemetry).
//   3. The telemetry section: `omitted` without telemetry:query or while
//      telemetry is off; with both, the 24-hour verdict and tiles and no `sql`.
//   4. One `support_bundle:download` audit row per download, without email.
//   5. The time bound, with every section configured (fakes).
// =============================================================================

import request from 'supertest';

import { supportBundleSchema } from '@marinoscar/platform-contract/doctor';
import { DoctorService } from '@marinoscar/platform-api/doctor';

import { PERMISSIONS_KEY } from '../../src/auth/decorators/permissions.decorator';
import { doctorModule } from '../../src/doctor/doctor.config';
import { AboutService } from '../../src/about/about.service';
import { TelemetryDashboardService } from '../../src/telemetry/dashboard/telemetry-dashboard.service';
import { GreptimeClient } from '../../src/telemetry/greptime/greptime.client';
import { TelemetryStackService } from '../../src/telemetry/stack/telemetry-stack.service';
import { TelemetrySettingsService } from '../../src/telemetry/telemetry-settings.service';
import { TelemetryStatusService } from '../../src/telemetry/telemetry-status.service';
import { TestContext, closeTestApp, createTestApp } from '../helpers/test-app.helper';
import { resetPrismaMock } from '../mocks/prisma.mock';
import { setupBaseMocks } from '../fixtures/mock-setup.helper';
import { authHeader, createMockAdminUser, createMockViewerUser } from '../helpers/auth-mock.helper';

const ROUTE = '/api/admin/doctor/support-bundle';
const SupportBundleController = doctorModule.controllers![1] as { name: string; prototype: { download: object } };

const SUMMARY = {
  range: { from: '2026-10-05T00:00:00.000Z', to: '2026-10-06T00:00:00.000Z', bucketSeconds: 2880 },
  truncated: false,
  sql: ['SELECT count(*) FROM opentelemetry_traces WHERE secret = 1'],
  verdict: { level: 'degraded', reasons: ['Error rate 3% (from 10.0.0.9)'] },
  tiles: [
    { key: 'requestsPerMin', label: 'Requests/min', value: 12, previous: 10, unit: 'req/min', sparkline: [1, 2, null] },
    { key: 'lastDataAt', label: 'Latest data', value: '2026-10-06T00:00:00.000Z', previous: null, unit: 'timestamp', sparkline: [] },
  ],
  runtime: [{ key: 'heapUsed', label: 'Heap used', value: 1024, previous: 900, unit: 'bytes', sparkline: [1] }],
  unknownRoutes: {
    requests: 3,
    bearer: 0,
    anonymous: 3,
    previousRequests: 0,
    previousBearer: 0,
    topRoutes: [{ method: 'GET', route: '/wp-login.php', count: 3, bearer: 0, anonymous: 3 }],
    truncated: false,
    sql: ['SELECT 1'],
  },
};

describe('Support bundle API (Integration)', () => {
  let context: TestContext;

  beforeAll(async () => {
    context = await createTestApp({ useMockDatabase: true });
  }, 60000);

  afterAll(async () => {
    await closeTestApp(context);
  });

  beforeEach(() => {
    resetPrismaMock();
    setupBaseMocks();
    context.prismaMock.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
    context.module.get(DoctorService).invalidate();
    jest.restoreAllMocks();
  });

  const server = () => context.app.getHttpServer();
  const get = <T>(token: { new (...args: never[]): T } | (abstract new (...args: never[]) => T)) =>
    context.module.get(token as never, { strict: false }) as T;

  /** An admin whose role lacks `telemetry:query` (everything else unchanged). */
  async function adminWithoutTelemetryQuery() {
    const admin = await createMockAdminUser(context);
    const findUnique = context.prismaMock.user.findUnique as jest.Mock;
    const original = findUnique.getMockImplementation()!;
    findUnique.mockImplementation(async (args: unknown) => {
      const user = await original(args);
      if (!user || user.id !== admin.id) return user;
      return {
        ...user,
        userRoles: user.userRoles.map((userRole: any) => ({
          ...userRole,
          role: {
            ...userRole.role,
            rolePermissions: userRole.role.rolePermissions.filter((rp: any) => rp.permission.name !== 'telemetry:query'),
          },
        })),
      };
    });
    return admin;
  }

  /** Telemetry configured, switched on and answering, with fakes. */
  function telemetryOn() {
    jest.spyOn(get(GreptimeClient), 'isConfigured').mockReturnValue(true);
    jest.spyOn(get(TelemetrySettingsService), 'getPolicy').mockResolvedValue({ enabled: true } as never);
    jest.spyOn(get(TelemetryStatusService), 'getStatus').mockResolvedValue({
      configured: true,
      reachable: true,
      version: '0.17.0',
      database: 'customer_db_name',
      ttl: { raw: '30days', days: 30 },
      retentionDays: 30,
      tables: [{ name: 'opentelemetry_traces', rows: 1200 }],
      error: null,
    });
    jest.spyOn(get(TelemetryStackService), 'getStatus').mockResolvedValue({
      agent: 'unavailable',
      agentError: 'http://stack-agent.internal:7070 refused',
      services: [{ name: 'greptimedb', state: 'running', health: 'healthy' }],
      deploy: null,
    });
    return jest.spyOn(get(TelemetryDashboardService), 'summary').mockResolvedValue(SUMMARY as never);
  }

  describe('permissions', () => {
    it('declares exactly system_settings:read, and invents no new permission', () => {
      expect(SupportBundleController.name).toBe('SupportBundleController');
      expect(Reflect.getMetadata(PERMISSIONS_KEY, SupportBundleController.prototype.download)).toEqual(['system_settings:read']);
    });

    it('refuses an unauthenticated caller with 401', async () => {
      await request(server()).get(ROUTE).expect(401);
    });

    it('refuses a viewer with 403', async () => {
      const viewer = await createMockViewerUser(context);

      await request(server()).get(ROUTE).set(authHeader(viewer.accessToken)).expect(403);
    });
  });

  describe('the attachment', () => {
    it('is a JSON file that parses with supportBundleSchema, with every app section', async () => {
      const admin = await createMockAdminUser(context);

      const response = await request(server()).get(ROUTE).set(authHeader(admin.accessToken)).buffer(true).parse((res, done) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => (text += chunk));
        res.on('end', () => done(null, text));
      });

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toBe('application/json; charset=utf-8');
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers['content-disposition']).toMatch(/^attachment; filename="support-bundle-my-app-\d{8}T\d{6}Z\.json"$/);

      const bundle = supportBundleSchema.parse(JSON.parse(response.body as string));
      expect(Object.keys(bundle.sections).sort()).toEqual(['doctor', 'egress', 'meta', 'telemetry', 'versions']);
      expect(bundle.sections.egress.status).toBe('ok');
      expect(bundle.sections.meta.status).toBe('ok');
      expect(bundle.sections.doctor.status).toBe('ok');
      expect(bundle.sections.versions.status).toBe('ok');
      // Not enveloped: the body IS the bundle.
      expect(bundle).not.toHaveProperty('data');
    }, 30000);

    it('carries the versions allowlist only: never hostname, domain, the deploy-info path or its error', async () => {
      jest.spyOn(get(AboutService), 'describe').mockResolvedValue({
        api: { version: '1.2.3', deploymentMode: 'self-hosted' },
        deployInfoStatus: 'invalid',
        deployInfoPath: '/srv/customer-name/deploy/info.json',
        deployInfoError: 'Unexpected token in {"smtpPassword":"x"}',
        app: { name: 'my-app', version: '1.2.3', commitSha: 'a'.repeat(40), ref: 'main' },
        installedAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-02-01T00:00:00.000Z',
        deployedBy: { cli: 'appctl', version: '0.9.0' },
        domain: 'app.customer-name.example',
        remote: { commitsBehind: 2, checkedAt: '2026-02-01T00:00:00.000Z' },
        run: null,
        lastCommand: 'update',
        bindPort: 8443,
        proxy: { mode: 'container', container: 'customer-proxy', certificateExpiresAt: null } as never,
        host: {
          hostname: 'customer-host-01',
          os: 'Ubuntu 24.04',
          kernel: '6.8.0-1012-azure',
          arch: 'x64',
          cpus: 4,
          memoryBytes: 8_000_000_000,
          dockerVersion: '28.3.2',
          composeVersion: '2.39.1',
          capturedAt: null,
        } as never,
        history: [
          { at: '2026-02-01T00:00:00.000Z', command: 'update', commitSha: 'b'.repeat(40), previousCommitSha: null, ref: 'main', durationMs: 900, cliVersion: '0.9.0', outcome: 'success' },
          { at: '2026-01-01T00:00:00.000Z', command: 'install', commitSha: 'c'.repeat(40), previousCommitSha: null, ref: 'main', durationMs: 1800, cliVersion: '0.8.0', outcome: 'success' },
        ] as never,
        runtime: { processStartedAt: '2026-02-01T00:00:00.000Z', nodeVersion: 'v24.1.0', environment: 'production' },
        database: { status: 'up', responseTime: '3ms' },
        databaseError: null,
      });
      const admin = await createMockAdminUser(context);

      const { text } = await request(server()).get(ROUTE).set(authHeader(admin.accessToken)).expect(200);
      const versions = (supportBundleSchema.parse(JSON.parse(text)).sections.versions as { data: any }).data;

      expect(versions.app).toEqual({ name: 'my-app', version: '1.2.3', commitSha: 'a'.repeat(40), ref: 'main' });
      expect(versions.history).toEqual({
        count: 2,
        last: { at: '2026-02-01T00:00:00.000Z', command: 'update', commitSha: 'b'.repeat(40), cliVersion: '0.9.0', durationMs: 900 },
      });
      expect(versions.host).not.toHaveProperty('hostname');
      expect(versions.proxy).toEqual({ mode: 'container' });
      for (const excluded of ['customer-host-01', 'customer-name', 'customer-proxy', '"bindPort"', 'smtpPassword', 'c'.repeat(40)]) {
        expect(text).not.toContain(excluded);
      }
    }, 30000);
  });

  describe('the telemetry section', () => {
    it('is omitted, with a reason, for a caller without telemetry:query', async () => {
      await context.module.get(DoctorService).run({ refresh: true });
      const summary = telemetryOn();
      const admin = await adminWithoutTelemetryQuery();

      const { text } = await request(server()).get(ROUTE).set(authHeader(admin.accessToken)).expect(200);

      expect(supportBundleSchema.parse(JSON.parse(text)).sections.telemetry).toEqual({
        status: 'omitted',
        reason: 'requires the telemetry:query permission',
      });
      expect(summary).not.toHaveBeenCalled();
    }, 30000);

    it('is omitted while no store is configured', async () => {
      jest.spyOn(get(GreptimeClient), 'isConfigured').mockReturnValue(false);
      const admin = await createMockAdminUser(context);

      const { text } = await request(server()).get(ROUTE).set(authHeader(admin.accessToken)).expect(200);

      expect(supportBundleSchema.parse(JSON.parse(text)).sections.telemetry).toEqual({
        status: 'omitted',
        reason: 'no telemetry store is configured',
      });
    }, 30000);

    it('is omitted while telemetry is switched off', async () => {
      // The Doctor report is cached first so its telemetry checks never see the fake.
      await context.module.get(DoctorService).run({ refresh: true });
      jest.spyOn(get(GreptimeClient), 'isConfigured').mockReturnValue(true);
      jest.spyOn(get(TelemetrySettingsService), 'getPolicy').mockResolvedValue({ enabled: false } as never);
      const admin = await createMockAdminUser(context);

      const { text } = await request(server()).get(ROUTE).set(authHeader(admin.accessToken)).expect(200);

      expect(supportBundleSchema.parse(JSON.parse(text)).sections.telemetry).toEqual({
        status: 'omitted',
        reason: 'telemetry is switched off',
      });
    }, 30000);

    it('carries the 24-hour verdict and tiles, and no sql, sparkline or route', async () => {
      await context.module.get(DoctorService).run({ refresh: true });
      const summary = telemetryOn();
      const admin = await createMockAdminUser(context);

      const { text } = await request(server()).get(ROUTE).set(authHeader(admin.accessToken)).expect(200);
      const telemetry = supportBundleSchema.parse(JSON.parse(text)).sections.telemetry as { status: string; data: any };

      expect(summary).toHaveBeenCalledWith(admin.id, { range: '24h' });
      expect(telemetry.status).toBe('ok');
      expect(telemetry.data.summary).toEqual({
        range: '24h',
        verdict: { level: 'degraded', reasons: ['Error rate 3% (from [ip])'] },
        tiles: [
          { key: 'requestsPerMin', label: 'Requests/min', value: 12, previous: 10, unit: 'req/min' },
          { key: 'lastDataAt', label: 'Latest data', value: '2026-10-06T00:00:00.000Z', previous: null, unit: 'timestamp' },
        ],
        runtime: [{ key: 'heapUsed', label: 'Heap used', value: 1024, previous: 900, unit: 'bytes' }],
      });
      expect(telemetry.data.status).toMatchObject({ reachable: true, ttlDays: 30, tableCount: 1 });
      expect(telemetry.data.stack).toEqual({ agent: 'unavailable', services: [{ name: 'greptimedb', state: 'running', health: 'healthy' }] });
      expect(telemetry.data.metricGroups).toEqual(expect.arrayContaining(['host', 'database', 'queue']));
      for (const excluded of ['"sql"', 'sparkline', 'wp-login', 'customer_db_name', 'stack-agent.internal', 'unknownRoutes']) {
        expect(text).not.toContain(excluded);
      }
    }, 30000);
  });

  describe('audit', () => {
    it('records one support_bundle:download event per download, without the email', async () => {
      const admin = await createMockAdminUser(context);
      const create = context.prismaMock.auditEvent.create as jest.Mock;
      create.mockClear();

      await request(server()).get(ROUTE).set(authHeader(admin.accessToken)).expect(200);

      const rows = create.mock.calls.map(([args]) => args.data).filter((data) => data.action === 'support_bundle:download');
      expect(rows).toEqual([
        {
          actorUserId: admin.id,
          action: 'support_bundle:download',
          targetType: 'deployment',
          targetId: 'support_bundle',
          meta: {
            sections: expect.stringMatching(/^(meta|doctor|egress|versions|telemetry)=(ok|omitted|error)(,(meta|doctor|egress|versions|telemetry)=(ok|omitted|error)){4}$/),
            bytes: expect.any(Number),
            replacements: expect.any(Number),
          },
        },
      ]);
      expect(JSON.stringify(rows)).not.toContain(admin.email);
    }, 30000);
  });

  describe('bounds', () => {
    it('builds in well under 15 s with every section configured (fakes)', async () => {
      await context.module.get(DoctorService).run({ refresh: true });
      telemetryOn();
      const admin = await createMockAdminUser(context);

      const started = Date.now();
      await request(server()).get(ROUTE).set(authHeader(admin.accessToken)).expect(200);

      expect(Date.now() - started).toBeLessThan(15_000);
    }, 30000);
  });
});
