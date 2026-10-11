// =============================================================================
// Restore gate conformance kit (PP-14.12)
// =============================================================================
//
// ONE suite every restore pre-flight gate runs, so "is a well-behaved gate"
// means the same thing for the platform's eight and for an app's own:
//
//   import { describeRestoreGateConformance } from '@marinoscar/platform-api/db-backup/testing';
//
//   describeRestoreGateConformance(cdnQuiescedGate, {
//     describe, it, expect,
//     scenarios: [
//       { name: 'quiesced', settings: { cdn: { quiesced: true } }, expectStatus: 'pass' },
//       { name: 'not quiesced', settings: { cdn: { quiesced: false } }, expectStatus: 'fail' },
//       { name: 'not configured', settings: {}, expectStatus: 'pass' },
//     ],
//   });
//
// It is runner-agnostic: it receives `describe`, `it` and `expect`.
//
// WHAT IT CHECKS
//
//   - the definition: a valid id, a label, a known kind, a `check` function;
//   - it ANSWERS: every scenario returns `{ status: 'pass' | 'warn' | 'fail',
//     message }` with a non-empty message, within `RESTORE_GATE_TIMEOUT_MS`, and
//     the status the scenario expects;
//   - it is READ-ONLY, which is the rule a restore pre-flight cannot bend (it
//     "creates, drops and renames nothing"): the gate runs against a context
//     whose every member is frozen behind a recording proxy, and any attempt to
//     assign, define or delete a property on it fails the case; the only
//     handle it may call is `settings.get`. The author can also pass `watch`
//     counters for the side-effecting dependencies of their own (an HTTP
//     client's POST, a filesystem write): each must stay at zero;
//   - it is REPEATABLE: asking twice with the same context answers the same, so
//     the gate is a function of its inputs, not a counter or a cache that
//     changes what the second pre-flight says;
//   - it FAILS CLOSED through the registry: `evaluateRestoreGate` turns the
//     gate's answer into a pre-flight row with the gate's label and id.
//
// `buildRestoreGateContext` makes a complete context for a case (healthy
// facts, an empty settings reader) that a scenario overrides.
// =============================================================================

import type { SystemDatabaseBackupValue } from '@marinoscar/platform-contract/db-backup';

import type { PgVersionCheck } from '../pg-version.util';
import {
  RESTORE_GATE_TIMEOUT_MS,
  evaluateRestoreGate,
  type RestoreGateContext,
  type RestoreGateDefinition,
  type RestoreGateKind,
  type RestoreGateOutcome,
  type RestorePreflightFacts,
} from '../restore-gate.registry';

/**
 * The test runner's own globals, passed in.
 *
 * @stability experimental
 */
export interface RestoreGateConformanceHarness {
  /** The runner's `describe`. */
  describe: (name: string, fn: () => void) => unknown;
  /** The runner's `it`. Every case body the kit passes is an asynchronous function. */
  it: (name: string, fn: () => Promise<void>) => unknown;
  /** The runner's `expect`. */
  expect: (actual: unknown) => any;
}

/**
 * One case: the context to ask the gate under, and what it should answer.
 *
 * @stability experimental
 */
export interface RestoreGateScenario {
  /** Names the case. */
  name: string;
  /** System settings namespaces the gate may read, by namespace key (`ctx.settings.get`). Default none. */
  settings?: Record<string, Record<string, unknown>>;
  /** Fields of the context to override (`run`, `policy`, `facts`, ...). */
  context?: Partial<Omit<RestoreGateContext, 'settings'>>;
  /** The status the gate must answer. Omit to assert only that it answers. */
  expectStatus?: RestoreGateOutcome['status'];
}

/**
 * Options of {@link describeRestoreGateConformance}.
 *
 * @stability experimental
 */
export interface RestoreGateConformanceOptions extends RestoreGateConformanceHarness {
  /** The cases. At least one. */
  scenarios: readonly RestoreGateScenario[];
  /**
   * Counters of the gate's own side-effecting dependencies (`calls()` reads how
   * many times each was used). Each must be zero after every case.
   */
  watch?: ReadonlyArray<{ name: string; calls(): number }>;
}

const KINDS: readonly RestoreGateKind[] = ['capability', 'disk', 'replicas', 'overridable', 'app'];

/** A healthy cluster: every built-in gate would pass on it. */
const HEALTHY_FACTS: RestorePreflightFacts = Object.freeze({
  version: Object.freeze({ status: 'ok', clientMajor: 17, serverMajor: 17, message: 'The client and server majors match (17).' }) as PgVersionCheck,
  cluster: Object.freeze({
    reachable: true,
    error: null,
    canCreateDatabase: true,
    missingExtensions: Object.freeze([]) as readonly string[],
    checkedExtensions: 0,
    databaseSizeBytes: 1_000_000n,
    dataDirectory: '/var/lib/postgresql/data',
    distinctClientAddresses: 1,
    rlsBypass: Object.freeze({ superuser: false, bypassRls: false, optionApplied: true }),
  }),
  connection: Object.freeze({ host: 'db', port: '5432', user: 'app', database: 'postgres', liveDatabase: 'app' }),
  freeDiskBytes: 1_000_000_000n,
  migrationComparison: 'match',
});

const POLICY: SystemDatabaseBackupValue = Object.freeze({
  enabled: true,
  frequency: 'daily',
  dayOfWeek: 0,
  dayOfMonth: 1,
  timeOfDay: '02:00',
  timezone: 'UTC',
  retentionCount: 7,
  storageProvider: '',
  runStaleMinutes: 120,
  compressionLevel: 6,
  restoreRollbackMode: 'retain_database',
  oldDatabaseRetentionHours: 48,
  nodeOffloadEnabled: false,
}) as SystemDatabaseBackupValue;

/**
 * A complete {@link RestoreGateContext} for a test: a completed archive, a
 * healthy cluster, the stock `databaseBackup` policy and a settings reader over
 * `settings` (an unknown namespace reads as `undefined`, like an unregistered one).
 *
 * @param overrides - fields to replace.
 * @param settings - system settings namespaces by key.
 * @returns the context (not frozen; the kit freezes its own).
 *
 * @stability experimental
 */
export function buildRestoreGateContext(
  overrides: Partial<Omit<RestoreGateContext, 'settings'>> = {},
  settings: Record<string, Record<string, unknown>> = {},
): RestoreGateContext {
  return {
    run: {
      id: '11111111-1111-4111-8111-111111111111',
      storageKey: 'database-backups/app/2026/10/app-20261001T020000Z-1111.dump',
      storageProvider: 's3',
      sizeBytes: '1000000',
      migrationName: '0033_add_android_app',
      createdAt: new Date('2026-10-01T02:00:00.000Z'),
    },
    policy: POLICY,
    now: new Date('2026-10-02T12:00:00.000Z'),
    targetDatabase: 'app',
    liveMigration: '0033_add_android_app',
    overrideSchemaMismatch: false,
    settings: { get: async (namespace: string) => settings[namespace] },
    facts: HEALTHY_FACTS,
    ...overrides,
  };
}

/**
 * Wraps a context in a recording proxy: reading is free, any write is recorded.
 * Nested objects are wrapped on the way out, so `ctx.facts.cluster.x = 1` is
 * caught as well.
 */
function guarded<T extends object>(value: T, violations: string[], path: string): T {
  // A shallow COPY is the proxy target: a frozen object's read-only properties
  // would otherwise force the proxy to return the original values unwrapped.
  const copy = (Array.isArray(value) ? [...value] : { ...value }) as T;

  return new Proxy(copy, {
    get(target, property, receiver) {
      const inner = Reflect.get(target, property, receiver);
      if (typeof property === 'symbol') return inner;
      if (inner !== null && typeof inner === 'object' && !(inner instanceof Date)) {
        return guarded(inner as object, violations, `${path}.${property}`);
      }
      return inner;
    },
    set(_target, property) {
      violations.push(`assigned ${path}.${String(property)}`);
      return true;
    },
    defineProperty(_target, property) {
      violations.push(`defined ${path}.${String(property)}`);
      return true;
    },
    deleteProperty(_target, property) {
      violations.push(`deleted ${path}.${String(property)}`);
      return true;
    },
  });
}

/**
 * Registers the restore gate conformance suite.
 *
 * @param gate - the gate definition (the object passed to `registerRestoreGate`).
 * @param options - the runner and the cases.
 *
 * @example
 * ```ts
 * describeRestoreGateConformance(cdnQuiescedGate, { describe, it, expect, scenarios: [{ name: 'quiesced', settings: { cdn: { quiesced: true } }, expectStatus: 'pass' }] });
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function describeRestoreGateConformance(
  gate: RestoreGateDefinition,
  options: RestoreGateConformanceOptions,
): void {
  const { describe, it, expect } = options;

  describe(`restore gate conformance: ${gate.id}`, () => {
    it('[definition] declares a valid id, label, kind and check', async () => {
      expect(gate.id).toMatch(/^[a-z][a-z0-9_-]{1,63}$/);
      expect(typeof gate.label).toBe('string');
      expect(gate.label.trim().length).toBeGreaterThan(0);
      if (gate.kind !== undefined) expect(KINDS).toContain(gate.kind);
      expect(typeof gate.check).toBe('function');
      expect(options.scenarios.length).toBeGreaterThan(0);
    });

    for (const scenario of options.scenarios) {
      const contextFor = (violations: string[]): RestoreGateContext => {
        const base = buildRestoreGateContext(scenario.context ?? {}, scenario.settings ?? {});
        return guarded(base, violations, 'ctx');
      };

      it(`[answers] ${scenario.name}: answers { status, message } within the time bound`, async () => {
        const violations: string[] = [];
        const started = Date.now();
        const outcome = await gate.check(contextFor(violations));

        expect(Date.now() - started).toBeLessThan(RESTORE_GATE_TIMEOUT_MS);
        expect(['pass', 'warn', 'fail']).toContain(outcome.status);
        expect(typeof outcome.message).toBe('string');
        expect(outcome.message.trim().length).toBeGreaterThan(0);
        if (outcome.action !== undefined && outcome.action !== null) expect(typeof outcome.action).toBe('string');
        if (scenario.expectStatus !== undefined) expect(outcome.status).toBe(scenario.expectStatus);
      });

      it(`[read-only] ${scenario.name}: writes nothing to its context and triggers no watched side effect`, async () => {
        const violations: string[] = [];
        await gate.check(contextFor(violations));

        expect(violations).toEqual([]);
        for (const watched of options.watch ?? []) {
          expect(`${watched.name}: ${watched.calls()} call(s)`).toBe(`${watched.name}: 0 call(s)`);
        }
      });

      it(`[repeatable] ${scenario.name}: the same context answers the same twice`, async () => {
        const first = await gate.check(contextFor([]));
        const second = await gate.check(contextFor([]));

        expect(second.status).toBe(first.status);
        expect(second.message).toBe(first.message);
      });

      it(`[registry] ${scenario.name}: evaluates to a pre-flight row carrying the gate's id and label`, async () => {
        const row = await evaluateRestoreGate(gate, buildRestoreGateContext(scenario.context ?? {}, scenario.settings ?? {}));

        expect(row.id).toBe(gate.id);
        expect(row.title).toBe(gate.label);
        expect(['pass', 'warning', 'block']).toContain(row.verdict);
        if (scenario.expectStatus !== undefined) {
          const verdict = { pass: 'pass', warn: 'warning', fail: 'block' }[scenario.expectStatus];
          expect(row.verdict).toBe(verdict);
        }
      });
    }
  });
}
