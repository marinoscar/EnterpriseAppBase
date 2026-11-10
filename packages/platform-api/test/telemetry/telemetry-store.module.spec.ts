import 'reflect-metadata';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { z } from 'zod';

import { TEST_PERMISSIONS_HEADER } from '../../src/testing';
import {
  GreptimeClient,
  TELEMETRY_PERMISSIONS,
  TELEMETRY_SQL_DIALECT,
  TELEMETRY_STORE,
  TelemetryQueryService,
  TelemetrySchemaService,
  registerTelemetryStore,
  type TelemetryQueryResult,
  type TelemetryStore,
} from '../../src/telemetry/index';
import { TelemetryDashboardService } from '../../src/telemetry/dashboard/telemetry-dashboard.service';
import { TelemetryReachableDoctorCheck } from '../../src/telemetry/doctor/telemetry-reachable.doctor-check';
import { TelemetryRetentionHandler } from '../../src/telemetry/handlers/telemetry-retention.handler';
import { TelemetryStatusService } from '../../src/telemetry/telemetry-status.service';
import { TelemetrySettingsService } from '../../src/telemetry/telemetry-settings.service';
import { GREPTIME_SQL_DIALECT } from '../../src/telemetry/stores/greptime/greptime.dialect';
import { bootStubApp } from '../../src/telemetry/testing/index';

// =============================================================================
// forRoot({ store }) reaches every consumer, through the REAL module (PP-14.11)
// =============================================================================
//
// Not a toy module without consumers: the real `TelemetryModule` is booted and
// every provider that reads the store is asked which one it holds. An override
// that only the module's own provider saw would pass a unit test and break here.
// =============================================================================

const CONSUMERS = [
  TelemetryQueryService,
  TelemetrySchemaService,
  TelemetryDashboardService,
  TelemetryStatusService,
  TelemetrySettingsService,
  TelemetryRetentionHandler,
  TelemetryReachableDoctorCheck,
] as const;

/** The store a consumer holds (each keeps it in a private `store`, injected from `TELEMETRY_STORE`). */
function storeOf(app: NestFastifyApplication, consumer: (typeof CONSUMERS)[number]): unknown {
  return (app.get(consumer, { strict: false }) as unknown as { store: unknown }).store;
}

describe('the default store', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await bootStubApp({});
  });
  afterAll(() => app.close());

  it('binds the port to the GreptimeClient and the dialect to the built-in one', () => {
    expect(app.get(TELEMETRY_STORE)).toBe(app.get(GreptimeClient));
    expect(app.get(TELEMETRY_SQL_DIALECT)).toBe(GREPTIME_SQL_DIALECT);
  });

  it.each(CONSUMERS)('hands the same store to %p', (consumer) => {
    expect(storeOf(app, consumer)).toBe(app.get(TELEMETRY_STORE));
  });

  it('serves the built-in store on the store route: no descriptor, its form is the connection form', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/admin/telemetry/store',
      headers: { [TEST_PERMISSIONS_HEADER]: TELEMETRY_PERMISSIONS.READ },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({ active: { id: 'greptime' }, descriptor: null });
  });

  it('refuses a save on the built-in store', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/admin/telemetry/store',
      payload: { settings: {} },
      headers: { [TEST_PERMISSIONS_HEADER]: TELEMETRY_PERMISSIONS.WRITE },
    });

    expect(response.statusCode).toBe(400);
  });
});

describe('a registered store', () => {
  const queries: string[] = [];
  const built: Array<{ settings: Record<string, unknown>; apiKey: string | null }> = [];

  registerTelemetryStore({
    id: 'module-fake',
    label: 'Module fake',
    settingsSchema: z.object({ database: z.string().default('fake-db') }),
    defaults: { database: 'fake-db' },
    secrets: [{ name: 'apiKey', label: 'API key', required: true }],
    build: async ({ settings, secret }) => {
      built.push({ settings, apiKey: await secret('apiKey') });
      const store: TelemetryStore = {
        id: 'module-fake',
        database: String(settings.database),
        isConfigured: () => true,
        configurationProblem: () => null,
        query: async (sql): Promise<TelemetryQueryResult> => {
          queries.push(sql);
          return { fields: [{ name: 'one', dataTypeID: 20 }], rows: [[1]] };
        },
        schema: async () => ({ tables: [] }),
        ping: async () => ({ reachable: true, version: 'module fake 1' }),
        close: async () => undefined,
      };
      return { store, dialect: { ...GREPTIME_SQL_DIALECT, id: 'module-fake' } };
    },
  });

  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await bootStubApp({
      store: 'module-fake',
      ports: {
        policy: { enabled: true },
        rows: { telemetry_store: { 'module-fake': { database: 'from-the-row' } } },
        credentials: { 'telemetry_module-fake:apiKey': 'stored-key-1' },
      },
    });
  });
  afterAll(() => app.close());

  it('builds the store from its row and its secret, and binds the port to what the resolver holds', () => {
    expect(built[0]).toEqual({ settings: { database: 'from-the-row' }, apiKey: 'stored-key-1' });
    const port = app.get(TELEMETRY_STORE) as TelemetryStore;
    expect(port.id).toBe('module-fake');
    expect(port.database).toBe('from-the-row');
    expect(app.get(TELEMETRY_SQL_DIALECT).id).toBe('module-fake');
  });

  it.each(CONSUMERS)('hands the same store to %p', (consumer) => {
    expect(storeOf(app, consumer)).toBe(app.get(TELEMETRY_STORE));
  });

  it('runs an explorer query through the registered store, behind the platform guard', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/admin/telemetry/query',
      payload: { sql: 'SELECT 1 AS one' },
      headers: { [TEST_PERMISSIONS_HEADER]: TELEMETRY_PERMISSIONS.QUERY },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).rows).toEqual([[1]]);
    expect(queries.at(-1)).toMatch(/^SELECT 1 AS one LIMIT \d+$/);

    const refused = await app.inject({
      method: 'POST',
      url: '/admin/telemetry/query',
      payload: { sql: 'DELETE FROM t' },
      headers: { [TEST_PERMISSIONS_HEADER]: TELEMETRY_PERMISSIONS.QUERY },
    });
    expect(refused.statusCode).toBe(400);
    expect(queries.some((sql) => sql.startsWith('DELETE'))).toBe(false);
  });

  it('describes the store on the status and store routes, with the secret by presence only', async () => {
    const status = JSON.parse(
      (await app.inject({ method: 'GET', url: '/admin/telemetry/status', headers: { [TEST_PERMISSIONS_HEADER]: TELEMETRY_PERMISSIONS.READ } })).body,
    );
    expect(status).toMatchObject({ configured: true, reachable: true, version: 'module fake 1', database: 'from-the-row' });

    const store = await app.inject({ method: 'GET', url: '/admin/telemetry/store', headers: { [TEST_PERMISSIONS_HEADER]: TELEMETRY_PERMISSIONS.READ } });
    const body = JSON.parse(store.body);
    expect(body.descriptor.fields.find((f: { name: string }) => f.name === 'apiKey')).toMatchObject({ kind: 'secret', hasValue: true });
    expect(store.body).not.toContain('stored-key-1');
  });

  it('rebuilds with a new secret when it is saved, and the consumers see the new store', async () => {
    const before = app.get(TELEMETRY_STORE) as TelemetryStore;
    const response = await app.inject({
      method: 'PUT',
      url: '/admin/telemetry/store',
      payload: { settings: { database: 'saved-db' }, secrets: { apiKey: 'rotated-key-2' } },
      headers: { [TEST_PERMISSIONS_HEADER]: TELEMETRY_PERMISSIONS.WRITE },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain('rotated-key-2');
    expect(built.at(-1)).toEqual({ settings: { database: 'saved-db' }, apiKey: 'rotated-key-2' });
    // The port is the resolver, which delegates to the rebuilt store.
    expect(app.get(TELEMETRY_STORE)).toBe(before);
    expect((app.get(TELEMETRY_STORE) as TelemetryStore).database).toBe('saved-db');
  });
});
