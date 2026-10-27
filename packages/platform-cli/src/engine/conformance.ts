import {
  createCliRegistry,
  getEnvGroup,
  listEnvGenerators,
  listEnvSpecFragments,
  type CliRegistry,
} from '../core/index.js';

import { ensurePlatformRegistrations } from './builtin-registrations.js';
import { commentedAssignments } from './deploy/env-fragments.js';
import { edgeConfigFiles } from './deploy/edge-config.js';
import { proxyRuntimeFor, renderVhost } from './deploy/proxy.js';
import { planDeploySteps } from './deploy/steps/plan.js';
import {
  checkExecutorCredentialHygiene,
  type CredentialHygieneOptions,
} from './node/executors/credential-hygiene.js';
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
// THE SUITES ARE A REGISTRY (PP-14.22). `cliConformanceSuites` mirrors the API's
// `conformanceSuites` (`platform-api/src/testing/conformance-suites.ts`): a
// suite is registered once, by id, and the runner is not edited. An app (or a
// package) registers its own with `registerCliConformanceSuite`. Every suite
// an app names must either get its options or `{ skip: 'reason' }`: the reason
// is required (an empty one, or `false`, throws) and is printed in the run
// summary, so an opt-out stays visible. A suite left out does not run.
//
// The `cli` suite:
//
//   - every env template fragment declares no commented `# KEY=value` line
//     (beyond the keys it documents on purpose): `parseEnvExample` would
//     read one as a variable and the deploy wizard would ask for it;
//   - every executor the worker would run passes
//     `checkExecutorCredentialHygiene` on a fake job holding a credential
//     (CLAUDE.md queue rule 3: a node never persists a job-scoped credential).
//
// The `deployRegistrations` suite (`deploy-registrations`): the app's deploy
// extension points are consistent -- every env key's group is registered, both
// deploy plans resolve, the edge-config list has no duplicate, and the VPS
// vhost renders with the app's stream paths (so a bad path fails the test, not
// a production deploy).
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
  expect(actual: unknown): ConformanceMatchers;
}

/**
 * The one matcher the suites use.
 *
 * @stability experimental
 */
export interface ConformanceMatchers {
  /**
   * Deep equality.
   *
   * @param expected - The expected value.
   */
  toEqual(expected: unknown): void;
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
 * An opt-out of one suite. The reason is required and appears in the summary.
 *
 * @stability experimental
 */
export interface CliConformanceSkip {
  /** Why this app does not run the suite. */
  skip: string;
}

/**
 * Options of the `deployRegistrations` suite.
 *
 * @stability experimental
 */
export interface DeployRegistrationsConformanceOptions {
  /** The hostname the sample vhost is rendered for. Default `app.example.test`. */
  domain?: string | undefined;
}

/**
 * The suites of the CLI's {@link runPlatformConformance}, by option key (the
 * suite id in camelCase). Augment this interface to type the options of a
 * suite you register:
 *
 * ```ts
 * declare module '@marinoscar/platform-cli/testing' {
 *   interface CliPlatformConformanceSuites { myCheck?: MyCheckOptions | CliConformanceSkip }
 * }
 * ```
 *
 * @stability experimental
 */
export interface CliPlatformConformanceSuites {
  /** The `cli` suite: env template fragments and executor credential hygiene. */
  cli?: CliConformanceOptions | CliConformanceSkip | undefined;
  /** The `deploy-registrations` suite: the app's deploy extension points are consistent. */
  deployRegistrations?: DeployRegistrationsConformanceOptions | CliConformanceSkip | undefined;
}

/**
 * What an app passes to {@link runPlatformConformance}.
 *
 * @stability experimental
 */
export interface CliPlatformConformanceOptions {
  /**
   * One entry per suite: its options to run it, or `{ skip: 'reason' }` to opt
   * out (the reason is required; `false` throws). A suite left out does not
   * run; an unknown key throws, so a typo cannot disable a check.
   */
  suites: CliPlatformConformanceSuites;
  /** Defaults to the globals `describe`/`it`/`expect`. */
  testApi?: ConformanceTestApi | undefined;
  /**
   * Where the summary table of suites run and skipped goes. Default: standard
   * output, unless `testApi` is injected (then nothing is printed).
   */
  summaryOutput?: ((table: string) => void) | undefined;
}

/**
 * One CLI conformance suite: an invariant the package checks over the app.
 *
 * @typeParam TOptions - what the app passes to configure it.
 * @stability experimental
 */
export interface CliConformanceSuite<TOptions = unknown> {
  /** Stable kebab-case id, e.g. `cli`. The app's option key is its camelCase form. */
  readonly id: string;
  /** The `describe` title; part of every generated test's full name. */
  readonly title: string;
  /** One sentence: the invariant this enforces. */
  readonly description: string;
  /** Registers the suite's tests with the test API. Receives the options the app passed. */
  register(api: ConformanceTestApi, options: TOptions): void;
}

/**
 * Every CLI conformance suite, keyed by id. Built-ins register at import time
 * through {@link registerCliConformanceSuite}; the runner freezes it on its
 * first run.
 *
 * @stability experimental
 * @extensionPoint registry
 */
export const cliConformanceSuites: CliRegistry<CliConformanceSuite<never>> = createCliRegistry<
  CliConformanceSuite<never>
>({
  name: 'CLI conformance suite',
  registerFn: 'registerCliConformanceSuite',
  idOf: (suite) => suite.id,
  validate: (suite) => {
    if (typeof suite?.id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(suite.id)) {
      throw new Error(
        `CLI conformance suite id ${JSON.stringify(suite?.id)} is invalid: use lowercase letters, digits and hyphens.`
      );
    }
    if (
      typeof suite.title !== 'string' ||
      suite.title.trim() === '' ||
      typeof suite.register !== 'function'
    ) {
      throw new Error(`CLI conformance suite "${suite.id}" needs a title and a register function.`);
    }
  },
});

/**
 * Adds a suite to the CLI's conformance runner.
 *
 * @param suite - The suite: id, title, description and `register`.
 * @throws Error on a malformed or duplicate id, or once the runner has run.
 * @stability experimental
 * @extensionPoint registry
 * @example
 * ```ts
 * registerCliConformanceSuite({
 *   id: 'coach-commands',
 *   title: 'coach commands',
 *   description: 'Every coach command has a description.',
 *   register: (api) => api.describe('coach commands', () => api.it('describes itself', () => undefined)),
 * });
 * ```
 */
export function registerCliConformanceSuite<TOptions>(suite: CliConformanceSuite<TOptions>): void {
  cliConformanceSuites.register(suite as CliConformanceSuite<never>);
}

/** `deployRegistrations` for `deploy-registrations`: how the app spells a suite id. */
function optionKeyOf(id: string): string {
  return id.replace(/-([a-z0-9])/g, (_match, char: string) => char.toUpperCase());
}

function isSkip(value: unknown): value is CliConformanceSkip {
  return typeof value === 'object' && value !== null && 'skip' in value;
}

function globalTestApi(): ConformanceTestApi {
  const g = globalThis as unknown as Partial<ConformanceTestApi>;
  if (
    typeof g.describe !== 'function' ||
    typeof g.it !== 'function' ||
    typeof g.expect !== 'function'
  ) {
    throw new Error(
      'runPlatformConformance: no global describe/it/expect. Pass `testApi` (e.g. { describe, it, expect } from vitest).'
    );
  }
  return { describe: g.describe, it: g.it, expect: g.expect };
}

function allExecutors(): JobExecutor[] {
  const registry = defaultExecutorRegistry();
  return registry.types().map((type) => registry.require(type));
}

// ---------------------------------------------------------------------------
// The built-in suites, registered through the same function an app uses.
// ---------------------------------------------------------------------------

const BUILTIN_SUITES: ReadonlyArray<CliConformanceSuite<never>> = [
  {
    id: 'cli',
    title: 'cli conformance',
    description:
      'Env template fragments declare no commented KEY=value line; executors never persist a job-scoped credential.',
    register(api, cli) {
      api.describe('cli conformance', () => {
        for (const fragment of cli.envFragments) {
          api.it(`env fragment ${fragment.name} declares no commented KEY=value line`, () => {
            api
              .expect(commentedAssignments(fragment.text, fragment.allowCommented ?? []))
              .toEqual([]);
          });
        }
        for (const executor of cli.executors ?? allExecutors()) {
          api.it(
            `executor ${executor.type} never persists or logs a job-scoped credential`,
            async () => {
              const report = await checkExecutorCredentialHygiene(
                executor,
                cli.executorOptions?.[executor.type]
              );
              api.expect(report.findings).toEqual([]);
            }
          );
        }
      });
    },
  } as CliConformanceSuite<CliConformanceOptions>,
  {
    id: 'deploy-registrations',
    title: 'deploy registrations conformance',
    description:
      "The app's env groups, deploy steps, edge-config files and proxy stream paths are consistent.",
    register(api, options) {
      api.describe('deploy registrations conformance', () => {
        api.it('every env key names a registered group', () => {
          ensurePlatformRegistrations();
          const unknown: string[] = [];
          for (const fragment of listEnvSpecFragments()) {
            for (const [key, metadata] of Object.entries(fragment.metadata)) {
              if (metadata.group !== undefined && getEnvGroup(metadata.group) === undefined)
                unknown.push(`${key} (${metadata.group})`);
            }
          }
          api.expect(unknown).toEqual([]);
        });
        api.it('every env key generates with a registered kind', () => {
        ensurePlatformRegistrations();
        const known = listEnvGenerators().map((generator) => generator.kind);
        const unknown: string[] = [];
        for (const fragment of listEnvSpecFragments()) {
          for (const [key, metadata] of Object.entries(fragment.metadata)) {
            if (metadata.generate !== undefined && !known.includes(metadata.generate)) unknown.push(`${key} (${metadata.generate})`);
          }
        }
        api.expect(unknown).toEqual([]);
      });
      for (const pipeline of ['install', 'update'] as const) {
          api.it(`the ${pipeline} plan resolves with the app's steps in place`, () => {
            api.expect(planDeploySteps(pipeline).length > 0).toEqual(true);
          });
        }
        api.it('no two edge-config files share a container path', () => {
          const paths = edgeConfigFiles().map((file) => file.container);
          api.expect(paths.filter((path, index) => paths.indexOf(path) !== index)).toEqual([]);
        });
        api.it('the VPS vhost renders with the app stream paths', () => {
          const vhost = renderVhost(
            {
              domain: options.domain ?? 'app.example.test',
              bindPort: 3535,
              proxyRoot: '/opt/infra/proxy',
            },
            proxyRuntimeFor('container', '/opt/infra/proxy')
          );
          api.expect(vhost.includes('proxy_pass')).toEqual(true);
        });
      });
    },
  } as CliConformanceSuite<DeployRegistrationsConformanceOptions>,
];

for (const suite of BUILTIN_SUITES) cliConformanceSuites.register(suite);

/**
 * Restores the registry to its built-ins and unfreezes it. Tests only.
 *
 * @internal
 */
export function resetCliConformanceSuitesForTests(): void {
  cliConformanceSuites.reset();
  for (const suite of BUILTIN_SUITES) cliConformanceSuites.register(suite);
}

/**
 * Registers one `describe` block per enabled CLI conformance suite. Call it at
 * the top level of a test file.
 *
 * @param options - The suites to run (or skip, with a reason), and the test API.
 * @throws Error when `suites` names an unknown suite, a suite is switched off
 *   with `false` or skipped without a reason, or no test API is available.
 * @stability experimental
 * @extensionPoint option
 * @example
 * ```ts
 * runPlatformConformance({
 *   suites: {
 *     cli: { envFragments: [{ name: 'app.env.example', text: readFileSync(path, 'utf8') }] },
 *     deployRegistrations: { skip: 'the app has no VPS deployment' },
 *   },
 *   testApi: { describe, it, expect },
 * });
 * ```
 */
export function runPlatformConformance(options: CliPlatformConformanceOptions): void {
  cliConformanceSuites.freeze('runPlatformConformance');
  const byKey = new Map(cliConformanceSuites.list().map((suite) => [optionKeyOf(suite.id), suite]));
  const requested = Object.entries(options.suites) as Array<[string, unknown]>;
  for (const [key] of requested) {
    if (!byKey.has(key)) {
      throw new Error(
        `runPlatformConformance: unknown CLI conformance suite "${key}". Known suites: ${[...byKey.keys()].join(', ')}.`
      );
    }
  }
  const api = options.testApi ?? globalTestApi();
  const summary: Array<{ id: string; status: 'run' | 'skipped'; reason?: string }> = [];

  for (const [key, suiteOptions] of requested) {
    const suite = byKey.get(key) as CliConformanceSuite<unknown>;
    if (suiteOptions === undefined) continue;
    if (suiteOptions === false) {
      throw new Error(
        `runPlatformConformance: suite "${suite.id}" is switched off with \`false\`. An opt-out needs a reason: \`${key}: { skip: 'why this app does not run it' }\`.`
      );
    }
    if (isSkip(suiteOptions)) {
      const reason = typeof suiteOptions.skip === 'string' ? suiteOptions.skip.trim() : '';
      if (reason === '') {
        throw new Error(
          `runPlatformConformance: suite "${suite.id}" is skipped without a reason. Pass \`${key}: { skip: 'why this app does not run it' }\`.`
        );
      }
      summary.push({ id: suite.id, status: 'skipped', reason });
      api.describe(suite.title, () => {
        api.it(`${suite.id}: skipped by the app (${reason})`, () => undefined);
      });
      continue;
    }
    summary.push({ id: suite.id, status: 'run' });
    suite.register(api, suiteOptions);
  }

  if (summary.length > 0) {
    const width = Math.max('suite'.length, ...summary.map((entry) => entry.id.length));
    const lines = summary.map(
      (entry) =>
        `${entry.id.padEnd(width)}  ${entry.status === 'run' ? 'run' : `skipped: ${entry.reason ?? ''}`}`
    );
    const ran = summary.filter((entry) => entry.status === 'run').length;
    const table = [
      `${'suite'.padEnd(width)}  status`,
      ...lines,
      `${ran} run, ${summary.length - ran} skipped`,
    ].join('\n');
    if (options.summaryOutput !== undefined) options.summaryOutput(table);
    else if (options.testApi === undefined) process.stdout.write(`\n${table}\n`);
  }
}
