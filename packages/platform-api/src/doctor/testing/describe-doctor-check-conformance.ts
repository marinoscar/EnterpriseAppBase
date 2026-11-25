// =============================================================================
// The Doctor check conformance kit (PP-14.26)
// =============================================================================
//
// Rule 3 of the check contract says a check is read-only, and until this kit the
// rule was convention: an extension author had nothing to run. `describeDoctorCheckConformance`
// is what an app (or a package that ships checks) calls from its own spec, once
// per check, to prove the whole contract for that check:
//
//   - it describes itself well (a dotted id, a category, a label, a root-relative
//     settings path, a sane timeout);
//   - it completes within its timeout and never throws;
//   - it returns a valid outcome: a status, a one-line detail, a remedy on warn
//     and fail, scalar data;
//   - it is READ-ONLY: it ran against a recording Prisma client and a write-failing
//     storage provider, and wrote to neither;
//   - it leaks no secret material.
//
// The check is built per test by the caller's factory, which receives the two
// doubles, so a check that takes `PLATFORM_PRISMA` or `STORAGE_PROVIDER` is
// constructed over them and a check that takes neither still gets the same grading.
// A scenario is one world to run the check in (configured, unconfigured, the
// dependency down); each scenario re-runs every case.
//
// Runner-agnostic: the kit registers on a `ConformanceTestApi`, defaulting to the
// runner's globals, and uses only `toEqual` of the matcher subset.
// =============================================================================

import type { ConformanceTestApi } from '../../testing/index';
import { resolveConformanceTestApi } from '../../testing/index';
import type { DoctorCheck } from '../doctor-check.interface';
import type { DoctorStatus } from '../doctor-check.interface';
import { createRecordingPrisma } from './recording-prisma';
import type { RecordingPrisma, RecordingPrismaOptions } from './recording-prisma';
import { findIdentityProblems, findOutcomeProblems, runDoctorCheck } from './run-doctor-check';
import { createWriteFailingStorage } from './write-failing-storage';
import type { WriteFailingStorage, WriteFailingStorageOptions } from './write-failing-storage';

/**
 * The two doubles a check is built over for one test.
 *
 * @stability experimental
 */
export interface DoctorCheckDoubles {
  /** A recording Prisma client; bind it where the check takes `PLATFORM_PRISMA` or its slice's client. */
  readonly prisma: RecordingPrisma;
  /** A write-failing storage provider; bind it where the check takes `STORAGE_PROVIDER`. */
  readonly storage: WriteFailingStorage;
}

/**
 * Builds the check under test over the doubles. Called once per test, so state
 * never leaks between cases.
 *
 * @stability experimental
 */
export type DoctorCheckFactory = (doubles: DoctorCheckDoubles) => DoctorCheck | Promise<DoctorCheck>;

/**
 * One world to run the check in.
 *
 * @stability experimental
 */
export interface DoctorCheckScenario {
  /** The scenario's name, shown in every test title (`configured`, `provider down`). */
  readonly name: string;
  /** Scripted reads for the Prisma double (`{ 'job.count': 12 }`) and the storage double. */
  readonly prisma?: RecordingPrismaOptions;
  /** Options for the storage double. */
  readonly storage?: WriteFailingStorageOptions;
  /** Builds the check for this scenario when it differs from the suite's factory. */
  readonly build?: DoctorCheckFactory;
  /** The statuses the scenario may return (default: any valid status). */
  readonly expectStatus?: DoctorStatus | readonly DoctorStatus[];
  /** Strings that are secret in this scenario; none may appear in the result. */
  readonly secrets?: readonly string[];
}

/**
 * What {@link describeDoctorCheckConformance} accepts.
 *
 * @example
 * ```ts
 * describeDoctorCheckConformance('example.capability', ({ prisma }) => new MyCheck(registry, prisma.client), {
 *   scenarios: [
 *     { name: 'enabled and configured', prisma: { results: { 'setting.findFirst': { value: 'on' } } }, expectStatus: 'pass' },
 *     { name: 'switched off', expectStatus: 'skip' },
 *   ],
 * });
 * ```
 *
 * @extensionPoint option
 * @stability experimental
 */
export interface DoctorCheckConformanceOptions {
  /** The worlds to run in; one default scenario when omitted. */
  readonly scenarios?: readonly DoctorCheckScenario[];
  /** The ceiling for a check that declares no `timeoutMs` (default 5000, the service's). */
  readonly defaultTimeoutMs?: number;
  /** A test API to register on; defaults to the runner's globals. */
  readonly testApi?: ConformanceTestApi;
}

/**
 * Registers the Doctor check conformance cases for one check: identity, a
 * guarded run, a valid outcome, read-only against both doubles, and no secret
 * material, once per scenario.
 *
 * @param name - the check's id or a title for the `describe` block.
 * @param factory - builds the check over the doubles, once per test.
 * @param options - scenarios, the default timeout and the test API.
 *
 * @extensionPoint hook
 * @stability experimental
 */
export function describeDoctorCheckConformance(
  name: string,
  factory: DoctorCheckFactory,
  options: DoctorCheckConformanceOptions = {},
): void {
  const api = resolveConformanceTestApi('describeDoctorCheckConformance', options.testApi);
  const scenarios: readonly DoctorCheckScenario[] = options.scenarios?.length ? options.scenarios : [{ name: 'default' }];

  api.describe(`Doctor check conformance: ${name}`, () => {
    const prepare = async (scenario: DoctorCheckScenario): Promise<{ check: DoctorCheck; doubles: DoctorCheckDoubles }> => {
      const doubles: DoctorCheckDoubles = {
        prisma: createRecordingPrisma(scenario.prisma),
        storage: createWriteFailingStorage(scenario.storage),
      };
      return { check: await (scenario.build ?? factory)(doubles), doubles };
    };

    for (const scenario of scenarios) {
      const title = (text: string): string => (scenarios.length > 1 || scenario.name !== 'default' ? `[${scenario.name}] ${text}` : text);

      api.it(title('describes itself: a dotted id, a category, a label, a root-relative settings path, a sane timeout'), async () => {
        const { check } = await prepare(scenario);
        api.expect(findIdentityProblems(check)).toEqual([]);
      });

      api.it(title('completes within its timeout, never throws and returns a valid outcome with a remedy on warn and fail'), async () => {
        const { check } = await prepare(scenario);
        const run = await runDoctorCheck(check, { defaultTimeoutMs: options.defaultTimeoutMs });
        api.expect(findOutcomeProblems(check, run, { secrets: scenario.secrets })).toEqual([]);
      });

      api.it(title('answers one of the statuses the scenario expects'), async () => {
        const { check } = await prepare(scenario);
        const run = await runDoctorCheck(check, { defaultTimeoutMs: options.defaultTimeoutMs });
        const allowed = scenario.expectStatus === undefined ? undefined : ([] as DoctorStatus[]).concat(scenario.expectStatus);
        const got = run.outcome?.status;
        api.expect(allowed === undefined || (got !== undefined && allowed.includes(got)) ? [] : [`expected ${allowed?.join(' or ')}, got ${String(got)}`]).toEqual([]);
      });

      api.it(title('is read-only: it writes nothing through Prisma and nothing to object storage'), async () => {
        const { check, doubles } = await prepare(scenario);
        await runDoctorCheck(check, { defaultTimeoutMs: options.defaultTimeoutMs });
        api.expect(doubles.prisma.violations().map((operation) => operation.path)).toEqual([]);
        api.expect(doubles.storage.violations().map((operation) => operation.method)).toEqual([]);
      });
    }
  });
}
