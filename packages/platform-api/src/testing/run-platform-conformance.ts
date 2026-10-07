import type { ConformanceReport, ConformanceTestApi } from './conformance-suite';
import { conformanceSuites } from './conformance-suites';
import type { CronEnqueueOnlyOptions } from './suites/cron-enqueue-only';
import type { UserOwnedDataOptions } from './suites/user-owned-data';

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
   * One entry per suite. Pass the suite's options to run it, or `false` to
   * opt out (the opt-out stays visible in the test output). A suite left out
   * does not run; an unknown key throws, so a typo cannot disable a check.
   */
  suites: {
    /** The `cron-enqueue-only` suite: its options, or `false` to opt out. */
    cronEnqueueOnly?: CronEnqueueOnlyOptions | false;
    /** The `user-owned-data` suite: its options, or `false` to opt out. */
    userOwnedData?: UserOwnedDataOptions | false;
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
 * // apps/api/test/jobs/cron-enqueue-only.spec.ts
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
        `runPlatformConformance: unknown conformance suite "${key}". Known suites: ${[...byOptionKey.keys()].join(', ') || '(none)'}.`,
      );
    }
  }
  if (options.sourceRoots.length === 0) {
    throw new Error('runPlatformConformance: sourceRoots is empty, so there is nothing to scan.');
  }

  const api = options.testApi ?? globalTestApi();

  for (const [key, suiteOptions] of requested) {
    const suite = byOptionKey.get(key)!;

    if (suiteOptions === undefined) continue;

    if (suiteOptions === false) {
      api.describe(suite.title, () => {
        api.it(`${suite.id}: disabled by the app`, () => undefined);
      });
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
}
