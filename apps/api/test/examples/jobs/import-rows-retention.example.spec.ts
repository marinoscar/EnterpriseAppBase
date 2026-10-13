// =============================================================================
// PP-14.19, proved from the app: an app table joins the nightly retention
// =============================================================================
//
// The worked example is src/platform-extensions/jobs/import-rows.retention.ts.
// Nothing under packages/ is edited. Each case loads a fresh copy of the module
// graph with the app's registration file standing in for one that lists the
// example (the shipped file keeps its arrays empty so the served settings stay
// the platform's), then uses the REAL settings composition, the REAL
// `RetentionPurgeTask`, the REAL `JobHandlerRegistry` and the example handler.
// =============================================================================

type Sandbox = {
  registry: typeof import('../../../src/settings/registry');
  jobs: typeof import('@marinoscar/platform-api/jobs');
  settings: typeof import('@marinoscar/platform-api/settings');
  example: typeof import('../../../src/platform-extensions/jobs/import-rows.retention');
};

function loadApp(withExample = true): Sandbox {
  let sandbox!: Sandbox;
  jest.isolateModules(() => {
    jest.doMock('../../../src/app-registrations/jobs', () => {
      const example = require('../../../src/platform-extensions/jobs/import-rows.retention');
      return {
        APP_JOB_REASONS: [],
        APP_NODE_SPAN_ATTRIBUTES: [],
        APP_RETENTION_POLICIES: withExample ? [example.IMPORT_ROWS_RETENTION] : [],
      };
    });
    sandbox = {
      registry: require('../../../src/settings/registry'),
      jobs: require('@marinoscar/platform-api/jobs'),
      settings: require('@marinoscar/platform-api/settings'),
      example: require('../../../src/platform-extensions/jobs/import-rows.retention'),
    };
  });

  return sandbox;
}

const SHIPPED_RETENTION = {
  notifications: { enabled: true, days: 180 },
  notificationDeliveries: { enabled: true, days: 90 },
  auditEvents: { enabled: false, days: 365 },
  aiRuns: { enabled: true, days: 90 },
};

describe('the shipped app (no app policy listed)', () => {
  it('serves exactly the platform’s four retention policies, byte for byte', () => {
    const { registry } = loadApp(false);

    expect(JSON.stringify(registry.DEFAULT_SYSTEM_SETTINGS.retention)).toBe(JSON.stringify(SHIPPED_RETENTION));
  });
});

describe('the app lists IMPORT_ROWS_RETENTION in APP_RETENTION_POLICIES', () => {
  it('adds importRows to the served defaults after the built-ins, OFF until an operator decides', () => {
    const { registry } = loadApp();

    expect(Object.keys(registry.DEFAULT_SYSTEM_SETTINGS.retention)).toEqual([...Object.keys(SHIPPED_RETENTION), 'importRows']);
    expect(registry.DEFAULT_SYSTEM_SETTINGS.retention.importRows).toEqual({ enabled: false, days: 30 });
  });

  it('validates a PUT and a PATCH against its own 7..365 bounds, and strips a key nobody registered', () => {
    const { registry } = loadApp();
    const put = (importRows: unknown) =>
      registry.updateSystemSettingsSchema.safeParse({
        ...registry.DEFAULT_SYSTEM_SETTINGS,
        retention: { ...SHIPPED_RETENTION, importRows },
      });

    expect(put({ enabled: true, days: 7 }).success).toBe(true);
    expect(put({ enabled: true, days: 365 }).success).toBe(true);
    expect(put({ enabled: true, days: 6 }).success).toBe(false);
    expect(put({ enabled: true, days: 366 }).success).toBe(false);

    const patched = registry.patchSystemSettingsSchema.parse({ retention: { importRows: { days: 14 }, ghost: { days: 1 } } });
    expect(patched.retention).toEqual({ importRows: { days: 14 } });
  });

  it('documents importRows in the response schema (days unbounded there, as for the built-ins)', () => {
    const { registry } = loadApp();
    const parsed = registry.systemSettingsResponseSchema.shape.retention.parse({
      ...SHIPPED_RETENTION,
      importRows: { enabled: true, days: 99999 },
    }) as Record<string, unknown>;

    expect(parsed['importRows']).toEqual({ enabled: true, days: 99999 });
  });

  it('merges a PATCH into the composed value leaf by leaf', () => {
    const { jobs } = loadApp();
    const merged = jobs.RETENTION_SYSTEM_SETTINGS.merge({ ...SHIPPED_RETENTION, importRows: { enabled: false, days: 30 } }, { importRows: { enabled: true } });

    expect(merged['importRows']).toEqual({ enabled: true, days: 30 });
    expect(merged.auditEvents).toEqual(SHIPPED_RETENTION.auditEvents);
  });

  it('reads a row stored before the policy existed as itself plus the policy default, and ignores a removed policy', () => {
    const { jobs, settings } = loadApp();
    const read = jobs.RETENTION_SYSTEM_SETTINGS.read!;
    const asPlainObject = (v: unknown) => (typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : undefined);
    const helpers = { asPlainObject, readNamespace: readNamespaceLike } as never;
    const legacy = { ...SHIPPED_RETENTION, notifications: { enabled: false, days: 14 } };

    expect(settings.systemSettingsNamespaceRegistry.get('retention')).toBeDefined();
    expect(read(legacy, helpers)).toEqual({ ...legacy, importRows: { enabled: false, days: 30 } });
    expect(read({ ...legacy, removed: { enabled: true, days: 1 } }, helpers)).toEqual({
      ...legacy,
      importRows: { enabled: false, days: 30 },
    });
  });

  describe('the nightly task and the purge handler (real classes)', () => {
    const NOW = new Date('2026-06-15T01:00:00.000Z');
    const DAY = 24 * 60 * 60 * 1000;

    function build(policy: { enabled: boolean; days: number }, mountHandler = true) {
      const { jobs, example } = loadApp();
      const handlers = new jobs.JobHandlerRegistry();
      const rows = new InMemoryImportRows([
        { id: 'old-1', createdAt: new Date(NOW.getTime() - 40 * DAY) },
        { id: 'old-2', createdAt: new Date(NOW.getTime() - 31 * DAY) },
        { id: 'fresh', createdAt: new Date(NOW.getTime() - 3 * DAY) },
      ]);
      const settings = {
        getRetentionPolicy: jest.fn().mockResolvedValue({ ...SHIPPED_RETENTION, importRows: policy }),
      };
      const handler = new example.ImportRowsPurgeHandler(handlers, rows, settings as never);
      if (mountHandler) handler.onModuleInit();

      const enqueue = jest.fn(async ({ type }: { type: string }) => ({ id: `job-${type}` }));
      const task = new jobs.RetentionPurgeTask(
        { enqueue } as never,
        { job: { findFirst: jest.fn().mockResolvedValue(null) } } as never,
        settings as never,
        new jobs.RetentionPurgeRegistry(),
        handlers,
      );

      return { example, task, enqueue, handler, rows, handlers };
    }

    beforeEach(() => jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate'] }));
    afterEach(() => jest.useRealTimers());

    it('enqueues the app purge once, when its handler is mounted and the policy is on, with no other wiring', async () => {
      const { task, enqueue, example } = build({ enabled: true, days: 30 });

      await task.handleCron();

      expect(enqueue).toHaveBeenCalledTimes(1);
      expect(enqueue).toHaveBeenCalledWith({ type: example.IMPORT_ROWS_PURGE_TYPE, reason: 'backfill', priority: 100, orgId: null });
    });

    it('enqueues nothing while the policy is off or the handler is not mounted', async () => {
      for (const [policy, mounted] of [[{ enabled: false, days: 30 }, true], [{ enabled: true, days: 30 }, false]] as const) {
        const { task, enqueue } = build(policy, mounted);

        await task.handleCron();

        expect(enqueue).not.toHaveBeenCalled();
      }
    });

    it('is a server-only job type: neither nodeResultSchema nor persistNodeResult', () => {
      const { handlers, example } = build({ enabled: true, days: 30 });

      expect(handlers.get(example.IMPORT_ROWS_PURGE_TYPE)).toBeDefined();
      expect(handlers.serverOnlyTypes()).toContain(example.IMPORT_ROWS_PURGE_TYPE);
    });

    it('deletes only rows older than the configured days when it runs', async () => {
      const { handler, rows } = build({ enabled: true, days: 30 });

      await handler.process({ id: 'job-1' } as never);

      expect(rows.remaining()).toEqual(['fresh']);
    });

    it('honours a tighter window an operator set, and is a no-op while the policy is off', async () => {
      const tight = build({ enabled: true, days: 7 });
      await tight.handler.process({ id: 'job-1' } as never);
      expect(tight.rows.remaining()).toEqual(['fresh']);

      const off = build({ enabled: false, days: 7 });
      await off.handler.process({ id: 'job-2' } as never);
      expect(off.rows.remaining()).toEqual(['old-1', 'old-2', 'fresh']);
    });

    it('fails loudly when the policy was never registered, instead of deleting by a guess', async () => {
      const { handler } = build({ enabled: true, days: 30 });
      (handler as unknown as { systemSettings: { getRetentionPolicy: jest.Mock } }).systemSettings.getRetentionPolicy.mockResolvedValue(SHIPPED_RETENTION);

      await expect(handler.process({ id: 'job-3' } as never)).rejects.toThrow(/APP_RETENTION_POLICIES/);
    });
  });
});

class InMemoryImportRows {
  constructor(private rows: Array<{ id: string; createdAt: Date }>) {}

  async selectIdsOlderThan(cutoff: Date, take: number): Promise<string[]> {
    return this.rows
      .filter((row) => row.createdAt < cutoff)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .slice(0, take)
      .map((row) => row.id);
  }

  async deleteByIds(ids: string[]): Promise<number> {
    const before = this.rows.length;
    this.rows = this.rows.filter((row) => !ids.includes(row.id));
    return before - this.rows.length;
  }

  remaining(): string[] {
    return this.rows.map((row) => row.id);
  }
}

/** The settings service's `readNamespace`, field by field with the default as the fallback. */
function readNamespaceLike(stored: unknown, schema: { shape: Record<string, { safeParse(v: unknown): { success: boolean; data?: unknown } }> }, defaults: Record<string, unknown>) {
  const source = typeof stored === 'object' && stored !== null ? (stored as Record<string, unknown>) : {};
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(schema.shape)) {
    const parsed = field.safeParse(source[key]);
    out[key] = parsed.success ? parsed.data : structuredClone(defaults[key]);
  }

  return out;
}
