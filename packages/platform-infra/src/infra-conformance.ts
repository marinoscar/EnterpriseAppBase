// =============================================================================
// Infra conformance: do the app's overlays and nginx include points work?
// =============================================================================
//
// `platform-infra sync --check` proves the GENERATED files are the package's.
// It cannot prove the app's own files work: an `app.*.compose.yml` overlay that
// does not merge, an `app.d/` location with a typo, a `csp/` file with a stray
// quote. Those fail on the production server, in the deploy, at the worst
// time. `runInfraConformance` is the app's test for them, run from its own
// test suite (Jest or Vitest, whichever it uses):
//
//   1. sync:    `checkInfra` finds no problem (the same check as
//               `platform-infra sync --check`);
//   2. compose: for each mode, `docker compose -f <platform files + the app's
//               overlays> config` succeeds, i.e. the overlays MERGE;
//   3. nginx:   `nginx -t` accepts the composed configuration with the app's
//               `app.d/` and both CSP files.
//
// Docker and nginx are tools, not dependencies: when one is absent the case
// is registered as a PASSING case whose name carries the reason
// ("compose config: skipped (docker is not available)") and a warning is
// printed, so a missing tool is visible in the run and never a silent green
// that looks like a check. An app opts out of a check on purpose with
// `skip: { compose: 'why' }`; a reason is required.
//
// Read-only: nothing here starts a container or writes into the app. The
// nginx check works in a scratch directory; compose runs `config` only.
// =============================================================================

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { composeFilesForMode, type ComposeMode } from './compose-order.js';
import { checkInfra } from './sync.js';

/**
 * The slice of a test runner the suite needs (Jest's and Vitest's both fit).
 *
 * @stability experimental
 */
export interface InfraConformanceTestApi {
  /** Groups cases. */
  describe(name: string, body: () => void): void;
  /** One case. */
  it(name: string, body: () => unknown): void;
  /** The assertion entry point. */
  expect(actual: unknown): { toEqual(expected: unknown): void };
}

/**
 * Runs a program and reports how it ended. The test seam of the suite.
 *
 * @stability experimental
 */
export type InfraExec = (
  command: string,
  args: readonly string[],
  options: { cwd?: string; env?: Record<string, string> },
) => { status: number | null; output: string };

/**
 * Options of {@link runInfraConformance}.
 *
 * @stability experimental
 */
export interface InfraConformanceOptions {
  /** The app's repository root (the directory holding `infra/`). */
  appRoot: string;
  /**
   * The compose modes to render. Default `dev`, `devdb`, `prod`, `vps` and
   * `test`, each with the telemetry files except `test`. `worker` is left out
   * by default: it needs the app's identity-prefixed variables (pass `env`).
   */
  modes?: readonly ComposeMode[];
  /** Variables for `docker compose config`, over the dummy values for the platform's required ones. */
  env?: Readonly<Record<string, string>>;
  /** An opt-out per check, with the reason (required, non-empty). */
  skip?: { sync?: string; compose?: string; nginx?: string };
  /** Defaults to the globals `describe`/`it`/`expect`. */
  testApi?: InfraConformanceTestApi;
  /** Runs a program. Defaults to `spawnSync`; tests inject a fake. */
  exec?: InfraExec;
}

/** The variables the platform's compose files refuse to render without (`${VAR:?…}`), with throwaway values. */
const DUMMY_REQUIRED_ENV: Readonly<Record<string, string>> = Object.freeze({
  STACK_AGENT_TOKEN: 'conformance-token',
  DEPLOY_ROOT: '/srv/conformance',
  GREPTIME_WRITER_PASSWORD: 'conformance-writer',
  GREPTIME_READER_PASSWORD: 'conformance-reader',
  GREPTIME_ADMIN_PASSWORD: 'conformance-admin',
});

const DEFAULT_MODES: readonly ComposeMode[] = ['dev', 'devdb', 'prod', 'vps', 'test'];

const defaultExec: InfraExec = (command, args, options) => {
  const result = spawnSync(command, [...args], {
    cwd: options.cwd,
    encoding: 'utf8',
    env: options.env ?? { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? tmpdir() },
  });
  return { status: result.error === undefined ? result.status : null, output: `${result.stdout ?? ''}${result.stderr ?? ''}${result.error?.message ?? ''}` };
};

function globalTestApi(): InfraConformanceTestApi {
  const g = globalThis as unknown as Partial<InfraConformanceTestApi>;
  if (typeof g.describe !== 'function' || typeof g.it !== 'function' || typeof g.expect !== 'function') {
    throw new Error('runInfraConformance: no global describe/it/expect. Pass `testApi` (e.g. { describe, it, expect } from vitest).');
  }
  return { describe: g.describe, it: g.it, expect: g.expect };
}

function reasonOf(check: string, value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`runInfraConformance: skip.${check} needs a reason (a non-empty string saying why this app does not run it).`);
  }
  return value.trim();
}

/** Copies a directory, rewriting every text file with `rewrite`. */
function copyRewritten(from: string, to: string, rewrite: (text: string) => string): void {
  mkdirSync(to, { recursive: true });
  for (const name of readdirSync(from)) {
    const source = join(from, name);
    const target = join(to, name);
    if (statSync(source).isDirectory()) copyRewritten(source, target, rewrite);
    else writeFileSync(target, rewrite(readFileSync(source, 'utf8')));
  }
}

/**
 * Lays out `/etc/nginx` the way base.compose.yml mounts it into a scratch
 * directory a local, unprivileged nginx can read, with `csp` as csp.conf.
 */
function nginxScratch(appRoot: string, csp: string): string {
  const source = join(appRoot, 'infra', 'nginx');
  const dir = mkdtempSync(join(tmpdir(), 'platform-infra-conformance-'));
  const rewrite = (text: string): string =>
    text
      .replaceAll('/etc/nginx/', `${dir}/etc/`)
      .replace(/server api:3000;/, 'server 127.0.0.1:3000;')
      .replace(/server web:5173;/, 'server 127.0.0.1:5173;')
      .replace(/^pid .*;$/m, `pid ${dir}/nginx.pid;`)
      .replace(/^error_log \S+/m, `error_log ${dir}/error.log`)
      .replace(/access_log \/var\/log\/nginx\/access\.log main;/, `access_log ${dir}/access.log main;`)
      .replace(
        /^http \{$/m,
        `http {\n    client_body_temp_path ${dir}/tmp/body;\n    proxy_temp_path ${dir}/tmp/proxy;\n` +
          `    fastcgi_temp_path ${dir}/tmp/fastcgi;\n    uwsgi_temp_path ${dir}/tmp/uwsgi;\n    scgi_temp_path ${dir}/tmp/scgi;`,
      );
  const etc = join(dir, 'etc');
  mkdirSync(join(dir, 'tmp'), { recursive: true });
  mkdirSync(etc, { recursive: true });
  writeFileSync(join(etc, 'nginx.conf'), rewrite(readFileSync(join(source, 'nginx.conf'), 'utf8')));
  writeFileSync(join(etc, 'csp.conf'), rewrite(readFileSync(join(source, csp), 'utf8')));
  copyRewritten(join(source, 'platform'), join(etc, 'platform'), rewrite);
  copyRewritten(join(source, 'app.d'), join(etc, 'app.d'), rewrite);
  if (existsSync('/etc/nginx/mime.types')) cpSync('/etc/nginx/mime.types', join(etc, 'mime.types'));
  else writeFileSync(join(etc, 'mime.types'), 'types { text/html html; }\n');
  return dir;
}

/** The pinned nginx image base.compose.yml names, for the docker route. */
function pinnedNginxImage(appRoot: string): string | undefined {
  try {
    return /^\s*image:\s*(nginx:\S+)\s*$/m.exec(readFileSync(join(appRoot, 'infra', 'compose', 'base.compose.yml'), 'utf8'))?.[1];
  } catch {
    return undefined;
  }
}

/** How `nginx -t` can run here, or why it cannot. */
function nginxRoute(exec: InfraExec, appRoot: string): { kind: 'local' } | { kind: 'docker'; image: string } | { kind: 'none'; reason: string } {
  if (exec('nginx', ['-v'], {}).status === 0) return { kind: 'local' };
  const image = pinnedNginxImage(appRoot);
  if (image !== undefined && exec('docker', ['info'], {}).status === 0) return { kind: 'docker', image };
  return { kind: 'none', reason: 'neither an nginx binary nor a running docker daemon is available' };
}

/**
 * Registers the infra conformance cases for an app. Call it at the top level
 * of a test file.
 *
 * @param options - The app root and, optionally, the modes, env, opt-outs and test API.
 * @throws Error when `appRoot` has no `infra/` folder, an opt-out has no reason, or no test API is available.
 * @stability experimental
 * @extensionPoint option
 * @example
 * ```ts
 * import { runInfraConformance } from '@marinoscar/platform-infra/testing';
 * import { describe, expect, it } from 'vitest';
 *
 * runInfraConformance({ appRoot: join(__dirname, '..', '..', '..'), testApi: { describe, it, expect } });
 * ```
 */
export function runInfraConformance(options: InfraConformanceOptions): void {
  const { appRoot } = options;
  if (!existsSync(join(appRoot, 'infra'))) {
    throw new Error(`runInfraConformance: ${appRoot} has no infra/ folder. Pass the app's repository root as appRoot.`);
  }
  const skipSync = reasonOf('sync', options.skip?.sync);
  const skipCompose = reasonOf('compose', options.skip?.compose);
  const skipNginx = reasonOf('nginx', options.skip?.nginx);
  const api = options.testApi ?? globalTestApi();
  const exec = options.exec ?? defaultExec;
  const note = (message: string): void => {
    if (options.testApi === undefined) console.warn(`[platform-infra] ${message}`);
  };

  api.describe('infra conformance', () => {
    // 1. The generated files are the package's.
    if (skipSync !== undefined) {
      api.it(`sync --check: skipped by the app (${skipSync})`, () => undefined);
    } else {
      api.it('sync --check: the generated files match the package and the lock', () => {
        const { problems } = checkInfra({ root: appRoot });
        api.expect(problems.map((problem) => `${problem.file}: ${problem.message}`)).toEqual([]);
      });
    }

    // 2. The app's compose overlays merge into every mode.
    const composeDir = join(appRoot, 'infra', 'compose');
    if (skipCompose !== undefined) {
      api.it(`compose config: skipped by the app (${skipCompose})`, () => undefined);
    } else if (exec('docker', ['compose', 'version'], {}).status !== 0) {
      const reason = 'docker compose is not available';
      note(`compose config is SKIPPED here: ${reason}. CI runs it.`);
      api.it(`compose config: skipped (${reason})`, () => undefined);
    } else {
      const listing = readdirSync(composeDir);
      for (const mode of options.modes ?? DEFAULT_MODES) {
        const files = composeFilesForMode(mode, { telemetry: mode !== 'test' && mode !== 'worker', overlays: listing });
        api.it(`compose config: ${mode} (${files.length} files, the app's overlays last) renders`, () => {
          const result = exec('docker', ['compose', ...files.flatMap((file) => ['-f', file]), 'config', '-q'], {
            cwd: composeDir,
            env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? tmpdir(), ...DUMMY_REQUIRED_ENV, ...options.env },
          });
          api.expect(result.status === 0 ? '' : `docker compose ${files.join(' ')} config failed:\n${result.output}`).toEqual('');
        });
      }
    }

    // 3. nginx accepts the composed configuration, app.d/ included.
    if (skipNginx !== undefined) {
      api.it(`nginx -t: skipped by the app (${skipNginx})`, () => undefined);
    } else if (!existsSync(join(appRoot, 'infra', 'nginx', 'nginx.conf'))) {
      api.it('nginx -t: skipped (the app has no infra/nginx/nginx.conf)', () => undefined);
    } else {
      const route = nginxRoute(exec, appRoot);
      if (route.kind === 'none') {
        note(`nginx -t is SKIPPED here: ${route.reason}. CI runs it.`);
        api.it(`nginx -t: skipped (${route.reason})`, () => undefined);
      } else {
        for (const csp of ['csp.conf', 'csp.dev.conf']) {
          api.it(`nginx -t: nginx.conf with ${csp} and the app's app.d/ is valid`, () => {
            if (route.kind === 'docker') {
              const nginx = join(appRoot, 'infra', 'nginx');
              const result = exec(
                'docker',
                [
                  'run', '--rm', '--add-host', 'api:127.0.0.1', '--add-host', 'web:127.0.0.1',
                  '-v', `${join(nginx, 'nginx.conf')}:/etc/nginx/nginx.conf:ro`,
                  '-v', `${join(nginx, csp)}:/etc/nginx/csp.conf:ro`,
                  '-v', `${join(nginx, 'platform')}:/etc/nginx/platform:ro`,
                  '-v', `${join(nginx, 'app.d')}:/etc/nginx/app.d:ro`,
                  route.image, 'nginx', '-t',
                ],
                {},
              );
              api.expect(result.status === 0 ? '' : `nginx -t failed in ${route.image}:\n${result.output}`).toEqual('');
              return;
            }
            const dir = nginxScratch(appRoot, csp);
            try {
              const result = exec('nginx', ['-t', '-p', dir, '-e', join(dir, 'error.log'), '-c', join(dir, 'etc', 'nginx.conf')], {});
              api.expect(result.status === 0 ? '' : `nginx -t failed:\n${result.output}`).toEqual('');
            } finally {
              rmSync(dir, { recursive: true, force: true });
            }
          });
        }
      }
    }
  });
}
