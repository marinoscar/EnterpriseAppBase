// =============================================================================
// The reference app's compose stacks, rendered by `docker compose config`
// =============================================================================
//
// Proves that moving the compose files into @marinoscar/platform-infra (and
// materialising them back into infra/compose/ with `platform-infra sync`)
// changes nothing a deployment runs: each mode's merged project is compared
// with the snapshot of the files as they were before the move
// (test/snapshots/compose/<mode>.json, written from the pre-move files and
// never regenerated). The one intended difference is the two nginx include
// point mounts (`platform/`, `app.d/`), which are asserted on their own and
// removed before the comparison. The overlay fixtures (kvox's memory limits
// and stack-agent opt-out) are rendered over the same files. `docker compose config` needs the
// Compose CLI but no daemon, so this runs wherever Compose is installed; the
// GitHub runners have it, so CI always runs it. Without Compose the suite is
// skipped with a message saying so.
//
// REFRESHING THE BASELINE. When main changes a platform compose file, port the
// change into the package, sync, then rewrite the snapshots FROM THE PRE-MOVE
// FILES of that main, never from the generated ones:
//
//   git archive <main> infra/compose | tar -x -C /tmp/baseline
//   PLATFORM_INFRA_BASELINE_COMPOSE_DIR=/tmp/baseline/infra/compose \
//     npx vitest run src/reference-compose.test.ts -t "renders exactly" -u
//
// and run the suite again without the variable: the generated files must
// render to the same snapshots.
//
// The files are copied into a scratch `infra/compose/` first, so a developer's
// own `.env` (which `env_file:` would inline) never reaches the snapshot, and
// the scratch root is replaced by `<ROOT>` so the snapshot is portable.
// =============================================================================

import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { appComposeOverlays, composeFilesForMode } from './compose-order.js';

const PACKAGE_ROOT = fileURLToPath(new URL('../', import.meta.url));
const REPO_ROOT = join(PACKAGE_ROOT, '..', '..');
const SNAPSHOTS = join(PACKAGE_ROOT, 'test', 'snapshots', 'compose');
const OVERLAY_FIXTURES = join(PACKAGE_ROOT, 'test', 'fixtures', 'overlays', 'kvox', 'compose');

/** The CLI name of the reference app: the single `bin` key of apps/cli/package.json. */
function referenceCliName(): string {
  const manifest = JSON.parse(readFileSync(join(REPO_ROOT, 'apps', 'cli', 'package.json'), 'utf8')) as {
    bin: Record<string, string>;
  };
  const [name] = Object.keys(manifest.bin);
  if (name === undefined) throw new Error('apps/cli/package.json has no bin');
  return name;
}

const ENV_PREFIX = `${referenceCliName().toUpperCase().replace(/[^A-Z0-9]/g, '_')}_`;

/**
 * The file list of each mode, as the documented commands and the deploy
 * (`composeFilesFor()`) spelled them before the move. Spelled out on purpose:
 * this is the baseline `composeFilesForMode()` is compared with.
 */
const BASELINE_MODES: Record<string, readonly string[]> = {
  dev: ['base.compose.yml', 'dev.compose.yml'],
  devdb: ['base.compose.yml', 'dev.compose.yml', 'devdb.compose.yml'],
  'dev-telemetry': ['base.compose.yml', 'dev.compose.yml', 'telemetry.compose.yml'],
  prod: ['base.compose.yml', 'prod.compose.yml'],
  vps: ['base.compose.yml', 'prod.compose.yml', 'telemetry.compose.yml', 'vps.compose.yml', 'vps.telemetry.compose.yml'],
  worker: ['worker.compose.yml'],
  'worker-build': ['worker.compose.yml', 'worker.build.compose.yml'],
  test: ['test.compose.yml'],
};

/** The variables a mode refuses to render without (`${VAR:?…}`), with fixed values. */
const RENDER_ENV: Record<string, string> = {
  STACK_AGENT_TOKEN: 'snapshot-token',
  DEPLOY_ROOT: '/srv/snapshot',
  GREPTIME_WRITER_PASSWORD: 'snapshot-writer',
  GREPTIME_READER_PASSWORD: 'snapshot-reader',
  GREPTIME_ADMIN_PASSWORD: 'snapshot-admin',
  [`${ENV_PREFIX}SERVER_URL`]: 'https://app.example.test',
  [`${ENV_PREFIX}TOKEN`]: 'nod_snapshot',
};

function composeAvailable(): boolean {
  const probe = spawnSync('docker', ['compose', 'version'], { encoding: 'utf8' });
  return probe.status === 0;
}

const HAS_COMPOSE = composeAvailable();
if (!HAS_COMPOSE) {
  console.warn(
    '[platform-infra] `docker compose` is not installed: the compose render snapshots are SKIPPED here. ' +
      'CI runs them; install the Docker Compose CLI (no daemon needed) to run them locally.',
  );
}

/**
 * Renders a project with `docker compose config --format json` from a scratch
 * copy of `composeDir`, with a clean environment, and returns it with the
 * scratch root replaced by `<ROOT>`.
 *
 * @param composeDir - The directory holding the compose files (an app's `infra/compose`).
 * @param files - The `-f` files, in order.
 * @param extraEnv - More variables for the render.
 */
function renderCompose(
  composeDir: string,
  files: readonly string[],
  extraEnv: Record<string, string> = {},
  extraFiles: readonly string[] = [],
): unknown {
  const scratch = mkdtempSync(join(tmpdir(), 'platform-infra-compose-'));
  try {
    const target = join(scratch, 'infra', 'compose');
    mkdirSync(target, { recursive: true });
    for (const name of readdirSync(composeDir)) {
      if (name.endsWith('.yml') || name.endsWith('.yaml')) cpSync(join(composeDir, name), join(target, name));
    }
    for (const path of extraFiles) cpSync(path, join(target, basename(path)));
    const result = spawnSync(
      'docker',
      ['compose', ...files.flatMap((file) => ['-f', file]), 'config', '--format', 'json'],
      {
        cwd: target,
        encoding: 'utf8',
        env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? scratch, ...RENDER_ENV, ...extraEnv },
      },
    );
    if (result.status !== 0) {
      throw new Error(`docker compose ${files.join(' ')} config failed:\n${result.stderr}`);
    }
    return JSON.parse(result.stdout.split(scratch).join('<ROOT>')) as unknown;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** Stable JSON: object keys sorted, so a snapshot diff is a real difference. */
function stableJson(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === 'object') {
      return Object.fromEntries(
        Object.keys(v as Record<string, unknown>)
          .sort()
          .map((key) => [key, sort((v as Record<string, unknown>)[key])]),
      );
    }
    return v;
  };
  return `${JSON.stringify(sort(value), null, 2)}\n`;
}

/** The same project without the two nginx include-point mounts this story added. */
function withoutIncludePoints(project: unknown): unknown {
  const copy = JSON.parse(JSON.stringify(project)) as { services?: Record<string, { volumes?: { target?: string }[] }> };
  const nginx = copy.services?.nginx;
  if (nginx?.volumes !== undefined) {
    nginx.volumes = nginx.volumes.filter((v) => !INCLUDE_POINT_TARGETS.includes(v.target ?? ''));
  }
  return copy;
}

const INCLUDE_POINT_TARGETS = ['/etc/nginx/platform', '/etc/nginx/app.d'];

type Project = { services: Record<string, Record<string, unknown> & { volumes?: { source?: string; target?: string; read_only?: boolean }[] }> };

/** The current mode lists, from the package's resolver. */
const CURRENT_MODES: Record<string, readonly string[]> = {
  dev: composeFilesForMode('dev'),
  devdb: composeFilesForMode('devdb'),
  'dev-telemetry': composeFilesForMode('dev', { telemetry: true }),
  prod: composeFilesForMode('prod'),
  vps: composeFilesForMode('vps', { telemetry: true }),
  worker: composeFilesForMode('worker'),
  'worker-build': composeFilesForMode('worker', { build: true }),
  test: ['test.compose.yml'],
};

describe('composeFilesForMode() keeps the documented order', () => {
  it.each(Object.keys(BASELINE_MODES))('%s: the same files in the same order as before the move', (mode) => {
    expect(CURRENT_MODES[mode]).toEqual(BASELINE_MODES[mode]);
  });
});

describe.skipIf(!HAS_COMPOSE)('the reference app compose stacks (docker compose config)', () => {
  const composeDir = join(REPO_ROOT, 'infra', 'compose');
  const baselineDir = process.env.PLATFORM_INFRA_BASELINE_COMPOSE_DIR;

  it.each(Object.entries(CURRENT_MODES))('%s renders exactly as before the move', async (mode, files) => {
    const rendered = withoutIncludePoints(renderCompose(baselineDir ?? composeDir, files));
    await expect(stableJson(rendered)).toMatchFileSnapshot(join(SNAPSHOTS, `${mode}.json`));
  });

  it('mounts the nginx include points read-only, beside nginx.conf and csp.conf (the only difference)', () => {
    const project = renderCompose(composeDir, CURRENT_MODES.vps ?? []) as Project;
    const mounts = (project.services.nginx?.volumes ?? []).map((v) => [v.source, v.target, v.read_only]);
    expect(mounts).toEqual([
      ['<ROOT>/infra/nginx/nginx.conf', '/etc/nginx/nginx.conf', true],
      ['<ROOT>/infra/nginx/csp.conf', '/etc/nginx/csp.conf', true],
      ['<ROOT>/infra/nginx/platform', '/etc/nginx/platform', true],
      ['<ROOT>/infra/nginx/app.d', '/etc/nginx/app.d', true],
    ]);
  });

  it('builds every image from the repository root on the deploy file list (R2)', () => {
    const project = renderCompose(composeDir, CURRENT_MODES.vps ?? []) as Project;
    const builds = Object.entries(project.services)
      .filter(([, service]) => service.build !== undefined)
      .map(([name, service]) => [name, (service.build as { context: string; dockerfile: string }).context]);
    expect(builds).toEqual([
      ['api', '<ROOT>'],
      ['stack-agent', '<ROOT>'],
      ['web', '<ROOT>'],
    ]);
  });

  it('never applies the shipped example overlay', () => {
    const listing = readdirSync(composeDir);
    expect(listing).toContain('app.example.compose.yml');
    expect(appComposeOverlays(listing, 'vps')).toEqual([]);
  });
});

describe.skipIf(!HAS_COMPOSE)('app compose overlays, with no platform file edited (kvox fixtures)', () => {
  const composeDir = join(REPO_ROOT, 'infra', 'compose');
  const fixtures = readdirSync(OVERLAY_FIXTURES).map((name) => join(OVERLAY_FIXTURES, name));
  const names = fixtures.map((path) => basename(path));

  it('appends the overlays after every platform file, sorted by name, each only in its scope', () => {
    expect(composeFilesForMode('vps', { telemetry: true, overlays: names }).slice(-2)).toEqual([
      'app.prod.memory-limits.compose.yml',
      'app.vps.no-stack-agent.compose.yml',
    ]);
    expect(composeFilesForMode('prod', { overlays: names }).slice(-1)).toEqual(['app.prod.memory-limits.compose.yml']);
    expect(composeFilesForMode('dev', { overlays: names })).toEqual(composeFilesForMode('dev'));
  });

  it('sets the memory limits from the environment, with a default', () => {
    const files = composeFilesForMode('vps', { telemetry: true, overlays: names });
    const byDefault = renderCompose(composeDir, files, {}, fixtures) as Project;
    const raised = renderCompose(composeDir, files, { API_MEM_LIMIT: '768M', WEB_MEM_LIMIT: '256M' }, fixtures) as Project;
    const memory = (project: Project, service: string): unknown =>
      (project.services[service]?.deploy as { resources: { limits: { memory: unknown } } }).resources.limits.memory;
    expect(memory(byDefault, 'api')).toBe(String(512 * 1024 * 1024));
    expect(memory(raised, 'api')).toBe(String(768 * 1024 * 1024));
    expect(memory(raised, 'web')).toBe(String(256 * 1024 * 1024));
  });

  it('switches the stack agent off, leaving every other service as the platform defines it', () => {
    const plain = renderCompose(composeDir, CURRENT_MODES.vps ?? []) as Project;
    const files = composeFilesForMode('vps', { telemetry: true, overlays: ['app.vps.no-stack-agent.compose.yml'] });
    const overlaid = renderCompose(composeDir, files, {}, fixtures) as Project;
    expect(Object.keys(plain.services)).toContain('stack-agent');
    expect(Object.keys(overlaid.services)).not.toContain('stack-agent');
    const { ['stack-agent']: _agent, ...rest } = plain.services;
    expect(overlaid.services).toEqual(rest);
  });
});
