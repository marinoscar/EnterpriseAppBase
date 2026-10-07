// =============================================================================
// The reference app's compose stacks, rendered by `docker compose config`
// =============================================================================
//
// Proves that moving the compose files into @marinoscar/platform-infra (and
// materialising them back into infra/compose/ with `platform-infra sync`)
// changes nothing a deployment runs: each mode's merged project is compared
// with the snapshot of the files as they were before the move
// (test/snapshots/compose/<mode>.json). `docker compose config` needs the
// Compose CLI but no daemon, so this runs wherever Compose is installed; the
// GitHub runners have it, so CI always runs it. Without Compose the suite is
// skipped with a message saying so.
//
// The files are copied into a scratch `infra/compose/` first, so a developer's
// own `.env` (which `env_file:` would inline) never reaches the snapshot, and
// the scratch root is replaced by `<ROOT>` so the snapshot is portable.
// =============================================================================

import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const PACKAGE_ROOT = fileURLToPath(new URL('../', import.meta.url));
const REPO_ROOT = join(PACKAGE_ROOT, '..', '..');
const SNAPSHOTS = join(PACKAGE_ROOT, 'test', 'snapshots', 'compose');

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
 * (`composeFilesFor()`) spell them today. Spelled out on purpose: this is the
 * baseline the platform's own ordering is compared with.
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
): unknown {
  const scratch = mkdtempSync(join(tmpdir(), 'platform-infra-compose-'));
  try {
    const target = join(scratch, 'infra', 'compose');
    mkdirSync(target, { recursive: true });
    for (const name of readdirSync(composeDir)) {
      if (name.endsWith('.yml') || name.endsWith('.yaml')) cpSync(join(composeDir, name), join(target, name));
    }
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

describe.skipIf(!HAS_COMPOSE)('the reference app compose stacks (docker compose config)', () => {
  const composeDir = join(REPO_ROOT, 'infra', 'compose');

  it.each(Object.entries(BASELINE_MODES))('%s renders exactly as before the move', async (mode, files) => {
    const rendered = renderCompose(composeDir, files);
    await expect(stableJson(rendered)).toMatchFileSnapshot(join(SNAPSHOTS, `${mode}.json`));
  });
});
