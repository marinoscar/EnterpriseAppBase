// =============================================================================
// Telemetry store conformance kit (PP-14.11)
// =============================================================================
//
// ONE suite every telemetry store runs, so "implements the telemetry store
// contract" means the same thing for the platform's `greptime` and for an app's
// own. It builds the store the way the slice does (from its registered
// definition, with settings and secrets the caller supplies) and drives the
// port against a backend the caller controls:
//
//   import { describeTelemetryStoreConformance } from '@marinoscar/platform-api/telemetry/testing';
//
//   describeTelemetryStoreConformance('memory', {
//     describe, it, expect,
//     settings: {},
//     writeStatements: ['DROP TABLE opentelemetry_traces'],
//     fixture: { prepare: (store) => load(store), from, to },
//   });
//
// It is runner-agnostic like `describePluggableKindConformance`: it receives
// `describe`, `it` and `expect`, so Jest and Vitest both work and the package
// imports no test framework. For the built-in store it runs in the live-database
// tier (`*.greptime.spec.ts`, `npm run test:greptime`); for an app's store
// against whatever fake it ships.
//
// WHAT IT CHECKS
//
//   - the definition: a valid id and label, defaults that parse with the store's
//     own schema, no secret-looking setting, a descriptor a form can render;
//   - the built instance: `store.id` is the registered id, every member of the
//     port is there, the dialect names its columns and renders every construct;
//   - `query` ENFORCES READ-ONLY: each write statement is refused, and the store
//     still answers a read afterwards;
//   - `query` HONOURS ITS TIMEOUT (a `TelemetryQueryTimeoutError`) when the caller
//     supplies a slow statement, and an aborted signal (a `TelemetryQueryAbortedError`);
//   - `schema()` has the explorer's shape, tables sorted by name;
//   - `ping()` NEVER THROWS and carries no secret in its error;
//   - an unconfigured store is `isConfigured() === false`, refuses `query` with a
//     `TelemetryNotConfiguredError` and answers `ping()` with `reachable: false`;
//   - `close()` never throws and may be called twice;
//   - the DIALECT'S SQL FOR EVERY DASHBOARD QUERY RUNS against the store, over the
//     caller's fixture dataset (the dashboard's whole statement set, built with the
//     store's own dialect).
// =============================================================================

import { Logger } from '@nestjs/common';
import { PLUGGABLE_ID_PATTERN, pluggableDescriptorSchema } from '@marinoscar/platform-contract/settings';
import { telemetrySchemaSchema } from '@marinoscar/platform-contract/telemetry';

import {
  apiTimeseriesSql,
  apiTotalsSql,
  distinctInstancesSql,
  distinctServicesSql,
  eventLoopDelayP99Sql,
  eventsSql,
  heapUsedSql,
  lastDataSql,
  logsTimeseriesSql,
  logsTotalsSql,
  topErrorsSql,
  topRoutesSql,
  topUnknownRoutesSql,
  unknownRoutesTotalsSql,
  type DashboardSqlFilters,
} from '../dashboard/telemetry-dashboard.sql';
import {
  TelemetryNotConfiguredError,
  TelemetryQueryAbortedError,
  TelemetryQueryTimeoutError,
} from '../stores/telemetry-store.errors';
import {
  telemetryStoreKind,
  type TelemetryStore,
  type TelemetryStoreDefinition,
  type TelemetryStoreInstance,
} from '../stores/telemetry-store';

/**
 * The test runner's own globals, passed in.
 *
 * @stability experimental
 */
export interface TelemetryStoreConformanceHarness {
  /** The runner's `describe`. */
  describe: (name: string, fn: () => void) => unknown;
  /** The runner's `it`. Every case body the kit passes is an asynchronous function. */
  it: (name: string, fn: () => Promise<void>) => unknown;
  /** The runner's `expect`. */
  expect: (actual: unknown) => any;
}

/**
 * One scenario of the kit; each is skippable by name.
 *
 * @stability experimental
 */
export type TelemetryStoreConformanceScenario =
  | 'definition'
  | 'build'
  | 'readOnly'
  | 'timeout'
  | 'abort'
  | 'schema'
  | 'ping'
  | 'unconfigured'
  | 'close'
  | 'dialect'
  | 'dashboard';

/**
 * A dataset the kit runs the dashboard's statements over. Without one the
 * `dashboard` scenario is skipped (a store whose database is empty or
 * unavailable cannot prove its dialect parses).
 *
 * @stability experimental
 */
export interface TelemetryStoreFixture {
  /**
   * Loads the dataset into the store (or its backend). Called before each
   * scenario that needs it, so it must be idempotent. The dataset needs the
   * `opentelemetry_traces` and `opentelemetry_logs` tables with the columns of
   * `REQUIRED_TRACE_COLUMNS` and `REQUIRED_LOG_COLUMNS`.
   */
  prepare(store: TelemetryStore): void | Promise<void>;
  /** The start of a window containing the dataset. */
  from: Date;
  /** The end of that window (exclusive). */
  to: Date;
  /**
   * Which optional parts the dataset has. `unknownRoutes`: the traces table has
   * `span_attributes.app.route.matched` (and `app.request.bearer`). `instance`:
   * it has `resource_attributes.app.instance.id`. `runtime`: the
   * `v8js_memory_heap_used_bytes` and `nodejs_eventloop_delay_p99_seconds`
   * tables exist.
   */
  has?: readonly ('unknownRoutes' | 'instance' | 'runtime')[];
}

/**
 * The `timeout` scenario of {@link TelemetryStoreConformanceOptions}.
 *
 * @stability experimental
 */
export interface TelemetryStoreTimeoutScenario {
  /** A statement that takes longer than `timeoutMs` on this store. */
  statement: string;
  /** The ceiling to run it under; default 20 ms. */
  timeoutMs?: number;
  /** Settings merged over the kit's `settings` for this scenario only (an artificial latency, say). */
  settings?: Record<string, unknown>;
}

/**
 * How to build an unconfigured instance, for the `unconfigured` scenario of {@link TelemetryStoreConformanceOptions}.
 *
 * @stability experimental
 */
export interface TelemetryStoreUnconfiguredScenario {
  /** Settings that leave the store unconfigured. */
  settings?: Record<string, unknown>;
  /** Secrets to build it with (usually none). */
  secrets?: Record<string, string>;
  /** The build context's `connection` for it. */
  connection?: unknown;
}

/**
 * Options of {@link describeTelemetryStoreConformance}.
 *
 * @stability experimental
 */
export interface TelemetryStoreConformanceOptions extends TelemetryStoreConformanceHarness {
  /** VALID settings for the store (parsed with its `settingsSchema`, defaults filled): a configuration that works. */
  settings?: Record<string, unknown>;
  /** A value for each secret the store declares, by name. */
  secrets?: Record<string, string>;
  /** What the build context's `connection` is (the built-in store needs its runtime connection resolver; others ignore it). */
  connection?: unknown;
  /** A statement that reads and succeeds. Default `SELECT 1`. */
  readStatement?: string;
  /**
   * Statements that write and must be refused. Default: an `INSERT`, a `DELETE`
   * and a `DROP TABLE`, which no read-only store can run.
   */
  writeStatements?: readonly string[];
  /**
   * A statement that takes longer than `timeoutMs` on this store, to prove the
   * timeout is honoured. `settings` are merged over the kit's `settings` for this
   * scenario only (a store with an artificial latency setting slows itself down
   * here). Without it the `timeout` scenario is skipped.
   */
  timeout?: TelemetryStoreTimeoutScenario;
  /**
   * How to build an UNCONFIGURED instance (its settings and secrets missing).
   * Without it the `unconfigured` scenario is skipped.
   */
  unconfigured?: TelemetryStoreUnconfiguredScenario;
  /** The dataset for the `dashboard` scenario. */
  fixture?: TelemetryStoreFixture;
  /** Scenarios to skip, each for a stated reason of the caller's. */
  skip?: readonly TelemetryStoreConformanceScenario[];
}

/** The names the kit treats as secrets when they appear in a settings schema (the same rule as the pluggable-kind kit's). */
const SECRET_LIKE_FIELD_PATTERN = /key|secret|token|password/i;

const DEFAULT_WRITES: readonly string[] = [
  "INSERT INTO opentelemetry_logs (body) VALUES ('conformance')",
  'DELETE FROM opentelemetry_logs',
  'DROP TABLE opentelemetry_logs',
];

const DIALECT_MEMBERS = [
  'timeBucket',
  'percentile',
  'regexpReplaceAll',
  'jsonString',
  'containsIgnoreCase',
  'castText',
  'limit',
] as const;

const SILENT_LOGGER = { log() {}, warn() {}, error() {}, debug() {}, verbose() {}, fatal() {} } as unknown as Logger;

/** Whether `error` is (or is named like) one of the store errors; tolerates two copies of the package. */
function isNamed(error: unknown, name: string): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === name;
}

/**
 * Registers the telemetry store conformance suite.
 *
 * @param store - a store definition, or the id of a registered one.
 * @param options - the runner, valid settings and secrets, and what the store's backend needs.
 *
 * @example
 * ```ts
 * import '../../../src/app-registrations/telemetry';
 * import { describeTelemetryStoreConformance } from '@marinoscar/platform-api/telemetry/testing';
 *
 * describeTelemetryStoreConformance('memory', { describe, it, expect, fixture });
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function describeTelemetryStoreConformance(
  store: TelemetryStoreDefinition | string,
  options: TelemetryStoreConformanceOptions,
): void {
  const { describe, it, expect } = options;
  const skip = new Set(options.skip ?? []);
  const label = typeof store === 'string' ? store : store.id;

  const resolve = (): TelemetryStoreDefinition => {
    const definition = typeof store === 'string' ? (telemetryStoreKind.has(store) ? telemetryStoreKind.get(store) : undefined) : store;
    if (!definition) {
      throw new Error(
        `Telemetry store "${label}" is not registered (registered: ${telemetryStoreKind.ids().join(', ') || '(none)'}). ` +
          'Import the module that calls registerTelemetryStore before running the kit.',
      );
    }
    return definition;
  };

  const build = async (
    from: { settings?: Record<string, unknown>; secrets?: Record<string, string>; connection?: unknown } = options,
  ): Promise<TelemetryStoreInstance> => {
    const definition = resolve();
    const settings = definition.settingsSchema.parse({ ...definition.defaults, ...from.settings }) as Record<string, unknown>;
    const secrets = from.secrets ?? {};
    return definition.build({
      logger: SILENT_LOGGER,
      connection: from.connection,
      settings,
      secret: async (name: string) => secrets[name] ?? null,
    });
  };

  const read = options.readStatement ?? 'SELECT 1';
  const reader = { readOnly: true as const, timeoutMs: 10_000 };

  describe(`telemetry store conformance: ${label}`, () => {
    if (!skip.has('definition')) {
      describe('the definition', () => {
        it('has a valid id and label, parseable defaults and declared secrets', async () => {
          const definition = resolve();
          expect(PLUGGABLE_ID_PATTERN.test(definition.id)).toBe(true);
          expect(typeof definition.label).toBe('string');
          expect(definition.label.trim()).not.toBe('');
          expect(definition.settingsSchema.safeParse(definition.defaults).success).toBe(true);
          expect(typeof definition.build).toBe('function');
          const declared = (definition.secrets ?? []).map((secret) => secret.name);
          for (const name of Object.keys(options.secrets ?? {})) expect(declared).toContain(name);
        });

        it('keeps secrets out of its settings and renders a form descriptor', async () => {
          const definition = resolve();
          for (const field of Object.keys(definition.settingsSchema.shape)) {
            expect(SECRET_LIKE_FIELD_PATTERN.test(field)).toBe(false);
          }
          const secrets = Object.fromEntries((definition.secrets ?? []).map((secret) => [secret.name, true]));
          const descriptor = telemetryStoreKind.describe(definition.id, { secrets });
          expect(pluggableDescriptorSchema.safeParse(descriptor).success).toBe(true);
          expect(descriptor.fields.filter((field) => field.kind === 'secret')).toHaveLength((definition.secrets ?? []).length);
        });
      });
    }

    if (!skip.has('build')) {
      describe('the built instance', () => {
        it('is a store with every member of the port and a dialect that names its columns', async () => {
          const { store: built, dialect } = await build();
          expect(built.id).toBe(resolve().id);
          expect(typeof built.database).toBe('string');
          for (const member of ['isConfigured', 'configurationProblem', 'query', 'schema', 'ping', 'close'] as const) {
            expect(typeof built[member]).toBe('function');
          }
          if (built.retention !== undefined) {
            for (const member of ['isApplicable', 'apply', 'current'] as const) expect(typeof built.retention[member]).toBe('function');
          }
          expect(typeof dialect.id).toBe('string');
          expect(typeof dialect.timestampColumn).toBe('string');
          expect(dialect.timestampColumn.length).toBeGreaterThan(0);
          expect(typeof dialect.valueColumn).toBe('string');
          expect(dialect.valueColumn.length).toBeGreaterThan(0);
          for (const member of DIALECT_MEMBERS) expect(typeof dialect[member]).toBe('function');
          await built.close();
        });
      });
    }

    if (!skip.has('readOnly')) {
      describe('query enforces read-only', () => {
        for (const statement of options.writeStatements ?? DEFAULT_WRITES) {
          it(`refuses ${statement.split(/\s+/).slice(0, 3).join(' ')}...`, async () => {
            const { store: built } = await build();
            let refused: unknown;
            try {
              await built.query(statement, [], reader);
            } catch (error) {
              refused = error;
            }
            expect(refused).toBeInstanceOf(Error);
            await built.close();
          });
        }

        it('still answers a read after a refused write', async () => {
          const { store: built } = await build();
          await built.query(options.writeStatements?.[0] ?? DEFAULT_WRITES[0], [], reader).catch(() => undefined);
          const result = await built.query(read, [], reader);
          expect(Array.isArray(result.fields)).toBe(true);
          expect(Array.isArray(result.rows)).toBe(true);
          await built.close();
        });
      });
    }

    if (!skip.has('timeout') && options.timeout) {
      describe('query honours its timeout', () => {
        it('rejects with a timeout error rather than waiting', async () => {
          const { store: built } = await build({ ...options, settings: { ...options.settings, ...options.timeout!.settings } });
          const started = Date.now();
          let failure: unknown;
          try {
            await built.query(options.timeout!.statement, [], { readOnly: true, timeoutMs: options.timeout!.timeoutMs ?? 20 });
          } catch (error) {
            failure = error;
          }
          expect(failure instanceof TelemetryQueryTimeoutError || isNamed(failure, 'TelemetryQueryTimeoutError')).toBe(true);
          expect(Date.now() - started).toBeLessThan(5_000);
          await built.close();
        });
      });
    }

    if (!skip.has('abort')) {
      describe('query honours its abort signal', () => {
        it('rejects with a cancelled error when the signal is already aborted', async () => {
          const { store: built } = await build();
          const controller = new AbortController();
          controller.abort();
          let failure: unknown;
          try {
            await built.query(read, [], { ...reader, signal: controller.signal });
          } catch (error) {
            failure = error;
          }
          expect(failure instanceof TelemetryQueryAbortedError || isNamed(failure, 'TelemetryQueryAbortedError')).toBe(true);
          await built.close();
        });
      });
    }

    if (!skip.has('schema')) {
      describe('schema()', () => {
        it('has the explorer shape, tables sorted by name', async () => {
          const { store: built } = await build();
          await options.fixture?.prepare(built);
          const schema = await built.schema({ timeoutMs: 10_000 });
          expect(telemetrySchemaSchema.safeParse(schema).success).toBe(true);
          const names = schema.tables.map((table: { name: string }) => table.name);
          expect(names).toEqual([...names].sort((a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)));
          await built.close();
        });
      });
    }

    if (!skip.has('ping')) {
      describe('ping()', () => {
        it('never throws and says whether the store answered', async () => {
          const { store: built } = await build();
          let result: Awaited<ReturnType<TelemetryStore['ping']>> | undefined;
          let threw: unknown;
          try {
            result = await built.ping();
          } catch (error) {
            threw = error;
          }
          expect(threw).toBeUndefined();
          expect(typeof result?.reachable).toBe('boolean');
          if (result && !result.reachable) expect(typeof result.error).toBe('string');
          await built.close();
        });

        it('carries no secret in its answer', async () => {
          const { store: built } = await build();
          const answer = JSON.stringify(await built.ping());
          for (const secret of Object.values(options.secrets ?? {})) {
            if (secret.length >= 4) expect(answer).not.toContain(secret);
          }
          await built.close();
        });
      });
    }

    if (!skip.has('unconfigured') && options.unconfigured) {
      describe('an unconfigured store', () => {
        it('says so, refuses queries with a typed error and reports unreachable', async () => {
          const { store: built } = await build(options.unconfigured);
          expect(built.isConfigured()).toBe(false);
          let failure: unknown;
          try {
            await built.query(read, [], reader);
          } catch (error) {
            failure = error;
          }
          expect(failure instanceof TelemetryNotConfiguredError || isNamed(failure, 'TelemetryNotConfiguredError')).toBe(true);
          const ping = await built.ping();
          expect(ping.reachable).toBe(false);
          await built.close();
        });
      });
    }

    if (!skip.has('close')) {
      describe('close()', () => {
        it('never throws and may be called twice', async () => {
          const { store: built } = await build();
          await built.close();
          await built.close();
          expect(true).toBe(true);
        });
      });
    }

    if (!skip.has('dialect')) {
      describe('the dialect', () => {
        it('renders every construct as non-empty SQL that contains its arguments', async () => {
          const { dialect, store: built } = await build();
          expect(dialect.timeBucket('"timestamp"', 60)).toContain('"timestamp"');
          expect(dialect.percentile(0.95, '"duration_nano"')).toContain('"duration_nano"');
          expect(dialect.regexpReplaceAll('"path"', '/[0-9]+', '/:id')).toContain('"path"');
          expect(dialect.jsonString('resource_attributes', 'service.name')).toContain('service.name');
          expect(dialect.containsIgnoreCase('body', 'needle')).toContain('needle');
          expect(dialect.castText('"timestamp"')).toContain('"timestamp"');
          expect(dialect.limit(7)).toContain('7');
          await built.close();
        });
      });
    }

    if (!skip.has('dashboard') && options.fixture) {
      describe('the dashboard statements', () => {
        it('every statement built with the dialect runs against the store over the fixture dataset', async () => {
          const { store: built, dialect } = await build();
          await options.fixture!.prepare(built);
          const { from, to } = options.fixture!;
          const has = new Set(options.fixture!.has ?? []);
          const window = { from, to, bucketSeconds: 60 };
          const previousFrom = new Date(from.getTime() - (to.getTime() - from.getTime()));
          const filters: DashboardSqlFilters = {
            tracesHaveInstance: has.has('instance'),
            tracesHaveRouteMatched: has.has('unknownRoutes'),
            tracesHaveBearer: has.has('unknownRoutes'),
          };
          const tables = { traces: true, logs: true };

          const statements: Array<[string, string | null]> = [
            ['apiTotalsSql', apiTotalsSql(previousFrom, window, filters, dialect)],
            ['apiTimeseriesSql', apiTimeseriesSql(window, filters, dialect)],
            ['topRoutesSql', topRoutesSql(window, filters, undefined, dialect)],
            ['logsTotalsSql', logsTotalsSql(previousFrom, window, filters, dialect)],
            ['logsTimeseriesSql', logsTimeseriesSql(window, filters, dialect)],
            ['topErrorsSql', topErrorsSql(window, filters, undefined, dialect)],
            [
              'eventsSql',
              eventsSql(window, filters, { severities: ['error', 'warn', 'info'], q: 'conformance' }, dialect),
            ],
            ['lastDataSql', lastDataSql(previousFrom, new Date(to.getTime() + 60_000), filters, tables, dialect)],
            ['distinctServicesSql', distinctServicesSql(from, to, tables, undefined, dialect)],
            ['distinctInstancesSql', distinctInstancesSql(from, to, { traces: has.has('instance'), logs: true }, undefined, dialect)],
          ];
          if (has.has('unknownRoutes')) {
            statements.push(
              ['unknownRoutesTotalsSql', unknownRoutesTotalsSql(previousFrom, window, filters, dialect)],
              ['topUnknownRoutesSql', topUnknownRoutesSql(window, filters, undefined, dialect)],
            );
          }
          if (has.has('runtime')) {
            statements.push(
              ['heapUsedSql', heapUsedSql(previousFrom, to, 60, null, dialect)],
              ['eventLoopDelayP99Sql', eventLoopDelayP99Sql(previousFrom, to, 60, null, dialect)],
            );
          }

          for (const [name, sql] of statements) {
            if (sql === null) continue;
            let failure: unknown;
            let result: Awaited<ReturnType<TelemetryStore['query']>> | undefined;
            try {
              result = await built.query(sql, [], reader);
            } catch (error) {
              failure = new Error(`${name} did not run: ${error instanceof Error ? error.message : String(error)}\n${sql}`);
            }
            expect(failure).toBeUndefined();
            expect(Array.isArray(result?.fields)).toBe(true);
            expect(Array.isArray(result?.rows)).toBe(true);
          }
          await built.close();
        });
      });
    }
  });
}
