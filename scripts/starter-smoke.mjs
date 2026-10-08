#!/usr/bin/env node
// Starter smoke (issue #741): install `starter/` (or a project `new-project.mjs
// create` produced from it) the way a new app gets the platform, and prove it
// typechecks, tests, builds and passes the platform lock checks.
//
// The starter depends on PUBLISHED `@marinoscar/platform-*` ranges, never on
// workspace paths. This script simulates the published state without editing
// the starter itself: it copies the project to a temporary directory OUTSIDE
// the repository and adds root `overrides` there, pointing every platform
// package at a packed tarball (or at a registry dist-tag). No `npm link`, no
// workspace link: those hide exactly the defects a published package can have
// and break single-instance packages.
//
// Usage:
//   node scripts/starter-smoke.mjs [--from pack | --from tarballs <dir> | --from registry <tag>]
//        [--project <dir>] [--create] [--db] [--keep]
//
//   --from pack       npm pack the six platform workspaces (built first with
//                     `npm run build:packages`) into a temp dir. The default.
//   --from tarballs   use the `marinoscar-platform-*.tgz` files in <dir>.
//   --from registry   override every platform package with <tag> (`next`).
//   --project <dir>   the project to smoke (default: starter/).
//   --create          first run `new-project.mjs create` (Acme Hub, acmectl)
//                     into a temp directory, then smoke that project.
//   --db              also run the API's db tier (needs POSTGRES_* of a
//                     database the script may migrate).
//   --keep            keep the temporary project and print its path.
//
// Exit: 0 every step passed, 1 a step failed, 2 usage error. Node built-ins only.

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PLATFORM_PACKAGES = ['contract', 'api', 'web', 'db', 'cli', 'infra'];
const PREFIX = '@marinoscar/platform-';
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const SKIP_DIRS = new Set(['node_modules', 'dist', 'coverage']);

class UsageError extends Error {}

const log = (msg) => console.log(`[starter-smoke] ${msg}`);

export function parseArgs(argv) {
  const opts = { from: 'pack', source: null, project: join(REPO_ROOT, 'starter'), create: false, db: false, keep: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = () => {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) throw new UsageError(`${arg} needs a value`);
      i += 1;
      return v;
    };
    if (arg === '--from') {
      opts.from = value();
      if (opts.from !== 'pack') opts.source = value();
    } else if (arg === '--project') opts.project = resolve(value());
    else if (arg === '--create') opts.create = true;
    else if (arg === '--db') opts.db = true;
    else if (arg === '--keep') opts.keep = true;
    else throw new UsageError(`unknown argument ${arg}`);
  }
  if (!['pack', 'tarballs', 'registry'].includes(opts.from)) throw new UsageError('--from must be pack, tarballs <dir> or registry <tag>');
  return opts;
}

function run(cmd, args, cwd, { allowFail = false, env = process.env } = {}) {
  log(`$ ${cmd} ${args.join(' ')}   (in ${cwd})`);
  const result = spawnSync(cmd, args, { cwd, stdio: 'inherit', env, shell: process.platform === 'win32' });
  if (result.status !== 0 && !allowFail) throw new Error(`${cmd} ${args.join(' ')} failed (exit ${result.status})`);
  return result.status === 0;
}

/** An environment without the inherited npm workspace state, so the copy installs as its own project. */
function cleanEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  for (const key of Object.keys(env)) if (key.startsWith('npm_')) delete env[key];
  delete env.NODE_PATH;
  delete env.INIT_CWD;
  return env;
}

function tempDir(label) {
  const dir = mkdtempSync(join(tmpdir(), `platform-starter-${label}-`));
  const rel = relative(realpathSync(REPO_ROOT), realpathSync(dir));
  if (!rel.startsWith('..') && !isAbsolute(rel)) throw new UsageError(`${dir} is inside the repository; set TMPDIR elsewhere`);
  return dir;
}

function packWorkspaces() {
  for (const p of PLATFORM_PACKAGES) {
    if (!existsSync(join(REPO_ROOT, 'packages', `platform-${p}`, 'dist'))) {
      throw new UsageError(`packages/platform-${p}/dist is missing: run \`npm run build:packages\` first`);
    }
  }
  const dir = tempDir('tarballs');
  for (const p of PLATFORM_PACKAGES) run(NPM, ['pack', '-w', `${PREFIX}${p}`, '--pack-destination', dir], REPO_ROOT);
  return dir;
}

/** `{ "@marinoscar/platform-x": "file:<tgz>" }` for every tarball in `dir`. */
export function tarballOverrides(dir) {
  const files = readdirSync(dir).filter((f) => f.endsWith('.tgz'));
  const overrides = {};
  for (const p of PLATFORM_PACKAGES) {
    const match = files.filter((f) => f.startsWith(`marinoscar-platform-${p}-`) && /^\d/.test(f.slice(`marinoscar-platform-${p}-`.length)));
    if (match.length !== 1) throw new UsageError(`expected one tarball for platform-${p} in ${dir}, found ${match.length}`);
    overrides[`${PREFIX}${p}`] = `file:${join(resolve(dir), match[0])}`;
  }
  return overrides;
}

/** Adds the overrides to the COPY's root package.json (the starter itself is never edited). */
export function writeOverrides(projectDir, overrides) {
  const path = join(projectDir, 'package.json');
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  manifest.overrides = { ...(manifest.overrides ?? {}), ...overrides };
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
}

/** Build output, installs and a lockfile resolved elsewhere never travel with the copy. */
export function keepInCopy(rel) {
  if (rel === '') return true;
  const parts = rel.split(/[\\/]/);
  return !parts.some((part) => SKIP_DIRS.has(part)) && rel !== 'package-lock.json';
}

function copyProject(source) {
  const dir = tempDir('app');
  cpSync(source, dir, { recursive: true, filter: (src) => keepInCopy(relative(source, src)) });
  return dir;
}

function createProject() {
  const parent = tempDir('create');
  const dir = join(parent, 'acme-hub');
  run(process.execPath, [join(REPO_ROOT, 'scripts', 'new-project.mjs'), 'create', '--dir', dir, '--name', 'Acme Hub', '--repo', 'acme/acme-hub', '--cli', 'acmectl', '--dry-run'], REPO_ROOT);
  if (existsSync(dir)) throw new Error('create --dry-run wrote the target directory');
  run(process.execPath, [join(REPO_ROOT, 'scripts', 'new-project.mjs'), 'create', '--dir', dir, '--name', 'Acme Hub', '--repo', 'acme/acme-hub', '--cli', 'acmectl'], REPO_ROOT);
  return { dir, parent };
}

/** The created project carries the new identity everywhere a user sees it, and none of the starter's. */
function assertCreatedIdentity(dir) {
  const help = spawnSync(process.execPath, [join(dir, 'apps', 'cli', 'dist', 'cli.js'), '--help'], { encoding: 'utf8' });
  if (!/Usage: acmectl\b/.test(help.stdout)) throw new Error(`the built CLI does not name acmectl:\n${help.stdout}${help.stderr}`);
  const html = readFileSync(join(dir, 'apps', 'web', 'dist', 'index.html'), 'utf8');
  if (!html.includes('<title>Acme Hub</title>')) throw new Error('the built web <title> is not "Acme Hub"');
  const manifest = JSON.parse(readFileSync(join(dir, 'apps', 'web', 'dist', 'manifest.webmanifest'), 'utf8'));
  if (manifest.name !== 'Acme Hub') throw new Error(`the web manifest names "${manifest.name}"`);
  if (!readFileSync(join(dir, 'infra', 'compose', 'worker.compose.yml'), 'utf8').includes('ACMECTL_TOKEN')) {
    throw new Error('the worker fragment does not render ACMECTL_*');
  }
  run(process.execPath, [join(REPO_ROOT, 'scripts', 'starter-identity.mjs'), '--root', dir], REPO_ROOT);
  log('created project: acmectl --help, <title>, manifest, worker fragment and identity scan all carry Acme Hub');
}

function smoke(dir, opts, overrides) {
  const env = cleanEnv();
  writeOverrides(dir, overrides);
  run(NPM, ['install', '--no-audit', '--no-fund'], dir, { env });
  // Platform lock and drift: the composed schema, the installed migrations
  // and the infra fragments are byte-identical to what the packages ship.
  run(NPM, ['run', 'platform:check'], dir, { env });
  run(NPM, ['run', 'prisma:generate', '--workspace=api'], dir, { env });
  run(NPM, ['run', 'prisma:validate', '--workspace=api'], dir, { env: { ...env, DATABASE_URL: env.DATABASE_URL ?? 'postgresql://u:p@localhost:5432/validate' } });
  run(NPM, ['run', 'typecheck'], dir, { env });
  run(NPM, ['test'], dir, { env });
  run(NPM, ['run', 'build'], dir, { env });
  if (opts.db) {
    run(NPM, ['run', 'prisma:migrate', '--workspace=api'], dir, { env });
    run(NPM, ['run', 'prisma:seed', '--workspace=api'], dir, { env });
    run(NPM, ['run', 'test:db', '--workspace=api'], dir, { env });
  }
  if (opts.create) assertCreatedIdentity(dir);
  const guards = PLATFORM_PACKAGES.flatMap((p) => ['--guard', `${PREFIX}${p}`]);
  run(process.execPath, [join(REPO_ROOT, 'scripts', 'check-single-instance.mjs'), '--root', dir, ...guards], REPO_ROOT);
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    if (err instanceof UsageError) {
      console.error(`starter-smoke: ${err.message}`);
      return 2;
    }
    throw err;
  }
  const cleanup = [];
  try {
    let overrides;
    if (opts.from === 'registry') {
      overrides = Object.fromEntries(PLATFORM_PACKAGES.map((p) => [`${PREFIX}${p}`, opts.source]));
    } else {
      const tarballs = opts.from === 'pack' ? packWorkspaces() : resolve(opts.source);
      if (opts.from === 'pack') cleanup.push(tarballs);
      overrides = tarballOverrides(tarballs);
    }
    let dir;
    if (opts.create) {
      const created = createProject();
      dir = created.dir;
      cleanup.push(created.parent);
    } else {
      dir = copyProject(opts.project);
      cleanup.push(dir);
    }
    log(`project: ${dir}`);
    smoke(dir, opts, overrides);
    log(`PASS (${opts.create ? 'created project' : relative(REPO_ROOT, opts.project) || '.'}, from ${opts.from}${opts.source ? ` ${opts.source}` : ''})`);
    return 0;
  } catch (err) {
    if (err instanceof UsageError) {
      console.error(`starter-smoke: ${err.message}`);
      return 2;
    }
    console.error(`[starter-smoke] FAIL: ${err.message}`);
    return 1;
  } finally {
    if (opts.keep) log(`kept: ${cleanup.join(', ')}`);
    else for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
  }
}

const isDirectExecution = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectExecution) process.exitCode = await main();
