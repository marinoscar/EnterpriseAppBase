// =============================================================================
// Suite: every registered Doctor check is read-only (PP-14.26)
// =============================================================================
//
// Rule 3 of the check contract (`../doctor-check.interface.ts`): a Doctor run is
// safe against production, by anyone holding `system_settings:read`, as often as
// they like. A check never calls the side-effecting "test" services, never
// writes an object, a row or an audit event, never enqueues a job or calls a
// model. Until this suite that was a sentence in a header.
//
// WHAT IT DOES. It boots the app through the fixture with two doubles installed:
// a recording Prisma client that refuses every write, and a storage provider that
// refuses every write. It then takes every check the app's `DoctorCheckRegistry`
// holds (DISCOVERED at run time, never listed: a check added tomorrow is covered
// with no edit), runs each under the service's guard, and fails when a check
//
//   - wrote through Prisma: a `create`/`update`/`upsert`/`delete` call, an
//     `$executeRaw`, or a raw query whose SQL is a write (this also catches a job
//     enqueue, an audit write and a settings upsert-on-read, which all end in a row);
//   - wrote to object storage (an upload, a delete, a presigned PUT: the work of
//     `StorageConnectionTestService`);
//   - holds a side-effecting "test" service (`StorageConnectionTestService`,
//     `AiProviderTestService`, `EmailTestSendService`, `PushTestService`,
//     `TelemetryConnectionTestService`) as a dependency, which is how a check that
//     spends model tokens or sends mail is caught without running it;
//   - throws, times out, or returns something that is not a valid outcome (graded the
//     way the service meets it: a check whose `dependsOn` did not pass is never called
//     by the service, so its outcome is not graded, though it still runs for writes).
//
// WHAT IT CANNOT SEE. A write that reaches neither double (an HTTP POST from the
// check itself, a file write) and a model call made without a held test service.
// The check's own spec, run through `describeDoctorCheckConformance`, covers what
// the check does by itself; this suite is the tripwire on the shape every check
// shares.
//
// AN OPT-OUT NEEDS A REASON. `exempt` takes `{ id, why }`: an empty `why` throws,
// and an entry naming a check that is not registered is a finding, so the list
// cannot go stale. Adding one is a change to the owning spec too.
// =============================================================================

import type { ConformanceAppSuite } from '../../testing/index';
import { conformanceSuites } from '../../testing/index';
import type { DoctorCheck } from '../doctor-check.interface';
import { DoctorCheckRegistry } from '../doctor-check.registry';
import { createRecordingPrisma } from './recording-prisma';
import type { RecordingPrisma } from './recording-prisma';
import { findOutcomeProblems, runDoctorCheck } from './run-doctor-check';
import type { DoctorCheckRun } from './run-doctor-check';
import { createWriteFailingStorage } from './write-failing-storage';
import type { WriteFailingStorage } from './write-failing-storage';

declare module '../../testing/index' {
  interface PlatformConformanceSuiteOptions {
    /** The `doctor-read-only` suite: its options, or `{ skip: 'reason' }` to opt out. Registered by importing `@marinoscar/platform-api/doctor/testing`. */
    doctorReadOnly?: DoctorReadOnlyOptions;
  }
}

/**
 * The two doubles the suite asks the app to install while it boots.
 *
 * @stability experimental
 */
export interface DoctorReadOnlyDoubles {
  /**
   * Install `prisma.client` under every Prisma token the app binds (`PrismaService`,
   * `PLATFORM_PRISMA`, the system client). It does not refuse writes while the app
   * boots; the suite turns refusal on before the first check.
   */
  readonly prisma: RecordingPrisma;
  /** Install `storage.provider` under `STORAGE_PROVIDER`. */
  readonly storage: WriteFailingStorage;
}

/**
 * A booted Nest application, as far as the suite uses it. Structural, so the
 * package needs no Nest application type.
 *
 * @stability experimental
 */
export interface DoctorConformanceApp {
  /** Resolves a provider from the container. */
  get<T = unknown>(token: unknown): T;
}

/**
 * A booted app. `app` is what the suite reads; anything else the fixture keeps
 * is its own (the reference app returns its test context).
 *
 * @stability experimental
 */
export interface DoctorConformanceContext {
  /** The booted application. */
  readonly app: DoctorConformanceApp;
}

/**
 * How the app boots for the suite: the whole of what `doctor-read-only` asks of
 * it. The reference app implements it in `apps/api/test/conformance/doctor-fixture.ts`
 * from `createTestApp`.
 *
 * @example
 * ```ts
 * export const doctorConformanceFixture: DoctorConformanceFixture = {
 *   createContext: ({ prisma, storage }) =>
 *     createTestApp({
 *       overrideProviders: [
 *         { provide: PrismaService, useValue: prisma.client },
 *         { provide: STORAGE_PROVIDER, useValue: storage.provider },
 *       ],
 *     }),
 *   closeContext: (context) => closeTestApp(context as TestContext),
 * };
 * ```
 *
 * @extensionPoint option
 * @stability experimental
 */
export interface DoctorConformanceFixture {
  /** Boots the app with the doubles installed under the app's Prisma and storage tokens. */
  createContext(doubles: DoctorReadOnlyDoubles): Promise<DoctorConformanceContext>;
  /** Closes what `createContext` opened. */
  closeContext(context: DoctorConformanceContext): Promise<void>;
}

/**
 * One check the app argues is allowed to break the rule.
 *
 * @stability experimental
 */
export interface DoctorReadOnlyExemption {
  /** The registered check id. */
  readonly id: string;
  /** Why this check must write; required, and a stale id is a finding. */
  readonly why: string;
}

/**
 * How an app configures the `doctor-read-only` suite.
 *
 * @example
 * ```ts
 * import '@marinoscar/platform-api/doctor/testing'; // registers the suite
 * runPlatformConformance({
 *   sourceRoots: [API_SOURCE_ROOT],
 *   suites: { doctorReadOnly: { fixture: doctorConformanceFixture, minChecks: 20 } },
 * });
 * ```
 *
 * @extensionPoint option
 * @stability experimental
 */
export interface DoctorReadOnlyOptions {
  /** How the app boots with the doubles installed. */
  readonly fixture: DoctorConformanceFixture;
  /** Vacuity guard: at least this many checks must be registered (default 10). */
  readonly minChecks?: number;
  /** Checks allowed to break the rule, each with a written reason (default none). */
  readonly exempt?: readonly DoctorReadOnlyExemption[];
  /**
   * Class names of the side-effecting services a check must not hold. Default:
   * `StorageConnectionTestService`, `AiProviderTestService`, `EmailTestSendService`,
   * `PushTestService`, `TelemetryConnectionTestService`. An app that adds its own
   * "test connection" service adds its class name here.
   */
  readonly forbiddenServices?: readonly string[];
  /** The ceiling for a check that declares no `timeoutMs` (default 5000, the service's). */
  readonly defaultTimeoutMs?: number;
}

/**
 * The class names of the side-effecting "test" services a Doctor check must not
 * hold (rule 3 of the contract). The default of `DoctorReadOnlyOptions.forbiddenServices`.
 *
 * @stability experimental
 */
export const DOCTOR_FORBIDDEN_SERVICES: readonly string[] = [
  'StorageConnectionTestService',
  'AiProviderTestService',
  'EmailTestSendService',
  'PushTestService',
  'TelemetryConnectionTestService',
];

/**
 * What the suite saw of one check.
 *
 * @stability experimental
 */
export interface DoctorCheckAudit {
  /** The check's id. */
  readonly id: string;
  /** The guarded run. */
  readonly run: DoctorCheckRun;
  /** Prisma calls that write, made during this check's run. */
  readonly prismaWrites: readonly string[];
  /** Storage calls that write, made during this check's run. */
  readonly storageWrites: readonly string[];
  /** The forbidden services the check holds, by class name. */
  readonly heldServices: readonly string[];
  /**
   * The id of a dependency (`dependsOn`) that is not registered, failed or was
   * skipped. The service never calls such a check, so it may assume what it
   * depends on holds; the suite still ran it, to watch for writes, but does not
   * grade its outcome.
   */
  readonly blockedBy?: string;
  /** Contract problems of the outcome (see `findOutcomeProblems`); always empty for a blocked check. */
  readonly outcomeProblems: readonly string[];
}

/** Class names reachable from a check's own fields, two levels deep, that are in `forbidden`. */
function heldForbiddenServices(check: DoctorCheck, forbidden: ReadonlySet<string>): string[] {
  const found = new Set<string>();
  const seen = new Set<unknown>([check]);

  const visit = (value: unknown, depth: number): void => {
    if (typeof value !== 'object' || value === null || seen.has(value)) return;
    seen.add(value);
    const name = (value as { constructor?: { name?: string } }).constructor?.name;
    if (name !== undefined && forbidden.has(name)) found.add(name);
    if (depth === 0) return;
    for (const child of Object.values(value)) visit(child, depth - 1);
  };

  for (const field of Object.values(check)) visit(field, 2);
  return [...found];
}

/**
 * Runs every check once over the doubles and records what each did.
 *
 * Every check runs, so a write is seen whatever its dependencies did. Its
 * OUTCOME is graded the way the service would meet it: a check whose
 * `dependsOn` did not pass is `blockedBy` that dependency and is not graded, as
 * the service reports it `skip` without ever calling `run()`.
 *
 * @param checks - the registered checks.
 * @param doubles - the doubles the app was booted with.
 * @param options - forbidden service names and the default timeout.
 * @returns one audit per check, in order.
 *
 * @stability experimental
 */
export async function auditDoctorChecks(
  checks: readonly DoctorCheck[],
  doubles: DoctorReadOnlyDoubles,
  options: Pick<DoctorReadOnlyOptions, 'forbiddenServices' | 'defaultTimeoutMs'> = {},
): Promise<DoctorCheckAudit[]> {
  const forbidden = new Set(options.forbiddenServices ?? DOCTOR_FORBIDDEN_SERVICES);
  const runs = new Map<string, DoctorCheckRun>();
  const written = new Map<string, { prisma: string[]; storage: string[] }>();

  for (const check of checks) {
    const prismaBefore = doubles.prisma.violations().length;
    const storageBefore = doubles.storage.violations().length;

    runs.set(check.id, await runDoctorCheck(check, { defaultTimeoutMs: options.defaultTimeoutMs }));
    written.set(check.id, {
      prisma: doubles.prisma.violations().slice(prismaBefore).map((operation) => operation.path),
      storage: doubles.storage.violations().slice(storageBefore).map((operation) => operation.method),
    });
  }

  // The status the service would report: `skip` for a blocked check, else what it returned (`fail` for a throw or a hang).
  const byId = new Map(checks.map((check) => [check.id, check]));
  const blockers = new Map<string, string | undefined>();
  const resolving = new Set<string>();
  const blockerOf = (check: DoctorCheck): string | undefined => {
    if (blockers.has(check.id)) return blockers.get(check.id);
    if (resolving.has(check.id)) return check.id;
    resolving.add(check.id);
    let blocker: string | undefined;
    for (const dependencyId of check.dependsOn ?? []) {
      const dependency = byId.get(dependencyId);
      const status = !dependency || blockerOf(dependency) !== undefined ? 'skip' : (runs.get(dependencyId)?.outcome?.status ?? 'fail');
      if (status === 'fail' || status === 'skip') {
        blocker = dependencyId;
        break;
      }
    }
    resolving.delete(check.id);
    blockers.set(check.id, blocker);
    return blocker;
  };

  return checks.map((check) => {
    const run = runs.get(check.id)!;
    const blockedBy = blockerOf(check);
    return {
      id: check.id,
      run,
      prismaWrites: written.get(check.id)!.prisma,
      storageWrites: written.get(check.id)!.storage,
      heldServices: heldForbiddenServices(check, forbidden),
      ...(blockedBy === undefined ? {} : { blockedBy }),
      outcomeProblems: blockedBy === undefined ? findOutcomeProblems(check, run) : [],
    };
  });
}

/**
 * The read-only findings of a set of audits, one sentence each, minus the
 * exempt checks. Pure, so the rule is tested against planted violators as well
 * as the real registry.
 *
 * @param audits - what {@link auditDoctorChecks} returned.
 * @param exempt - the argued exemptions.
 * @returns the findings by rule; every list empty means the checks conform.
 *
 * @stability experimental
 */
export function findReadOnlyViolations(
  audits: readonly DoctorCheckAudit[],
  exempt: readonly DoctorReadOnlyExemption[] = [],
): { prisma: string[]; storage: string[]; services: string[]; outcomes: string[]; staleExemptions: string[] } {
  const exemptIds = new Set(exempt.map((entry) => entry.id));
  const live = audits.filter((audit) => !exemptIds.has(audit.id));
  const known = new Set(audits.map((audit) => audit.id));

  return {
    prisma: live.filter((a) => a.prismaWrites.length > 0).map((a) => `${a.id} wrote through Prisma: ${a.prismaWrites.join(', ')}`),
    storage: live.filter((a) => a.storageWrites.length > 0).map((a) => `${a.id} wrote to object storage: ${a.storageWrites.join(', ')}`),
    services: live
      .filter((a) => a.heldServices.length > 0)
      .map((a) => `${a.id} holds the side-effecting ${a.heldServices.join(', ')}: a check never calls a "test" service`),
    outcomes: live.flatMap((a) => a.outcomeProblems),
    staleExemptions: exempt.filter((entry) => !known.has(entry.id)).map((entry) => `${entry.id} is exempt but no check with that id is registered: remove the entry`),
  };
}

/** Validates the options that make the suite vacuous or unargued; throws on misconfiguration. */
function assertOptions(options: DoctorReadOnlyOptions | undefined): asserts options is DoctorReadOnlyOptions {
  if (!options || typeof options.fixture?.createContext !== 'function' || typeof options.fixture?.closeContext !== 'function') {
    throw new Error(
      "doctor-read-only: pass `fixture` ({ createContext(doubles), closeContext(context) }), or skip the suite with a reason: `doctorReadOnly: { skip: 'why' }`.",
    );
  }
  for (const entry of options.exempt ?? []) {
    if (typeof entry.why !== 'string' || entry.why.trim() === '') {
      throw new Error(`doctor-read-only: the exemption for "${entry.id}" has no reason. An opt-out needs a written \`why\`.`);
    }
  }
}

/**
 * The suite behind `runPlatformConformance({ suites: { doctorReadOnly } })`.
 *
 * @extensionPoint registry
 * @stability experimental
 */
export const doctorReadOnlySuite: ConformanceAppSuite<DoctorReadOnlyOptions> = {
  id: 'doctor-read-only',
  title: 'Doctor checks are read-only',
  description:
    'Every registered Doctor check runs against a recording Prisma client and a write-failing storage provider: none writes a row, a job or an object, none holds a side-effecting "test" service, and each returns a valid outcome.',
  register(api, _context, options) {
    assertOptions(options);

    api.describe('Doctor checks are read-only', () => {
      let context: DoctorConformanceContext;
      let audits: DoctorCheckAudit[] = [];

      beforeAll(async () => {
        // Lenient while the app boots (a write at startup is recorded, not fatal), strict from the first check.
        const doubles: DoctorReadOnlyDoubles = {
          prisma: createRecordingPrisma({ refuseWrites: false }),
          storage: createWriteFailingStorage({ refuseWrites: false }),
        };
        context = await options.fixture.createContext(doubles);
        doubles.prisma.refuseWrites(true);
        doubles.storage.refuseWrites(true);
        doubles.prisma.reset();
        doubles.storage.reset();
        const checks = context.app.get<DoctorCheckRegistry>(DoctorCheckRegistry).list();
        audits = await auditDoctorChecks(checks, doubles, options);
      }, 120_000);

      afterAll(async () => {
        if (context) await options.fixture.closeContext(context);
      });

      api.it('finds the registered checks at all, so a broken discovery cannot pass vacuously', () => {
        api.expect(audits.length).toBeGreaterThanOrEqual(options.minChecks ?? 10);
      });

      api.it('no check writes a row, enqueues a job or records an audit event through Prisma', () => {
        api.expect(findReadOnlyViolations(audits, options.exempt).prisma).toEqual([]);
      });

      api.it('no check writes to object storage', () => {
        api.expect(findReadOnlyViolations(audits, options.exempt).storage).toEqual([]);
      });

      api.it('no check holds a side-effecting "test" service', () => {
        api.expect(findReadOnlyViolations(audits, options.exempt).services).toEqual([]);
      });

      api.it('every check completes in time, never throws and returns a valid outcome', () => {
        api.expect(findReadOnlyViolations(audits, options.exempt).outcomes).toEqual([]);
      });

      api.it('every exemption names a registered check', () => {
        api.expect(findReadOnlyViolations(audits, options.exempt).staleExemptions).toEqual([]);
      });
    });
  },
};

if (!conformanceSuites.has(doctorReadOnlySuite.id)) conformanceSuites.register(doctorReadOnlySuite);
