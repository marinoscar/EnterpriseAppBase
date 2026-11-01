import { z } from 'zod';

import { registerTelemetryStore, type TelemetryStore, type TelemetryStoreDefinition } from './telemetry-store';
import { GREPTIME_SQL_DIALECT } from './greptime/greptime.dialect';
import { TelemetryNotConfiguredError } from './telemetry-store.errors';
import { TELEMETRY_STORE_SETTINGS_KEY, TelemetryStoreResolver, delegatingDialect } from './telemetry-store.resolver';

// =============================================================================
// TelemetryStoreResolver: the selected store, built from settings and secrets (PP-14.11)
// =============================================================================

interface Built {
  settings: Record<string, unknown>;
  apiKey: string | null;
  store: TelemetryStore & { closed: number; queries: string[] };
}

const builds: Built[] = [];
let failBuild: Error | null = null;

function fakeStore(settings: Record<string, unknown>): TelemetryStore & { closed: number; queries: string[] } {
  const store = {
    id: 'resolver-fake',
    database: String(settings.database ?? 'fake'),
    closed: 0,
    queries: [] as string[],
    isConfigured: () => settings.enabled !== false,
    configurationProblem: () => null,
    query: jest.fn(async (sql: string) => {
      store.queries.push(sql);
      return { fields: [], rows: [] };
    }),
    schema: jest.fn(async () => ({ tables: [] })),
    ping: jest.fn(async () => ({ reachable: true, version: 'fake 1' })),
    close: jest.fn(async () => {
      store.closed += 1;
    }),
  };
  return store as never;
}

const definition: TelemetryStoreDefinition = {
  id: 'resolver-fake',
  label: 'Resolver fake',
  settingsSchema: z.object({ database: z.string().default('fake'), enabled: z.boolean().default(true) }),
  defaults: { database: 'fake', enabled: true },
  secrets: [{ name: 'apiKey', label: 'API key', required: false }],
  build: async ({ settings, secret }) => {
    if (failBuild) throw failBuild;
    const store = fakeStore(settings);
    builds.push({ settings, apiKey: await secret('apiKey'), store });
    return { store, dialect: { ...GREPTIME_SQL_DIALECT, id: `fake-${String(settings.database)}` } };
  },
};

registerTelemetryStore(definition);

function setup(options: { row?: unknown; secretStamp?: Date | null; secret?: string | null } = {}) {
  const state = {
    row: options.row as unknown,
    stamp: options.secretStamp === undefined ? null : options.secretStamp,
    secret: options.secret ?? null,
    readFails: false,
  };
  const settingsStore = {
    readRow: jest.fn(async (key: string) => {
      expect(key).toBe(TELEMETRY_STORE_SETTINGS_KEY);
      if (state.readFails) throw new Error('database is down');
      return state.row === undefined ? null : { value: state.row, version: 1, updatedAt: new Date(), updatedBy: null };
    }),
  };
  const credentials = {
    describe: jest.fn(async () =>
      state.stamp ? { purpose: 'telemetry_resolver-fake', name: 'apiKey', hint: null, label: null, updatedByUserId: null, createdAt: state.stamp, updatedAt: state.stamp } : null,
    ),
    getSecret: jest.fn(async (purpose: string) => {
      expect(purpose).toBe('telemetry_resolver-fake');
      return state.secret;
    }),
  };
  const resolver = new TelemetryStoreResolver(
    { store: 'resolver-fake' },
    settingsStore as never,
    credentials as never,
    { marker: 'connection' } as never,
  );
  return { resolver, state, settingsStore, credentials };
}

beforeEach(() => {
  builds.length = 0;
  failBuild = null;
});

describe('TelemetryStoreResolver', () => {
  it('is unconfigured until a build, then delegates every member to the built store', async () => {
    const { resolver } = setup({ row: { 'resolver-fake': { database: 'prod' } } });
    expect(resolver.isConfigured()).toBe(false);
    expect(resolver.database).toBe('resolver-fake');

    await resolver.refresh();

    expect(resolver.isConfigured()).toBe(true);
    expect(resolver.database).toBe('prod');
    await expect(resolver.query('SELECT 1', [], { readOnly: true, timeoutMs: 1000 })).resolves.toEqual({ fields: [], rows: [] });
    expect(builds[0].store.queries).toEqual(['SELECT 1']);
    await expect(resolver.ping()).resolves.toEqual({ reachable: true, version: 'fake 1' });
    await expect(resolver.schema({ timeoutMs: 1000 })).resolves.toEqual({ tables: [] });
    expect(resolver.dialect.id).toBe('fake-prod');
  });

  it('hands build the parsed settings (defaults filled), the secret resolver and the connection', async () => {
    const { resolver } = setup({ row: {}, secretStamp: new Date('2026-01-01'), secret: 'k-123' });

    await resolver.refresh();

    expect(builds[0].settings).toEqual({ database: 'fake', enabled: true });
    expect(builds[0].apiKey).toBe('k-123');
  });

  it('keeps the built store while nothing changed, and rebuilds (closing the old one) when settings change', async () => {
    const { resolver, state } = setup({ row: { 'resolver-fake': { database: 'a' } } });
    await resolver.refresh();
    await resolver.refresh();
    expect(builds).toHaveLength(1);

    state.row = { 'resolver-fake': { database: 'b' } };
    await resolver.refresh();

    expect(builds).toHaveLength(2);
    expect(builds[0].store.closed).toBe(1);
    expect(resolver.database).toBe('b');
  });

  it('rebuilds when a secret is rotated (its update time moves) without any settings change', async () => {
    const { resolver, state } = setup({ row: {}, secretStamp: new Date('2026-01-01'), secret: 'old' });
    await resolver.refresh();

    state.stamp = new Date('2026-02-02');
    state.secret = 'new';
    await resolver.refresh();

    expect(builds.map((b) => b.apiKey)).toEqual(['old', 'new']);
  });

  it('shares one run between concurrent refreshes', async () => {
    const { resolver, settingsStore } = setup({ row: {} });

    await Promise.all([resolver.refresh(), resolver.refresh(), resolver.refresh()]);

    expect(settingsStore.readRow).toHaveBeenCalledTimes(1);
  });

  describe('a configuration problem never throws at boot', () => {
    it('reports settings that do not parse, names the fields, and refuses queries with a typed error', async () => {
      const { resolver } = setup({ row: { 'resolver-fake': { enabled: 'maybe' } } });

      await resolver.refresh();

      expect(resolver.isConfigured()).toBe(false);
      expect(resolver.lastError()).toContain('invalid at: enabled');
      expect(resolver.configurationProblem()).toContain('invalid at: enabled');
      await expect(resolver.query('SELECT 1', [], { readOnly: true, timeoutMs: 1000 })).rejects.toBeInstanceOf(TelemetryNotConfiguredError);
      await expect(resolver.ping()).resolves.toMatchObject({ reachable: false, error: expect.stringContaining('invalid at: enabled') });
      expect(() => resolver.dialect).toThrow(TelemetryNotConfiguredError);
    });

    it('reports a build that throws, and recovers on the next refresh', async () => {
      const { resolver } = setup({ row: {} });
      failBuild = new Error('driver not installed');

      await resolver.refresh();
      expect(resolver.lastError()).toContain('could not be built: driver not installed');
      expect(resolver.isConfigured()).toBe(false);

      failBuild = null;
      await resolver.refresh();
      expect(resolver.lastError()).toBeNull();
      expect(resolver.isConfigured()).toBe(true);
    });

    it('keeps the running store through a transient read failure', async () => {
      const { resolver, state } = setup({ row: {} });
      await resolver.refresh();

      state.readFails = true;
      await resolver.refresh();

      expect(resolver.isConfigured()).toBe(true);
      expect(builds[0].store.closed).toBe(0);
      expect(resolver.lastError()).toContain('database is down');
    });
  });

  it('builds on module init, and releases the store on destroy', async () => {
    const { resolver } = setup({ row: {} });

    await resolver.onModuleInit();
    expect(resolver.isConfigured()).toBe(true);

    await resolver.onModuleDestroy();
    expect(builds[0].store.closed).toBe(1);
    expect(resolver.isConfigured()).toBe(false);
  });

  it('refreshes by itself when a call finds the settings stale', async () => {
    const { resolver } = setup({ row: {} });

    await resolver.ping();

    expect(builds).toHaveLength(1);
  });
});

describe('delegatingDialect', () => {
  it('asks the resolver for the built store\'s dialect on every call, so a rebuild is picked up', async () => {
    const { resolver, state } = setup({ row: { 'resolver-fake': { database: 'a' } } });
    await resolver.refresh();
    const dialect = delegatingDialect(resolver);

    expect(dialect.id).toBe('fake-a');
    expect(dialect.limit(3)).toBe('LIMIT 3');

    state.row = { 'resolver-fake': { database: 'b' } };
    await resolver.refresh();
    expect(dialect.id).toBe('fake-b');
  });
});
