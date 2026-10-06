// =============================================================================
// The admin doctor check contract (issue #634; packaged by #696)
// =============================================================================
//
// `GET /api/admin/doctor` answers one question for an administrator: "is every
// capability of this deployment configured, reachable and healthy?" It does so
// by running a set of small, independent checks — one per fact worth knowing —
// that each capability's own module contributes.
//
// The contract deliberately mirrors the CLI's pre-install doctor
// (`apps/cli/src/deploy/checks/types.ts`): the same four statuses, the same
// one-line `detail`, the same `remedy`. An operator who has read one report
// can read the other. The API doctor answers "is the RUNNING deployment
// healthy?", where the CLI doctor answers "is this SERVER ready to install?".
//
// FIVE RULES THAT MAKE THIS WORTH HAVING:
//
//   1. A CHECK NEVER THROWS. A crashed probe is a `fail` carrying the error's
//      message. `DoctorService` guards every call as well (a throw becomes a
//      `fail`, a hang becomes a `fail` after `timeoutMs`), but a check that
//      relies on that guard reports a worse `detail` than one that catches
//      its own failure and says what it was doing.
//
//   2. `remedy` IS EXPECTED ON `warn` AND `fail`, and should name a settings
//      page, a command or an environment variable — "fix storage" is not a
//      remedy. The service fills a generic one ("Open <settingsPath> to
//      review.") when a check omits it, so the report never shows a problem
//      with no next step; each check's own spec asserts it supplies a real one.
//
//   3. ⚠ CHECKS ARE READ-ONLY. A doctor run must be safe against a production
//      deployment at any time, by anyone holding `system_settings:read`, as
//      often as they like. Concretely, a check:
//        - NEVER calls the side-effecting "test" services:
//          `StorageConnectionTestService`, `AiProviderTestService`,
//          `EmailTestSendService`, `PushTestService`,
//          `TelemetryConnectionTestService`. Those write probe objects, spend
//          model tokens, send mail and pushes, or audit the attempt;
//        - never writes an object, a row or an audit event;
//        - never enqueues a job or calls a model.
//      Reading (a `SELECT`, a `HEAD`, a settings read) is the whole budget.
//
//   4. RESULTS NEVER CONTAIN SECRET MATERIAL. Not in `detail`, not in
//      `error`, not in `data`. A check that reads a secret to validate it
//      (the VAPID private key, say) reports only the verdict. Lengths and
//      counts are fine; values, hints and fingerprints are not.
//
//   5. `skip` MEANS "NOT EVALUATED", for one of two reasons:
//        - a check it `dependsOn` did not pass (the service decides this; the
//          check does not run at all), or
//        - the capability is INTENTIONALLY OFF — AI switched off, telemetry
//          collection off. That is an operator's choice, not a problem, so it
//          is neither `warn` (nothing to fix) nor `pass` (nothing was proven).
//          A `skip` needs no remedy.
//
// Registration: see `doctor-check.registry.ts`. Each check is an
// `@Injectable()` in its OWNING feature module of the app, under
// `<module>/doctor/`, that calls `registry.register(this)` from its own
// `onModuleInit`. Checks never live in this package: they are registry
// entries the app contributes (the Extension Contract, rung 2).
// =============================================================================

/**
 * The four outcomes of a check, identical to the CLI doctor's `CheckStatus`.
 *
 * - `pass`: verified healthy.
 * - `warn`: works, but needs attention.
 * - `fail`: broken.
 * - `skip`: not evaluated (a dependency did not pass, or the capability is
 *   intentionally switched off).
 *
 * @stability stable
 */
export type DoctorStatus = 'pass' | 'warn' | 'fail' | 'skip';

/**
 * Every status, in severity order (`pass < skip < warn < fail`).
 *
 * @stability stable
 */
export const DOCTOR_STATUSES: readonly DoctorStatus[] = ['pass', 'skip', 'warn', 'fail'];

/**
 * How bad a status is, for the report's overall verdict: the worst wins.
 *
 * `skip` ranks just above `pass` — a report whose only non-pass entries are
 * intentional skips (AI off, telemetry off) is healthy, but it proved less than
 * an all-pass one, and a report where NOTHING ran must not read as "pass".
 *
 * @stability stable
 */
export const DOCTOR_STATUS_RANK: Readonly<Record<DoctorStatus, number>> = {
  pass: 0,
  skip: 1,
  warn: 2,
  fail: 3,
};

/**
 * The categories the platform ships, in display order. The default of
 * `DoctorModuleOptions.categoryOrder`; an app adds its own simply by using a
 * new string (or reorders them with that option), never by editing this list.
 *
 * @stability stable
 */
export const PLATFORM_DOCTOR_CATEGORIES = [
  'core',
  'auth',
  'maintenance',
  'storage',
  'email',
  'push',
  'ai',
  'jobs',
  'nodes',
  'backup',
  'telemetry',
] as const;

/**
 * The shipped categories under their pre-package name.
 *
 * @deprecated Use {@link PLATFORM_DOCTOR_CATEGORIES}; same values, same order.
 * @stability stable
 */
export const DOCTOR_CATEGORIES = PLATFORM_DOCTOR_CATEGORIES;

/**
 * One of the shipped categories.
 *
 * @stability stable
 */
export type CoreDoctorCategory = (typeof PLATFORM_DOCTOR_CATEGORIES)[number];

/**
 * A check's category. The shipped ones autocomplete; an app adds its own simply
 * by using a new string (it sorts after the configured ones, in registration
 * order) — no edit to this package needed.
 *
 * @stability stable
 */
export type DoctorCategory = CoreDoctorCategory | (string & {});

/**
 * A scalar fact a check wants to show beside its detail. Never secret material.
 *
 * @stability stable
 */
export type DoctorDataValue = string | number | boolean | null;

/**
 * What one run of a check found.
 *
 * @stability stable
 */
export interface DoctorCheckOutcome {
  /** The verdict. */
  status: DoctorStatus;
  /** One line: what was found. "Connected in 12 ms", "No provider is enabled". */
  detail: string;
  /** Expected on warn/fail: a settings page, a command or a variable to set. */
  remedy?: string;
  /** The underlying error message, when a probe failed. Never secret material. */
  error?: string;
  /** Small scalar facts (counts, versions, latencies). Never secret material. */
  data?: Record<string, DoctorDataValue>;
}

/**
 * One read-only check of the running deployment, contributed by the app's
 * feature module that owns the capability: an `@Injectable()` that injects
 * `DoctorCheckRegistry` and calls `register(this)` in its `onModuleInit`.
 *
 * The five rules: it never throws; it gives a `remedy` on `warn`/`fail`; it is
 * READ-ONLY (no write, no audit event, no job, no model call, no "test" service);
 * its results never carry secret material; `skip` means "not evaluated".
 *
 * @example
 * ```ts
 * @Injectable()
 * export class DbConnectionDoctorCheck implements DoctorCheck, OnModuleInit {
 *   readonly id = 'core.database';
 *   readonly category = 'core';
 *   readonly label = 'Database connection';
 *   constructor(private readonly registry: DoctorCheckRegistry, private readonly prisma: PrismaService) {}
 *   onModuleInit() { this.registry.register(this); }
 *   async run(): Promise<DoctorCheckOutcome> { ... }
 * }
 * ```
 *
 * @extensionPoint registry
 * @stability stable
 */
export interface DoctorCheck {
  /** Stable, dotted, unique across the application: `storage.bucket`. */
  readonly id: string;
  /** Where the report groups it. */
  readonly category: DoctorCategory;
  /** Short human label: "Object storage bucket". */
  readonly label: string;
  /** The web route that fixes this, e.g. `/admin/settings/storage`. */
  readonly settingsPath?: string;
  /** Per-check ceiling; the module's `defaultTimeoutMs` (5000 ms) otherwise. */
  readonly timeoutMs?: number;
  /**
   * Ids of checks that must not `fail` or `skip` for this one to run. When one
   * does, this check is reported as `skip` and `run()` is never called.
   */
  readonly dependsOn?: readonly string[];
  /** Read-only. See rules 1, 3 and 4 in this file's header. */
  run(): Promise<DoctorCheckOutcome>;
}
