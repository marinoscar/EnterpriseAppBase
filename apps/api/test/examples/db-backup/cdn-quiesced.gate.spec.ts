// =============================================================================
// The `cdn-quiesced` restore gate: an app adds a pre-flight check WITHOUT touching a package (PP-14.12)
// =============================================================================
//
// `apps/api/src/platform-extensions/db-backup/cdn-quiesced.gate.ts` is a
// `RestoreGateDefinition`, registered from `app-registrations/db-backup.ts` with
// `registerRestoreGate` (the same function the eight built-ins use). This suite
// proves, against the REAL application wiring:
//
//   1. the gate passes the restore gate conformance kit: it answers, it is
//      read-only (a context that records every write, plus a watched counter),
//      it is repeatable and it evaluates to a pre-flight row;
//   2. it is registered after the eight built-ins and INERT unless configured:
//      with no `cdn` settings namespace registered it passes ("nothing to
//      quiesce"), so a fresh install's restore is unchanged;
//   3. once the app has a `cdn` namespace, the real pre-flight blocks the restore
//      until it is quiesced, the real restore service REFUSES to start (nothing
//      is queued), and the schema override does not clear it;
//   4. nothing the pre-flight does is a mutation: the cluster received no DDL.
//
// No Postgres here: the pre-flight's cluster calls go through its injected seam.
// =============================================================================

import { restoreGateRegistry } from '@marinoscar/platform-api/db-backup';
import {
  DatabaseRestorePreflightService,
  DatabaseRestoreService,
  describeRestoreGateConformance,
} from '@marinoscar/platform-api/db-backup/testing';
import { JobsService } from '@marinoscar/platform-api/jobs';
import { SystemSettingsService } from '@marinoscar/platform-api/settings';
import { BUILTIN_RESTORE_GATE_IDS } from '@marinoscar/platform-contract/db-backup';

import {
  CDN_QUIESCED_GATE_ID,
  CDN_SETTINGS_EXAMPLE,
  CDN_SETTINGS_KEY,
  cdnQuiescedGate,
} from '../../../src/platform-extensions/db-backup/cdn-quiesced.gate';
// The registration under test: what `platform/db-backup/db-backup.config.ts` imports.
import '../../../src/app-registrations/db-backup';
import { setupBaseMocks } from '../../fixtures/mock-setup.helper';
import { closeTestApp, createTestApp, type TestContext } from '../../helpers/test-app.helper';
import { resetPrismaMock } from '../../mocks/prisma.mock';

// ---- 1. the conformance kit -----------------------------------------------------------

let watchedCalls = 0;

describeRestoreGateConformance(cdnQuiescedGate, {
  describe,
  it,
  expect,
  scenarios: [
    { name: 'the CDN is quiesced', settings: { [CDN_SETTINGS_KEY]: { quiesced: true } }, expectStatus: 'pass' },
    { name: 'the CDN is still serving', settings: { [CDN_SETTINGS_KEY]: { quiesced: false } }, expectStatus: 'fail' },
    { name: 'the app has no CDN namespace', settings: {}, expectStatus: 'pass' },
  ],
  // The gate calls nothing but `settings.get`; this counter stays at zero.
  watch: [{ name: 'a CDN API call', calls: () => watchedCalls }],
});

// ---- 2. registration ---------------------------------------------------------------

describe('the gate is registered by the reference app', () => {
  it('runs after the eight built-ins', () => {
    expect(restoreGateRegistry.ids()).toEqual([...BUILTIN_RESTORE_GATE_IDS, CDN_QUIESCED_GATE_ID]);
    expect(restoreGateRegistry.get(CDN_QUIESCED_GATE_ID)).toBe(cdnQuiescedGate);
  });

  it('declares itself as an app gate: a failure blocks outright, with no override', () => {
    expect(cdnQuiescedGate.kind).toBeUndefined(); // the registry defaults a gate to kind "app"
    expect(cdnQuiescedGate.label).toBe('CDN quiesced');
  });

  it('declares the namespace an app with a CDN would register, with a default that blocks', () => {
    expect(CDN_SETTINGS_EXAMPLE.key).toBe(CDN_SETTINGS_KEY);
    expect(CDN_SETTINGS_EXAMPLE.defaults).toEqual({ quiesced: false });
    expect(CDN_SETTINGS_EXAMPLE.storedSchema.safeParse({ quiesced: 'yes' }).success).toBe(false);
  });
});

// ---- 3 and 4. the real application ---------------------------------------------------

describe('the real pre-flight and restore service with the cdn-quiesced gate', () => {
  let context: TestContext;

  beforeAll(async () => {
    context = await createTestApp({ useMockDatabase: true });
  });

  afterAll(async () => {
    await closeTestApp(context);
  });

  const RUN = {
    id: '11111111-1111-4111-8111-111111111111',
    status: 'completed',
    trigger: 'manual',
    storageKey: 'database-backups/app/2026/10/app-20261001T020000Z-1111.dump',
    storageProvider: 's3',
    migrationName: '0033_add_android_app',
    sizeBytes: 100n,
    createdAt: new Date('2026-10-01T02:00:00.000Z'),
  };

  /** The statements the fake cluster received: the no-mutation proof. */
  let sql: string[];

  /** A healthy cluster behind the pre-flight's seam, so every built-in passes. */
  const healthySeam = () => ({
    resolveConnection: () => ({
      host: 'db',
      port: '5432',
      user: 'app',
      password: 'secret',
      database: 'postgres',
      sslMode: null,
      liveDatabase: 'app',
    }),
    withAdminConnection: async (_config: unknown, fn: (client: unknown) => Promise<unknown>) =>
      fn({
        connect: async () => undefined,
        end: async () => undefined,
        query: async (text: string) => {
          sql.push(text);
          if (text.includes('rolcreatedb')) return { rows: [{ can_create: true }] };
          if (text.includes('data_directory')) return { rows: [{ data_directory: '/var/lib/pg' }] };
          if (text.includes('pg_database_size')) return { rows: [{ size: '1000' }] };
          if (text.includes('COUNT(DISTINCT client_addr)')) return { rows: [{ count: '1' }] };
          if (text.includes('rolbypassrls')) return { rows: [{ superuser: false, bypass_rls: false, rls_bypass: 'on' }] };
          return { rows: [] };
        },
      }),
    checkClientVersion: async () => ({ status: 'ok', clientMajor: 17, serverMajor: 17, message: 'ok' }),
    readFreeDiskBytes: async () => 100_000_000n,
  });

  beforeEach(() => {
    resetPrismaMock();
    setupBaseMocks();
    sql = [];
    context.prismaMock.$queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
      const text = strings.join(' ');
      sql.push(text);
      if (text.includes('_prisma_migrations')) return [{ migration_name: '0033_add_android_app' }];
      return [];
    });
    Object.assign(context.module.get(DatabaseRestorePreflightService, { strict: false }), { seam: healthySeam() });
  });

  afterEach(() => jest.restoreAllMocks());

  /** What `getNamespace('cdn')` answers: what an app that registered the namespace would see. */
  const cdnSays = (value: unknown) => {
    const settings = context.module.get(SystemSettingsService, { strict: false });
    const original = settings.getNamespace.bind(settings) as (key: string) => Promise<unknown>;
    jest.spyOn(settings, 'getNamespace').mockImplementation((async (key: string) => {
      if (key === CDN_SETTINGS_KEY) {
        if (value === undefined) throw new Error('the "cdn" system settings namespace is not registered');
        return value;
      }
      return original(key);
    }) as never);
  };

  const preflight = () => context.module.get(DatabaseRestorePreflightService, { strict: false });
  const gateRow = (rows: Array<{ id: string; detail: string }>) => rows.find((row) => row.id === CDN_QUIESCED_GATE_ID);

  it('passes, inert, when the app registers no cdn namespace: a fresh install\'s restore is unchanged', async () => {
    cdnSays(undefined);

    const result = await preflight().check(RUN as never);

    expect(result.outcome).toBe('ok');
    expect(result.gates.map((row) => row.id)).toEqual([...BUILTIN_RESTORE_GATE_IDS, CDN_QUIESCED_GATE_ID]);
    expect(gateRow(result.gates)).toMatchObject({ kind: 'app', verdict: 'pass', title: 'CDN quiesced' });
    expect(gateRow(result.gates)?.detail).toContain('no CDN configured');
  });

  it('passes when the CDN is quiesced', async () => {
    cdnSays({ quiesced: true });

    const result = await preflight().check(RUN as never);

    expect(result.outcome).toBe('ok');
    expect(gateRow(result.gates)).toMatchObject({ verdict: 'pass', detail: 'The CDN is quiesced.' });
  });

  it('BLOCKS the restore until the CDN is quiesced, and the override does not clear it', async () => {
    cdnSays({ quiesced: false });

    const blocked = await preflight().check(RUN as never);
    const overridden = await preflight().check(RUN as never, { overrideSchemaMismatch: true });

    for (const result of [blocked, overridden]) {
      if (result.outcome !== 'blocked') throw new Error('expected blocked');
      expect(result.block).toMatchObject({ gateId: CDN_QUIESCED_GATE_ID, overridable: false, overrideParameter: null });
      expect(gateRow(result.gates)).toMatchObject({
        verdict: 'block',
        action: expect.stringContaining('Pause or purge the CDN'),
      });
    }
  });

  it('the real restore service refuses to start, and queues nothing', async () => {
    cdnSays({ quiesced: false });
    const enqueue = jest.spyOn(context.app.get(JobsService), 'enqueue').mockResolvedValue({ id: 'job-1' } as never);
    const restore = context.module.get(DatabaseRestoreService, { strict: false });
    // A hard refusal never reaches the queue read either way; the pre-flight answers first.
    context.prismaMock.job.findFirst.mockResolvedValue(null);

    const result = await restore.startRestore(RUN as never, { actorUserId: 'admin-1' });

    expect(result.outcome).toBe('refused');
    if (result.outcome !== 'refused') throw new Error('expected refused');
    expect(result.preflight.outcome).toBe('blocked');
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('⚠ asks the question without changing anything: the cluster received no DDL and no write', async () => {
    cdnSays({ quiesced: false });

    await preflight().check(RUN as never);

    expect(sql.length).toBeGreaterThan(0);
    expect(sql.filter((text) => /CREATE DATABASE|DROP DATABASE|ALTER DATABASE|pg_terminate_backend|INSERT|UPDATE|DELETE/i.test(text))).toEqual([]);
  });
});
