import type {
  ConformanceAppSuite,
  ConformanceReport,
  ConformanceSkip,
  ConformanceSuite,
  ConformanceTestApi,
} from './conformance-suite';
import { conformanceSuites } from './conformance-suites';
import type { CronEnqueueOnlyOptions } from './suites/cron-enqueue-only';
import type { UserOwnedDataOptions } from './suites/user-owned-data';

/**
 * The suites {@link runPlatformConformance} can run, by option key: each
 * entry is the suite's options (the app passes them, or `{ skip: 'reason' }`
 * to opt out; see {@link PlatformConformanceOptions.suites}). An interface so a slice
 * that ships a suite adds its key by module augmentation (the telemetry slice's
 * `telemetry`, declared in `@marinoscar/platform-api/telemetry/testing`) and
 * the runner is not edited.
 *
 * @example
 * ```ts
 * declare module '@marinoscar/platform-api/testing' {
 *   interface PlatformConformanceSuiteOptions {
 *     myFeature?: MyFeatureOptions;
 *   }
 * }
 * ```
 *
 * @stability experimental
 */
export interface PlatformConformanceSuiteOptions {
  /** The `cron-enqueue-only` suite: its options, or `{ skip: 'reason' }` to opt out. */
  cronEnqueueOnly?: CronEnqueueOnlyOptions;
  /** The `user-owned-data` suite: its options, or `{ skip: 'reason' }` to opt out. */
  userOwnedData?: UserOwnedDataOptions;
}

/**
 * What an app passes to {@link runPlatformConformance}.
 *
 * @extensionPoint option
 * @stability experimental
 */
export interface PlatformConformanceOptions {
  /** Absolute directories holding the app's non-test TypeScript sources, for example `[join(__dirname, '../../src')]`. */
  sourceRoots: readonly string[];
  /**
   * One entry per suite. Pass the suite's options to run it, or
   * `{ skip: 'reason' }` to opt out: the reason is required (an empty one, or
   * `false`, throws) and is printed in the run summary, so the opt-out stays
   * visible. A suite left out does not run; an unknown key throws, so a typo
   * cannot disable a check. A suite that ships with a slice is registered by
   * importing that slice's testing entry (the telemetry suite:
   * `@marinoscar/platform-api/telemetry/testing`).
   */
  suites: {
    [K in keyof PlatformConformanceSuiteOptions]?: Exclude<PlatformConformanceSuiteOptions[K], false> | ConformanceSkip;
  };
  /** Defaults to the globals `describe`/`it`/`expect` (Jest, or Vitest with `globals: true`). */
  testApi?: ConformanceTestApi;
}

/** `cronEnqueueOnly` for `cron-enqueue-only`: how the app spells a suite id. */
function optionKeyOf(id: string): string {
  return id.replace(/-([a-z0-9])/g, (_match, char: string) => char.toUpperCase());
}

/** The runner's own globals, or a clear error when there are none. */
function globalTestApi(): ConformanceTestApi {
  const g = globalThis as unknown as Partial<ConformanceTestApi>;
  if (typeof g.describe !== 'function' || typeof g.it !== 'function' || typeof g.expect !== 'function') {
    throw new Error(
      'runPlatformConformance: no global describe/it/expect. Run it under Jest, under Vitest with `globals: true`, or pass `testApi`.',
    );
  }
  return { describe: g.describe, it: g.it, expect: g.expect };
}

/**
 * Registers one `describe` block per enabled conformance suite. Call it at the
 * top level of a spec file; the app keeps its own data (exemptions, minimums)
 * and the package owns the scan.
 *
 * @param options - see {@link PlatformConformanceOptions}.
 * @throws Error `unknown conformance suite` when `options.suites` names a suite that is not registered.
 * @throws Error when no test API is available, or `sourceRoots` is empty.
 *
 * @example
 * ```ts
 * // apps/api/test/conformance.spec.ts
 * runPlatformConformance({
 *   sourceRoots: [join(__dirname, '..', '..', 'src')],
 *   suites: { cronEnqueueOnly: { exempt: EXEMPT, minCronFiles: 8 } },
 * });
 * ```
 *
 * @extensionPoint option
 * @stability experimental
 */
export function runPlatformConformance(options: PlatformConformanceOptions): void {
  conformanceSuites.freeze();

  const byOptionKey = new Map(conformanceSuites.list().map((suite) => [optionKeyOf(suite.id), suite]));
  const requested = Object.entries(options.suites) as Array<[string, unknown]>;

  for (const [key] of requested) {
    if (!byOptionKey.has(key)) {
      throw new Error(
        `runPlatformConformance: unknown conformance suite "${key}". Known suites: ${[...byOptionKey.keys()].join(', ') || '(none)'}. ` +
          "A suite that ships with a slice registers when the slice's testing entry is imported (telemetry: '@marinoscar/platform-api/telemetry/testing').",
      );
    }
  }
  if (options.sourceRoots.length === 0) {
    throw new Error('runPlatformConformance: sourceRoots is empty, so there is nothing to scan.');
  }

  const api = options.testApi ?? globalTestApi();
  const summary: ConformanceSummaryEntry[] = [];

  for (const [key, suiteOptions] of requested) {
    const suite = byOptionKey.get(key)!;

    if (suiteOptions === undefined) continue;

    if (suiteOptions === false) {
      throw new Error(
        `runPlatformConformance: suite "${suite.id}" is switched off with \`false\`. An opt-out needs a reason: \`${key}: { skip: 'why this app does not run it' }\`.`,
      );
    }

    if (isSkip(suiteOptions)) {
      const reason = typeof suiteOptions.skip === 'string' ? suiteOptions.skip.trim() : '';
      if (reason === '') {
        throw new Error(
          `runPlatformConformance: suite "${suite.id}" is skipped without a reason. Pass \`${key}: { skip: 'why this app does not run it' }\`.`,
        );
      }
      summary.push({ id: suite.id, status: 'skipped', reason });
      api.describe(suite.title, () => {
        api.it(`${suite.id}: skipped by the app (${reason})`, () => undefined);
      });
      continue;
    }

    summary.push({ id: suite.id, status: 'run' });

    if (isAppSuite(suite)) {
      suite.register(api, { sourceRoots: options.sourceRoots }, suiteOptions);
      continue;
    }

    // One scan per suite, on first use: the scan runs inside the first test, so
    // a misconfiguration fails that test with its message instead of breaking
    // collection of the whole spec file.
    let report: ConformanceReport | undefined;
    const scan = (): ConformanceReport => {
      report ??= suite.check({ sourceRoots: options.sourceRoots }, suiteOptions);
      return report;
    };

    api.describe(suite.title, () => {
      for (const testCase of suite.cases(suiteOptions)) {
        api.it(testCase.name, () => testCase.run(scan(), api.expect));
      }
    });
  }

  if (summary.length > 0) {
    api.describe('platform conformance: suites run and skipped', () => {
      api.it('prints the summary table', () => {
        const table = formatConformanceSummary(summary);
        process.stdout.write(`\n${table}\n`);
        api.expect(table.split('\n').length).toBeGreaterThanOrEqual(summary.length + 2);
      });
    });
  }
}

/**
 * One row of the run summary.
 *
 * @stability experimental
 */
export interface ConformanceSummaryEntry {
  /** The suite id. */
  id: string;
  /** `run` when the app enabled it, `skipped` when it opted out with a reason. */
  status: 'run' | 'skipped';
  /** The app's reason, for a skipped suite. */
  reason?: string;
}

/**
 * The summary table `runPlatformConformance` prints: every suite the app
 * enabled or opted out of, and why it was skipped.
 *
 * @param entries - one per suite, in the order the app listed them.
 * @returns a plain-text table, one line per suite under a header.
 *
 * @stability experimental
 */
export function formatConformanceSummary(entries: readonly ConformanceSummaryEntry[]): string {
  const width = Math.max('suite'.length, ...entries.map((entry) => entry.id.length));
  const lines = entries.map(
    (entry) => `${entry.id.padEnd(width)}  ${entry.status === 'run' ? 'run' : `skipped: ${entry.reason ?? ''}`}`,
  );
  const ran = entries.filter((entry) => entry.status === 'run').length;
  return [`${'suite'.padEnd(width)}  status`, ...lines, `${ran} run, ${entries.length - ran} skipped`].join('\n');
}

/** An app suite registers its own tree; a scan suite has `check` and `cases`. */
function isAppSuite(suite: ConformanceSuite<unknown> | ConformanceAppSuite<unknown>): suite is ConformanceAppSuite<unknown> {
  return typeof (suite as ConformanceAppSuite<unknown>).register === 'function';
}

/** An opt-out is an object with a `skip` key (a suite's own options never name one). */
function isSkip(value: unknown): value is ConformanceSkip {
  return typeof value === 'object' && value !== null && 'skip' in value;
}
