import request from 'supertest';

import { TestContext, createTestApp, closeTestApp } from '../helpers/test-app.helper';
import { resetPrismaMock } from '../mocks/prisma.mock';
import { setupBaseMocks } from '../fixtures/mock-setup.helper';
import { createMockAdminUser, createMockViewerUser, authHeader } from '../helpers/auth-mock.helper';
import { GreptimeClient, TELEMETRY_SQL_DIALECT, TELEMETRY_STORE } from '@marinoscar/platform-api/telemetry';
import { telemetryProviders } from '../../src/platform/telemetry/telemetry.config';

// =============================================================================
// The telemetry store port, through the REAL AppModule wiring (PP-14.11)
// =============================================================================
//
// The reference app selects the built-in `greptime` store (the `memory` example
// is registered but inert). Through the real application: the port is bound to
// the one `GreptimeClient` and the services hold it; `GET /api/admin/telemetry/store`
// answers in the `{ data }` envelope behind `telemetry:read`, lists the registered
// stores (the built-in and the example) and has no descriptor for GreptimeDB;
// a save is refused for it; `GET /api/admin/telemetry/config` names the store.
// =============================================================================

const BASE = '/api/admin/telemetry';

describe('Telemetry store (integration)', () => {
  let context: TestContext;

  beforeAll(async () => {
    context = await createTestApp({ useMockDatabase: true });
  });

  afterAll(async () => {
    await closeTestApp(context);
  });

  beforeEach(() => {
    resetPrismaMock();
    setupBaseMocks();
    context.prismaMock.auditEvent.create.mockResolvedValue({} as never);
    context.prismaMock.systemSettings.findUnique.mockResolvedValue(null as never);
  });

  it('binds the port to the GreptimeClient, and the services hold it', () => {
    const store = context.module.get(TELEMETRY_STORE);

    expect(store).toBe(context.module.get(GreptimeClient));
    expect(context.module.get(TELEMETRY_SQL_DIALECT).id).toBe('greptime');
    for (const name of ['TelemetryQueryService', 'TelemetrySchemaService', 'TelemetryDashboardService', 'TelemetryStatusService']) {
      expect((context.module.get(telemetryProviders[name]) as unknown as { store: unknown }).store).toBe(store);
    }
  });

  describe('GET /store', () => {
    it('is 401 without a token and 403 for a viewer', async () => {
      await request(context.app.getHttpServer()).get(`${BASE}/store`).expect(401);
      const viewer = await createMockViewerUser(context);
      await request(context.app.getHttpServer()).get(`${BASE}/store`).set(authHeader(viewer.accessToken)).expect(403);
    });

    it('describes the built-in store inside the envelope: registered stores, no descriptor', async () => {
      const admin = await createMockAdminUser(context);
      const res = await request(context.app.getHttpServer()).get(`${BASE}/store`).set(authHeader(admin.accessToken)).expect(200);

      expect(res.body.data).toMatchObject({
        active: { id: 'greptime', label: 'GreptimeDB' },
        descriptor: null,
        settings: {},
        version: 0,
        updatedAt: null,
      });
      expect(res.body.data.stores.map((s: { id: string }) => s.id)).toEqual(['greptime', 'memory']);
    });
  });

  describe('PUT /store', () => {
    it('is 403 without telemetry:write and 400 for the built-in store', async () => {
      const viewer = await createMockViewerUser(context);
      await request(context.app.getHttpServer()).put(`${BASE}/store`).set(authHeader(viewer.accessToken)).send({ settings: {} }).expect(403);

      const admin = await createMockAdminUser(context);
      await request(context.app.getHttpServer()).put(`${BASE}/store`).set(authHeader(admin.accessToken)).send({ settings: {} }).expect(400);
    });

    it('validates the body with the contract schema', async () => {
      const admin = await createMockAdminUser(context);
      await request(context.app.getHttpServer())
        .put(`${BASE}/store`)
        .set(authHeader(admin.accessToken))
        .send({ secrets: { apiKey: 42 } })
        .expect(400);
    });
  });

  it('names the store on GET /config', async () => {
    const admin = await createMockAdminUser(context);
    const res = await request(context.app.getHttpServer()).get(`${BASE}/config`).set(authHeader(admin.accessToken)).expect(200);

    expect(res.body.data.store).toEqual({ id: 'greptime', label: 'GreptimeDB' });
  });
});
