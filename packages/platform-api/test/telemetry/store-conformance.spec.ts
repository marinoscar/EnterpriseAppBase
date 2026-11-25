import 'reflect-metadata';

import { z } from 'zod';

import {
  GREPTIME_SQL_DIALECT,
  TelemetryNotConfiguredError,
  TelemetryQueryAbortedError,
  TelemetryQueryTimeoutError,
  registerTelemetryStore,
  type TelemetrySqlDialect,
  type TelemetryStore,
  type TelemetryStoreDefinition,
  type TelemetryStoreQueryOptions,
} from '../../src/telemetry/index';
import {
  describeTelemetryStoreConformance,
  type TelemetryStoreConformanceOptions,
  type TelemetryStoreConformanceScenario,
} from '../../src/telemetry/testing/index';

// =============================================================================
// The telemetry store conformance kit (PP-14.11)
// =============================================================================
//
// Two halves. First, the kit RUN on a well-behaved store: every scenario
// passes. Second, for each scenario, a DELIBERATELY BROKEN store the kit must
// reject: a check that cannot fail would let a store silently stop being
// checked.
// =============================================================================

interface Behaviour {
  /** Runs writes instead of refusing them. */
  allowWrites?: boolean;
  /** Ignores the timeout. */
  ignoreTimeout?: boolean;
  /** Ignores the abort signal. */
  ignoreAbort?: boolean;
  /** `ping()` throws. */
  throwingPing?: boolean;
  /** `ping()` leaks the secret. */
  leakySecret?: boolean;
  /** `schema()` returns tables out of order. */
  unsortedSchema?: boolean;
  /** `schema()` returns something that is not a schema. */
  brokenSchema?: boolean;
  /** `close()` throws the second time. */
  closeTwice?: boolean;
  /** Keeps answering when unconfigured. */
  answersUnconfigured?: boolean;
  /** Rejects the dashboard's statements. */
  rejectsDashboard?: boolean;
  /** A dialect that returns empty text. */
  emptyDialect?: boolean;
}

function storeWith(id: string, settings: Record<string, unknown>, behaviour: Behaviour, secret: string | null): TelemetryStore {
  let closed = 0;
  const enabled = settings.enabled !== false;
  const slow = Number(settings.latencyMs ?? 0);

  return {
    id,
    database: 'kit',
    isConfigured: () => enabled,
    configurationProblem: () => null,
    async query(sql: string, _params: readonly unknown[], options: TelemetryStoreQueryOptions) {
      if (!enabled && !behaviour.answersUnconfigured) throw new TelemetryNotConfiguredError('reader', 'not configured');
      if (options.signal?.aborted && !behaviour.ignoreAbort) throw new TelemetryQueryAbortedError();
      if (slow > options.timeoutMs && !behaviour.ignoreTimeout) throw new TelemetryQueryTimeoutError(options.timeoutMs);
      if (!/^\s*select/i.test(sql) && !behaviour.allowWrites) throw new Error('read-only');
      if (behaviour.rejectsDashboard && /bucket|FROM "opentelemetry/i.test(sql)) throw new Error('cannot parse');
      return { fields: [{ name: 'n', dataTypeID: 20 }], rows: [[1]] };
    },
    async schema() {
      if (behaviour.brokenSchema) return { tables: [{ name: 1 }] } as never;
      const names = behaviour.unsortedSchema ? ['b_table', 'a_table'] : ['a_table', 'b_table'];
      return { tables: names.map((name) => ({ name, rows: null, columns: [] })) };
    },
    async ping() {
      if (behaviour.throwingPing) throw new Error('boom');
      if (behaviour.leakySecret) return { reachable: false, error: `login failed for key ${secret}` };
      return enabled ? { reachable: true, version: 'fake 1' } : { reachable: false, error: 'switched off' };
    },
    async close() {
      closed += 1;
      if (behaviour.closeTwice && closed > 1) throw new Error('already closed');
    },
  };
}

function dialect(empty: boolean): TelemetrySqlDialect {
  if (empty) {
    const nothing = () => '';
    return { ...GREPTIME_SQL_DIALECT, id: 'kit-fake', timeBucket: nothing, percentile: nothing, castText: nothing, limit: nothing };
  }
  return { ...GREPTIME_SQL_DIALECT, id: 'kit-fake' };
}

let sequence = 0;

/** Registers a fresh store id with the behaviour and returns its definition. */
function define(behaviour: Behaviour = {}, overrides: Partial<TelemetryStoreDefinition> = {}): TelemetryStoreDefinition {
  const id = `kit-fake-${(sequence += 1)}`;
  const definition: TelemetryStoreDefinition = {
    id,
    label: 'Kit fake',
    settingsSchema: z.object({ enabled: z.boolean().default(true), latencyMs: z.number().int().min(0).default(0) }),
    defaults: { enabled: true, latencyMs: 0 },
    secrets: [{ name: 'apiKey', label: 'API key', required: false }],
    build: async ({ settings, secret }) => ({
      store: storeWith(id, settings, behaviour, await secret('apiKey')),
      dialect: dialect(behaviour.emptyDialect === true),
    }),
    ...overrides,
  };
  registerTelemetryStore(definition);
  return definition;
}

const FIXTURE = { prepare: () => undefined, from: new Date('2026-09-27T21:00:00.000Z'), to: new Date('2026-09-27T22:00:00.000Z') };

const FULL: Omit<TelemetryStoreConformanceOptions, 'describe' | 'it' | 'expect'> = {
  settings: {},
  secrets: { apiKey: 'sk-secret-value-123' },
  timeout: { statement: 'SELECT 1', timeoutMs: 10, settings: { latencyMs: 500 } },
  unconfigured: { settings: { enabled: false } },
  fixture: FIXTURE,
};

// ---- the kit, on a well-behaved store ----------------------------------------------------

describeTelemetryStoreConformance(define(), { describe, it, expect, ...FULL });

// ---- the kit, on broken stores ------------------------------------------------------------

interface Outcome {
  name: string;
  error?: unknown;
}

/** Runs the kit with a recording runner instead of the test runner's, and returns every case's outcome. */
async function runKit(
  definition: TelemetryStoreDefinition | string,
  options: Partial<TelemetryStoreConformanceOptions> = {},
): Promise<Outcome[]> {
  const outcomes: Outcome[] = [];
  const pending: Promise<void>[] = [];
  const path: string[] = [];

  describeTelemetryStoreConformance(definition, {
    ...FULL,
    ...options,
    describe: (name, fn) => {
      path.push(name);
      fn();
      path.pop();
    },
    it: (name, fn) => {
      const full = [...path, name].join(' > ');
      pending.push(fn().then(() => void outcomes.push({ name: full }), (error: unknown) => void outcomes.push({ name: full, error })));
    },
    expect,
  } as TelemetryStoreConformanceOptions);
  await Promise.all(pending);
  return outcomes;
}

const failed = (outcomes: Outcome[]) => outcomes.filter((o) => o.error !== undefined).map((o) => o.name);

describe('the kit rejects a broken store', () => {
  it('passes a well-behaved one in the recording runner too', async () => {
    const outcomes = await runKit(define());

    expect(outcomes.length).toBeGreaterThan(10);
    expect(failed(outcomes)).toEqual([]);
  });

  it('a store that runs writes', async () => {
    const names = failed(await runKit(define({ allowWrites: true })));

    expect(names.some((n) => n.includes('query enforces read-only'))).toBe(true);
  });

  it('a store that ignores the timeout', async () => {
    const names = failed(await runKit(define({ ignoreTimeout: true })));

    expect(names.some((n) => n.includes('query honours its timeout'))).toBe(true);
  });

  it('a store that ignores the abort signal', async () => {
    const names = failed(await runKit(define({ ignoreAbort: true })));

    expect(names.some((n) => n.includes('abort signal'))).toBe(true);
  });

  it('a ping that throws, and one that leaks the secret', async () => {
    expect(failed(await runKit(define({ throwingPing: true }))).some((n) => n.includes('ping()'))).toBe(true);
    expect(failed(await runKit(define({ leakySecret: true }))).some((n) => n.includes('carries no secret'))).toBe(true);
  });

  it('a schema out of order, and one that is not a schema', async () => {
    expect(failed(await runKit(define({ unsortedSchema: true }))).some((n) => n.includes('schema()'))).toBe(true);
    expect(failed(await runKit(define({ brokenSchema: true }))).some((n) => n.includes('schema()'))).toBe(true);
  });

  it('a close that throws the second time', async () => {
    expect(failed(await runKit(define({ closeTwice: true }))).some((n) => n.includes('close()'))).toBe(true);
  });

  it('a store that answers while unconfigured', async () => {
    expect(failed(await runKit(define({ answersUnconfigured: true }))).some((n) => n.includes('an unconfigured store'))).toBe(true);
  });

  it('a store that cannot run the dashboard statements, and a dialect that renders nothing', async () => {
    expect(failed(await runKit(define({ rejectsDashboard: true }))).some((n) => n.includes('dashboard statements'))).toBe(true);
    expect(failed(await runKit(define({ emptyDialect: true }))).some((n) => n.includes('dialect'))).toBe(true);
  });

  it('an id nobody registered, named with the registered ones', async () => {
    const outcomes = await runKit('never-registered');

    expect(failed(outcomes).length).toBeGreaterThan(0);
    expect(String(outcomes.find((o) => o.error)?.error)).toMatch(/"never-registered" is not registered \(registered: greptime/);
  });
});

describe('the options', () => {
  const skipAll: TelemetryStoreConformanceScenario[] = [
    'definition', 'build', 'readOnly', 'timeout', 'abort', 'schema', 'ping', 'unconfigured', 'close', 'dialect', 'dashboard',
  ];

  it('skips scenarios by name', async () => {
    const outcomes = await runKit(define(), { skip: skipAll });

    expect(outcomes).toEqual([]);
  });

  it('skips the timeout, unconfigured and dashboard scenarios without their options', async () => {
    const outcomes = await runKit(define(), { timeout: undefined, unconfigured: undefined, fixture: undefined });
    const names = outcomes.map((o) => o.name);

    expect(names.some((n) => n.includes('timeout'))).toBe(false);
    expect(names.some((n) => n.includes('unconfigured'))).toBe(false);
    expect(names.some((n) => n.includes('dashboard statements'))).toBe(false);
    expect(failed(outcomes)).toEqual([]);
  });
});
