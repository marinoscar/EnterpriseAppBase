// The contract between the harness (run-platform-conformance.ts) and a
// conformance suite (suites/*.ts). Nothing in src/testing imports Jest or
// Vitest: the harness is handed a minimal test API, so one package serves the
// Jest API and the Vitest web and CLI apps (docs/specs/platform-packages.md,
// "Conformance suites travel with packages").

/**
 * The slice of a test runner the harness needs, so it works under Jest and
 * Vitest (`globals: true`) without depending on either.
 *
 * @example
 * ```ts
 * // A recording fake, for testing a suite without a runner.
 * const calls: string[] = [];
 * const fake: ConformanceTestApi = {
 *   describe: (name, fn) => { calls.push(name); fn(); },
 *   it: (name) => { calls.push(name); },
 *   expect: () => ({ toEqual() {}, toBeGreaterThanOrEqual() {}, toContain() {} }),
 * };
 * ```
 *
 * @stability experimental
 */
export interface ConformanceTestApi {
  /** Registers a group of tests. */
  describe(name: string, fn: () => void): void;
  /** Registers one test. */
  it(name: string, fn: () => void | Promise<void>): void;
  /** The assertion entry point; only the matchers below are ever used. */
  expect: (actual: unknown) => {
    /** Deep equality with `expected`. */
    toEqual(expected: unknown): void;
    /** The actual number is at least `n`. */
    toBeGreaterThanOrEqual(n: number): void;
    /** The actual array contains `item`. */
    toContain(item: unknown): void;
  };
}

/**
 * One violation a suite found.
 *
 * @stability experimental
 */
export interface ConformanceFinding {
  /** The offending file, relative to the source root that holds it, with `/` separators. */
  file: string;
  /** What is wrong, phrased to complete "<file>: ". */
  message: string;
}

/**
 * What a suite saw and what it objects to.
 *
 * @stability experimental
 */
export interface ConformanceReport {
  /** Counts of what the scan saw, for vacuity guards (for example `cronFiles`). */
  scanned: Record<string, number>;
  /** The files behind each count, relative to their source root, for suites that assert a file was seen. */
  scannedFiles: Record<string, readonly string[]>;
  /** Every violation, in scan order. Empty means the app conforms. */
  findings: ConformanceFinding[];
}

/**
 * Where a suite scans.
 *
 * @stability experimental
 */
export interface ConformanceContext {
  /** Absolute directories holding the app's non-test TypeScript sources. */
  sourceRoots: readonly string[];
}

/**
 * One test a suite asks the harness to register.
 *
 * @stability experimental
 */
export interface ConformanceCase {
  /** The test title; stable, because dashboards and CI filters read it. */
  name: string;
  /**
   * Asserts against the (memoised) report of the suite's single scan. May be
   * async: a case that has to boot something (the telemetry suite boots the
   * slice's module) awaits it here, and the runner awaits the returned promise.
   */
  run(report: ConformanceReport, expect: ConformanceTestApi['expect']): void | Promise<void>;
}

/**
 * A runnable invariant. Register one in {@link conformanceSuites}; the harness
 * registers a `describe` block for it when the app enables it.
 *
 * @typeParam TOptions - what the app passes to configure the suite.
 *
 * @extensionPoint registry
 * @stability experimental
 */
export interface ConformanceSuite<TOptions> {
  /** Stable id, for example `'cron-enqueue-only'`. The app's option key is its camelCase form. */
  readonly id: string;
  /** The `describe` title; part of every generated test's full name. */
  readonly title: string;
  /** One sentence: the invariant this enforces. */
  readonly description: string;
  /**
   * Pure: scans and returns findings. Never throws for a finding; throws only
   * on misconfiguration (an unreadable root, an option that makes the check
   * vacuous).
   */
  check(context: ConformanceContext, options: TOptions): ConformanceReport;
  /** The tests to register, in order. Each receives the one report `check` produced. */
  cases(options: TOptions): ReadonlyArray<ConformanceCase>;
}

/**
 * A suite that registers its own test tree instead of scanning once and
 * asserting on a report. It exists for the invariants that have to boot the
 * app (the AI kill switch, the RBAC matrix, secret egress, key policy, jobs
 * server-only): they need runner lifecycle hooks (`beforeAll`, `afterAll`) and
 * the runner's full matcher set, so they register through the globals of the
 * runner they run under. Such a suite lives in a runner-specific entry (the
 * Jest-only `@marinoscar/platform-api/ai/testing`), never in `src/testing`.
 *
 * Register one in {@link conformanceSuites}; `runPlatformConformance` calls
 * `register` when the app enables it, and records it in the run summary like
 * any other suite.
 *
 * @typeParam TOptions - what the app passes to configure the suite.
 *
 * @extensionPoint registry
 * @stability experimental
 */
export interface ConformanceAppSuite<TOptions> {
  /** Stable id, for example `'ai-kill-switch'`. The app's option key is its camelCase form. */
  readonly id: string;
  /** The `describe` title; part of every generated test's full name. */
  readonly title: string;
  /** One sentence: the invariant this enforces. */
  readonly description: string;
  /**
   * Registers the suite's `describe` tree. Called once, at the top level of the
   * app's spec file. Throws only on misconfiguration (a missing option).
   */
  register(api: ConformanceTestApi, context: ConformanceContext, options: TOptions): void;
}

/**
 * An explicit, argued opt-out: `suites: { aiKillSwitch: { skip: 'reason' } }`.
 * The reason is required (an empty one throws) and is printed in the run
 * summary, so a skipped invariant stays visible in the test output.
 *
 * @extensionPoint option
 * @stability experimental
 */
export interface ConformanceSkip {
  /** Why this app does not run the suite; at least a few words, shown in the summary. */
  skip: string;
}
