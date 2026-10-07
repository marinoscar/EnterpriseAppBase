import { commentedAssignments } from './deploy/env-fragments.js';
import { checkExecutorCredentialHygiene, type CredentialHygieneOptions } from './node/executors/credential-hygiene.js';
import type { JobExecutor } from './node/executors/index.js';
import { defaultExecutorRegistry } from './node/executors/registry.js';

// =============================================================================
// The CLI's conformance suites  (PP-8.9, #715)
// =============================================================================
//
// The same shape as `@marinoscar/platform-api/testing`'s
// `runPlatformConformance`: the app calls it at the top level of a test file,
// passes its own data, and the package owns the checks. It is a separate
// runner because the API's is CommonJS under Jest and this package is ESM
// under Vitest; one cannot load the other.
//
// The `cli` suite:
//
//   - every env template fragment declares no commented `# KEY=value` line
//     (beyond the keys it documents on purpose): `parseEnvExample` would
//     read one as a variable and the deploy wizard would ask for it;
//   - every executor the worker would run passes
//     `checkExecutorCredentialHygiene` on a fake job holding a credential
//     (CLAUDE.md queue rule 3: a node never persists a job-scoped credential).
// =============================================================================

/**
 * The test functions a suite registers with: Vitest's or Jest's.
 *
 * @stability experimental
 */
export interface ConformanceTestApi {
  /** Groups cases. */
  describe(name: string, body: () => void): void;
  /** One case. */
  it(name: string, body: () => unknown): void;
  /** An assertion, as Vitest and Jest spell it. */
  expect(actual: unknown): { toEqual(expected: unknown): void };
}

/**
 * One env template fragment to check.
 *
 * @stability experimental
 */
export interface EnvTemplateFragment {
  /** Shown in the case name, e.g. `infra/compose/app.env.example`. */
  name: string;
  /** The fragment's text. */
  text: string;
  /** Commented keys this fragment documents on purpose (only the platform base has any). */
  allowCommented?: readonly string[] | undefined;
}

/**
 * Options of the `cli` suite.
 *
 * @stability experimental
 */
export interface CliConformanceOptions {
  /** The env template fragments: the platform base, any slice's, and the app's. */
  envFragments: readonly EnvTemplateFragment[];
  /**
   * The executors to check. Defaults to every executor the worker engine
   * would run: the built-ins plus every `registerNodeExecutor` one (so call
   * `createCli` first).
   */
  executors?: readonly JobExecutor[] | undefined;
  /** Per job type, how to run its fake job (params, the credential's shape). */
  executorOptions?: Readonly<Record<string, CredentialHygieneOptions>> | undefined;
}

/**
 * The suites of the CLI's {@link runPlatformConformance}, by key.
 *
 * @stability experimental
 */
export interface CliPlatformConformanceSuites {
  /** The `cli` suite, or `false` to opt out (visibly). */
  cli?: CliConformanceOptions | false | undefined;
}

/**
 * What an app passes to {@link runPlatformConformance}.
 *
 * @stability experimental
 */
export interface CliPlatformConformanceOptions {
  /** One entry per suite. An unknown key throws, so a typo cannot disable a check. */
  suites: CliPlatformConformanceSuites;
  /** Defaults to the globals `describe`/`it`/`expect`. */
  testApi?: ConformanceTestApi | undefined;
}

function globalTestApi(): ConformanceTestApi {
  const g = globalThis as unknown as Partial<ConformanceTestApi>;
  if (typeof g.describe !== 'function' || typeof g.it !== 'function' || typeof g.expect !== 'function') {
    throw new Error('runPlatformConformance: no global describe/it/expect. Pass `testApi` (e.g. { describe, it, expect } from vitest).');
  }
  return { describe: g.describe, it: g.it, expect: g.expect };
}

function allExecutors(): JobExecutor[] {
  const registry = defaultExecutorRegistry();
  return registry.types().map((type) => registry.require(type));
}

/**
 * Registers one `describe` block per enabled CLI conformance suite. Call it at
 * the top level of a test file.
 *
 * @param options - The suites to run, and the test API.
 * @throws Error when `suites` names an unknown suite, or no test API is available.
 * @stability experimental
 * @extensionPoint option
 * @example
 * ```ts
 * runPlatformConformance({
 *   suites: { cli: { envFragments: [{ name: 'app.env.example', text: readFileSync(path, 'utf8') }] } },
 *   testApi: { describe, it, expect },
 * });
 * ```
 */
export function runPlatformConformance(options: CliPlatformConformanceOptions): void {
  for (const key of Object.keys(options.suites)) {
    if (key !== 'cli') {
      throw new Error(`runPlatformConformance: unknown CLI conformance suite "${key}". Known suites: cli.`);
    }
  }
  const api = options.testApi ?? globalTestApi();
  const cli = options.suites.cli;
  if (cli === undefined) return;
  if (cli === false) {
    api.describe('cli conformance', () => api.it('cli: disabled by the app', () => undefined));
    return;
  }

  api.describe('cli conformance', () => {
    for (const fragment of cli.envFragments) {
      api.it(`env fragment ${fragment.name} declares no commented KEY=value line`, () => {
        api.expect(commentedAssignments(fragment.text, fragment.allowCommented ?? [])).toEqual([]);
      });
    }
    for (const executor of cli.executors ?? allExecutors()) {
      api.it(`executor ${executor.type} never persists or logs a job-scoped credential`, async () => {
        const report = await checkExecutorCredentialHygiene(executor, cli.executorOptions?.[executor.type]);
        api.expect(report.findings).toEqual([]);
      });
    }
  });
}
