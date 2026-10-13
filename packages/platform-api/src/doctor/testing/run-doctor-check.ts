// =============================================================================
// Running one Doctor check the way the service does, and grading what came back
// (PP-14.26)
// =============================================================================
//
// `DoctorService` calls `check.run()` under a timeout and turns a throw into a
// `fail` row. A kit has to see the throw and the timeout, not hide them behind
// the same guard, so `runDoctorCheck` reproduces the guard and REPORTS what it
// caught. `findOutcomeProblems` then grades the result against the five rules of
// the contract (`../doctor-check.interface.ts`): valid status, a one-line
// detail, a remedy on `warn`/`fail`, scalar `data`, no secret material.
// =============================================================================

import { DOCTOR_STATUSES } from '@marinoscar/platform-contract/doctor';

import type { DoctorCheck, DoctorCheckOutcome } from '../doctor-check.interface';
import { DOCTOR_DEFAULT_TIMEOUT_MS, DOCTOR_FALLBACK_REMEDY } from '../doctor.service';

/**
 * What {@link runDoctorCheck} accepts.
 *
 * @stability experimental
 */
export interface RunDoctorCheckOptions {
  /** The ceiling for a check that declares no `timeoutMs` (default `DOCTOR_DEFAULT_TIMEOUT_MS`, 5000). */
  readonly defaultTimeoutMs?: number;
}

/**
 * What one guarded run of a check produced.
 *
 * @stability experimental
 */
export interface DoctorCheckRun {
  /** The outcome `run()` returned; `undefined` when it threw or timed out. Not validated: grade it with {@link findOutcomeProblems}. */
  readonly outcome: DoctorCheckOutcome | undefined;
  /** Whether `run()` threw or rejected. A check never throws (rule 1 of the contract). */
  readonly threw: boolean;
  /** The thrown error's message, when it threw. */
  readonly error?: string;
  /** Whether it did not answer within {@link timeoutMs}. */
  readonly timedOut: boolean;
  /** The ceiling that applied: the check's own `timeoutMs`, else the default. */
  readonly timeoutMs: number;
  /** Wall-clock milliseconds the run took. */
  readonly durationMs: number;
}

/**
 * Runs `check.run()` under the service's guard (its own `timeoutMs`, else the
 * default) and reports a throw and a timeout instead of absorbing them.
 *
 * @param check - the check under test.
 * @param options - the default timeout.
 * @returns the run; never rejects.
 *
 * @example
 * ```ts
 * const run = await runDoctorCheck(check);
 * expect(run.threw).toEqual(false);
 * expect(findOutcomeProblems(check, run)).toEqual([]);
 * ```
 *
 * @stability experimental
 */
export async function runDoctorCheck(check: DoctorCheck, options: RunDoctorCheckOptions = {}): Promise<DoctorCheckRun> {
  const timeoutMs = check.timeoutMs ?? options.defaultTimeoutMs ?? DOCTOR_DEFAULT_TIMEOUT_MS;
  const started = Date.now();
  let timer: NodeJS.Timeout | undefined;

  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs);
    timer.unref?.();
  });

  try {
    const result = await Promise.race([Promise.resolve().then(() => check.run()), timeout]);
    const durationMs = Date.now() - started;
    if (result === 'timeout') return { outcome: undefined, threw: false, timedOut: true, timeoutMs, durationMs };
    return { outcome: result, threw: false, timedOut: false, timeoutMs, durationMs };
  } catch (error) {
    return {
      outcome: undefined,
      threw: true,
      error: error instanceof Error ? error.message : String(error),
      timedOut: false,
      timeoutMs,
      durationMs: Date.now() - started,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Shapes that are secret material wherever they appear in a result. */
const SECRET_SHAPES: ReadonlyArray<{ name: string; pattern: RegExp }> = [
  { name: 'a PEM private key', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'a bearer token', pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/ },
  { name: 'a JWT', pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/ },
  { name: 'a personal-access or node token', pattern: /\b(?:pat|nod)_[A-Za-z0-9]{16,}/ },
];

/**
 * What {@link findOutcomeProblems} accepts.
 *
 * @stability experimental
 */
export interface OutcomeGradingOptions {
  /** Strings that are secret in this scenario (a seeded key, a token); none may appear anywhere in the result. */
  readonly secrets?: readonly string[];
}

/**
 * Grades one run against the contract: it did not throw, did not time out,
 * returned a valid outcome, supplied a remedy on `warn` and `fail`, kept `data`
 * scalar and carried no secret material.
 *
 * @param check - the check that ran (for the message).
 * @param run - what {@link runDoctorCheck} returned.
 * @param options - sentinel secrets to look for.
 * @returns one sentence per problem; empty means the run conforms.
 *
 * @stability experimental
 */
export function findOutcomeProblems(check: DoctorCheck, run: DoctorCheckRun, options: OutcomeGradingOptions = {}): string[] {
  const problems: string[] = [];
  const label = check.id;

  if (run.threw) {
    problems.push(`${label} threw "${run.error ?? ''}": a check never throws; catch the failure and return a fail that says what it was doing`);
  }
  if (run.timedOut) {
    problems.push(`${label} did not answer within its ${run.timeoutMs} ms ceiling: raise timeoutMs only if the probe is legitimately slow`);
  }
  if (run.threw || run.timedOut) return problems;

  const outcome = run.outcome;
  if (typeof outcome !== 'object' || outcome === null) {
    return [...problems, `${label} returned ${outcome === null ? 'null' : typeof outcome} instead of a DoctorCheckOutcome`];
  }

  if (!(DOCTOR_STATUSES as readonly string[]).includes(outcome.status)) {
    problems.push(`${label} returned the invalid status "${String(outcome.status)}" (expected ${DOCTOR_STATUSES.join(', ')})`);
  }
  if (typeof outcome.detail !== 'string' || outcome.detail.trim() === '') {
    problems.push(`${label} returned no detail: say in one line what was found`);
  }
  if (outcome.status === 'warn' || outcome.status === 'fail') {
    const remedy = typeof outcome.remedy === 'string' ? outcome.remedy.trim() : '';
    if (remedy === '') problems.push(`${label} returned ${outcome.status} without a remedy: name a settings page, a command or a variable`);
    else if (remedy === DOCTOR_FALLBACK_REMEDY) problems.push(`${label} returned the generic fallback remedy: supply a real one`);
  }
  for (const field of ['remedy', 'error'] as const) {
    if (outcome[field] !== undefined && typeof outcome[field] !== 'string') problems.push(`${label}.${field} must be a string when present`);
  }
  if (outcome.data !== undefined) {
    if (typeof outcome.data !== 'object' || outcome.data === null || Array.isArray(outcome.data)) {
      problems.push(`${label}.data must be an object of scalars`);
    } else {
      for (const [key, value] of Object.entries(outcome.data)) {
        if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) {
          problems.push(`${label}.data.${key} must be a string, number, boolean or null`);
        }
      }
    }
  }

  const serialized = JSON.stringify(outcome) ?? '';
  for (const secret of options.secrets ?? []) {
    if (secret !== '' && serialized.includes(secret)) problems.push(`${label} leaked a secret in its result (a value seeded as secret appears in it): report the verdict, never the value`);
  }
  for (const shape of SECRET_SHAPES) {
    if (shape.pattern.test(serialized)) problems.push(`${label} carries ${shape.name} in its result: results never contain secret material`);
  }

  return problems;
}

/**
 * The identity rules of a check: a dotted id, a category, a label, a root-relative
 * settings path, a positive timeout, and dependencies that are other ids.
 *
 * @param check - the check under test.
 * @returns one sentence per problem; empty means the check describes itself well.
 *
 * @stability experimental
 */
export function findIdentityProblems(check: DoctorCheck): string[] {
  const problems: string[] = [];

  if (typeof check.id !== 'string' || !/^[a-z][a-z0-9_-]*(\.[a-z0-9_-]+)+$/.test(check.id)) {
    problems.push(`id "${String(check.id)}" must be dotted and lower-case, like "storage.bucket"`);
  }
  if (typeof check.category !== 'string' || check.category.trim() === '') problems.push(`${check.id}: category must be a non-empty string`);
  if (typeof check.label !== 'string' || check.label.trim() === '') problems.push(`${check.id}: label must be a non-empty string`);
  if (check.settingsPath !== undefined && (typeof check.settingsPath !== 'string' || !check.settingsPath.startsWith('/'))) {
    problems.push(`${check.id}: settingsPath must be a route starting with "/", like "/admin/settings/storage"`);
  }
  if (check.timeoutMs !== undefined && !(typeof check.timeoutMs === 'number' && Number.isFinite(check.timeoutMs) && check.timeoutMs > 0)) {
    problems.push(`${check.id}: timeoutMs must be a positive number of milliseconds`);
  }
  if (check.dependsOn !== undefined) {
    if (!Array.isArray(check.dependsOn) || check.dependsOn.some((dependency) => typeof dependency !== 'string')) {
      problems.push(`${check.id}: dependsOn must be an array of check ids`);
    } else if (check.dependsOn.includes(check.id)) {
      problems.push(`${check.id}: dependsOn lists the check itself`);
    }
  }
  if (typeof check.run !== 'function') problems.push(`${check.id}: run must be a function`);

  return problems;
}
