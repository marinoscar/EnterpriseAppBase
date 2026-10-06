#!/usr/bin/env node
// Consumer smoke for the @marinoscar/platform-* packages (issue #697).
//
// Copies a minimal consumer project (./api or ./web) to a temporary directory
// OUTSIDE the repository, points its platform dependencies at packed tarballs,
// the npm registry or a GitHub release, installs it with npm (no workspace,
// no root node_modules, no link), then runs its build, its tests and the
// single-instance check against it. A workspace link hides missing `files`,
// dev-only dependencies, wrong `exports` conditions and duplicated peers; a
// clean install does not.
//
// Usage:
//   node tests/consumer-smoke/run.mjs [--project api|web|all]
//        [--from pack | --from tarballs <dir> | --from registry <version|tag> | --from release <version>]
//        [--repo <owner/name>] [--audit-signatures] [--keep]
//
//   --from pack       npm pack the six workspaces (built first with
//                     `npm run build:packages`) into a temp dir. The default.
//   --from tarballs   use the `marinoscar-platform-*.tgz` files in <dir>.
//   --from registry   install <version|tag> from the npm registry (retries the
//                     install for up to 2 minutes for registry propagation).
//   --from release    install the tarballs attached to the GitHub release
//                     `platform-v<version>` of --repo (default: the
//                     repository in packages/platform-api/package.json).
//   --audit-signatures  run `npm audit signatures` in the consumer after the
//                     install (registry installs only: provenance check).
//   --keep            keep the temporary project and print its path.
//
// Exit: 0 every step passed, 1 a step failed, 2 usage error.
// Node built-ins only.

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const PROJECTS = ['api', 'web'];
const PLATFORM_PACKAGES = ['contract', 'api', 'web', 'db', 'cli', 'infra'];
const PLATFORM_PREFIX = '@marinoscar/platform-';
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const INSTALL_TIMEOUT_MS = 5 * 60_000;
const STEP_TIMEOUT_MS = 10 * 60_000;
const REGISTRY_RETRY_MS = 2 * 60_000;
const REGISTRY_RETRY_INTERVAL_MS = 15_000;

const USAGE = `Usage: node tests/consumer-smoke/run.mjs [--project api|web|all]
         [--from pack | --from tarballs <dir> | --from registry <version|tag> | --from release <version>]
         [--repo <owner/name>] [--audit-signatures] [--keep]`;

class UsageError extends Error {}

function parseArgs(argv) {
  const opts = { project: 'all', from: 'pack', source: null, repo: null, auditSignatures: false, keep: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = () => {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) throw new UsageError(`${arg} needs a value`);
      i += 1;
      return v;
    };
    if (arg === '--project') opts.project = value();
    else if (arg === '--from') {
      opts.from = value();
      if (opts.from !== 'pack') opts.source = value();
    } else if (arg === '--repo') opts.repo = value();
    else if (arg === '--audit-signatures') opts.auditSignatures = true;
    else if (arg === '--keep') opts.keep = true;
    else if (arg === '--help' || arg === '-h') throw new UsageError('');
    else throw new UsageError(`unknown argument ${arg}`);
  }
  if (opts.project !== 'all' && !PROJECTS.includes(opts.project)) {
    throw new UsageError(`--project must be one of ${PROJECTS.join(', ')} or all`);
  }
  if (!['pack', 'tarballs', 'registry', 'release'].includes(opts.from)) {
    throw new UsageError('--from must be pack, tarballs <dir>, registry <version> or release <version>');
  }
  if (opts.auditSignatures && opts.from !== 'registry') {
    throw new UsageError('--audit-signatures needs --from registry (tarballs carry no registry signature)');
  }
  return opts;
}

function log(message) {
  console.log(`[consumer-smoke] ${message}`);
}

/** The environment a fresh consumer sees: no workspace or lifecycle state inherited from a parent `npm run`. */
function cleanEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    const k = key.toLowerCase();
    if (k.startsWith('npm_package_') || k.startsWith('npm_lifecycle_') || k.startsWith('npm_config_workspace')) delete env[key];
    if (k === 'npm_config_include_workspace_root' || k === 'npm_config_prefix' || k === 'node_path' || k === 'init_cwd') delete env[key];
  }
  env.npm_config_workspaces = 'false';
  env.npm_config_audit = 'false';
  env.npm_config_fund = 'false';
  env.npm_config_update_notifier = 'false';
  return env;
}

function run(cmd, args, cwd, { timeout = STEP_TIMEOUT_MS, env = cleanEnv(), allowFail = false } = {}) {
  log(`$ ${[cmd, ...args].join(' ')}   (in ${cwd})`);
  const result = spawnSync(cmd, args, { cwd, env, stdio: 'inherit', timeout, shell: process.platform === 'win32' });
  const ok = result.status === 0;
  if (!ok && !allowFail) {
    const why = result.error ? result.error.message : `exit ${result.status ?? result.signal}`;
    throw new Error(`${cmd} ${args.join(' ')} failed (${why})`);
  }
  return ok;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The owner/name of the repository the packages are built from (their `repository.url`). */
function defaultRepo() {
  const manifest = JSON.parse(readFileSync(join(REPO_ROOT, 'packages', 'platform-api', 'package.json'), 'utf8'));
  const match = /github\.com[/:]([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(manifest.repository?.url ?? '');
  if (!match) throw new UsageError('cannot derive the repository from packages/platform-api/package.json; pass --repo');
  return match[1];
}

/** Packs the six workspaces into a fresh temp directory and returns it. */
function packWorkspaces() {
  for (const p of PLATFORM_PACKAGES) {
    if (!existsSync(join(REPO_ROOT, 'packages', `platform-${p}`, 'dist'))) {
      throw new UsageError(`packages/platform-${p}/dist is missing: run \`npm run build:packages\` first`);
    }
  }
  const dir = mkdtempSync(join(tmpdir(), 'platform-tarballs-'));
  for (const p of PLATFORM_PACKAGES) {
    run(NPM, ['pack', '-w', `${PLATFORM_PREFIX}${p}`, '--pack-destination', dir], REPO_ROOT, { env: process.env });
  }
  return dir;
}

/** `{ "@marinoscar/platform-x": "<spec>" }` for every platform package, from a tarball directory. */
function tarballSpecs(dir) {
  const abs = resolve(dir);
  if (!existsSync(abs)) throw new UsageError(`tarball directory not found: ${abs}`);
  const files = readdirSync(abs).filter((f) => f.endsWith('.tgz'));
  const specs = {};
  for (const p of PLATFORM_PACKAGES) {
    const matches = files.filter((f) => f.startsWith(`marinoscar-platform-${p}-`) && /^\d/.test(f.slice(`marinoscar-platform-${p}-`.length)));
    if (matches.length > 1) throw new UsageError(`more than one tarball for platform-${p} in ${abs}: ${matches.join(', ')}`);
    // A tarball spec is extracted into node_modules like a registry install;
    // it is never a symlink (unlike a directory `file:` spec or a workspace).
    if (matches.length === 1) specs[`${PLATFORM_PREFIX}${p}`] = `file:${join(abs, matches[0])}`;
  }
  return specs;
}

function releaseSpecs(version, repo) {
  const specs = {};
  for (const p of PLATFORM_PACKAGES) {
    specs[`${PLATFORM_PREFIX}${p}`] =
      `https://github.com/${repo}/releases/download/platform-v${version}/marinoscar-platform-${p}-${version}.tgz`;
  }
  return specs;
}

/**
 * Rewrites the copied consumer's package.json: each direct platform dependency
 * gets its spec, and (for tarball and release installs, where the registry may
 * not have the version) `overrides` pin any platform package another one
 * depends on to the same source.
 */
function writeSpecs(projectDir, opts, specs) {
  const path = join(projectDir, 'package.json');
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  const direct = new Set();
  for (const field of ['dependencies', 'devDependencies']) {
    for (const name of Object.keys(manifest[field] ?? {})) {
      if (!name.startsWith(PLATFORM_PREFIX)) continue;
      const spec = opts.from === 'registry' ? opts.source : specs[name];
      if (!spec) throw new UsageError(`no ${opts.from} source for ${name}`);
      manifest[field][name] = spec;
      direct.add(name);
    }
  }
  if (direct.size === 0) throw new UsageError(`${path} declares no ${PLATFORM_PREFIX}* dependency`);
  if (opts.from !== 'registry') {
    manifest.overrides = {};
    for (const [name, spec] of Object.entries(specs)) manifest.overrides[name] = direct.has(name) ? `$${name}` : spec;
  }
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
  return [...direct].map((name) => `${name}@${manifest.dependencies?.[name] ?? manifest.devDependencies?.[name]}`);
}

function copyProject(project) {
  const source = join(HERE, project);
  const tmp = mkdtempSync(join(tmpdir(), `platform-consumer-${project}-`));
  const rel = relative(realpathSync(REPO_ROOT), realpathSync(tmp));
  if (!rel.startsWith('..') && !isAbsolute(rel)) {
    throw new UsageError(`the temp directory ${tmp} is inside the repository; set TMPDIR elsewhere`);
  }
  const skip = new Set(['node_modules', 'dist', 'package-lock.json', 'coverage']);
  cpSync(source, tmp, {
    recursive: true,
    filter: (src) => !skip.has(relative(source, src).split(/[\\/]/)[0]),
  });
  return tmp;
}

async function install(dir, opts) {
  const args = ['install', '--no-audit', '--no-fund'];
  if (opts.from !== 'registry') {
    run(NPM, args, dir, { timeout: INSTALL_TIMEOUT_MS });
    return;
  }
  const deadline = Date.now() + REGISTRY_RETRY_MS;
  for (let attempt = 1; ; attempt += 1) {
    if (run(NPM, args, dir, { timeout: INSTALL_TIMEOUT_MS, allowFail: true })) return;
    if (Date.now() + REGISTRY_RETRY_INTERVAL_MS > deadline) throw new Error(`npm install failed after ${attempt} attempts`);
    log(`install attempt ${attempt} failed; retrying in ${REGISTRY_RETRY_INTERVAL_MS / 1000} s (registry propagation)`);
    await sleep(REGISTRY_RETRY_INTERVAL_MS);
  }
}

async function smoke(project, opts, specs) {
  const dir = copyProject(project);
  log(`--- ${project}: ${dir}`);
  try {
    const deps = writeSpecs(dir, opts, specs);
    log(`${project}: ${deps.join(', ')}`);
    await install(dir, opts);
    run(NPM, ['ls', '--all', '--omit=dev', ...Object.keys(specs).filter((n) => deps.some((d) => d.startsWith(`${n}@`)))], dir, { allowFail: true });
    if (opts.auditSignatures) run(NPM, ['audit', 'signatures'], dir);
    run(NPM, ['run', 'build'], dir);
    run(NPM, ['test'], dir);
    const guards = PLATFORM_PACKAGES.flatMap((p) => ['--guard', `${PLATFORM_PREFIX}${p}`]);
    run(process.execPath, [join(REPO_ROOT, 'scripts', 'check-single-instance.mjs'), '--root', dir, ...guards], REPO_ROOT);
    log(`${project}: PASS`);
  } finally {
    if (opts.keep) log(`${project}: kept ${dir}`);
    else rmSync(dir, { recursive: true, force: true });
  }
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    if (err instanceof UsageError) {
      if (err.message) console.error(`run.mjs: ${err.message}`);
      console.error(USAGE);
      return 2;
    }
    throw err;
  }

  // npm 10 (Node 22) crashes resolving vitest's peer set ("Cannot read
  // properties of null (reading 'edgesOut')"); the packages need Node 24,
  // which ships npm 11.
  const npmVersion = spawnSync(NPM, ['--version'], { encoding: 'utf8', shell: process.platform === 'win32' }).stdout?.trim() ?? '';
  if (Number.parseInt(npmVersion, 10) < 11) log(`warning: npm ${npmVersion} found; the smoke expects npm 11 or later (Node 24)`);

  const projects = opts.project === 'all' ? PROJECTS : [opts.project];
  let packed = null;
  try {
    let specs = {};
    if (opts.from === 'pack') {
      packed = packWorkspaces();
      specs = tarballSpecs(packed);
    } else if (opts.from === 'tarballs') {
      specs = tarballSpecs(opts.source);
    } else if (opts.from === 'release') {
      specs = releaseSpecs(opts.source, opts.repo ?? defaultRepo());
    } else {
      specs = Object.fromEntries(PLATFORM_PACKAGES.map((p) => [`${PLATFORM_PREFIX}${p}`, opts.source]));
    }
    for (const project of projects) await smoke(project, opts, specs);
    log(`PASS: ${projects.join(', ')} (from ${opts.from}${opts.source ? ` ${opts.source}` : ''})`);
    return 0;
  } catch (err) {
    if (err instanceof UsageError) {
      console.error(`run.mjs: ${err.message}`);
      return 2;
    }
    console.error(`[consumer-smoke] FAIL: ${err.message}`);
    return 1;
  } finally {
    if (packed) rmSync(packed, { recursive: true, force: true });
  }
}

process.exitCode = await main();
