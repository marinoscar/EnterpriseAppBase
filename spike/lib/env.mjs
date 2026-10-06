// Shared plumbing for the PP-5.1 experiment scripts.
//
// Every experiment runs against a DISPOSABLE database named `pp_5_1_<tag>` on
// the throwaway PostgreSQL from infra/compose/test.compose.yml (port 5433).
// Nothing here ever connects to a development or production database: the
// database name is always built from the `pp_5_1_` prefix and a script tag, and
// `recreateDb` refuses any other name.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

const require = createRequire(import.meta.url);
export const SPIKE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const REPO_ROOT = resolve(SPIKE_ROOT, '..');
export const API_ROOT = join(REPO_ROOT, 'apps', 'api');
export const WORK_ROOT = join(SPIKE_ROOT, '.work');
export const RESULTS_ROOT = join(SPIKE_ROOT, 'results');

export const PG = {
  host: process.env.POSTGRES_HOST ?? '127.0.0.1',
  port: process.env.POSTGRES_PORT ?? '5433',
  user: process.env.POSTGRES_USER ?? 'postgres',
  password: process.env.POSTGRES_PASSWORD ?? 'postgres',
};

export const DB_PREFIX = 'pp_5_1_';

export function dbUrl(database, { user = PG.user, password = PG.password, host = PG.host, port = PG.port } = {}) {
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
}

/** The POSTGRES_* variables `apps/api/scripts/prisma-env.js` turns into DATABASE_URL. */
export function pgEnv(database, extra = {}) {
  const { DATABASE_URL: _drop, ...rest } = process.env;
  return {
    ...rest,
    POSTGRES_HOST: PG.host,
    POSTGRES_PORT: PG.port,
    POSTGRES_USER: PG.user,
    POSTGRES_PASSWORD: PG.password,
    POSTGRES_DB: database,
    POSTGRES_SSL: 'false',
    ...extra,
  };
}

export async function withClient(database, fn, opts) {
  const client = new pg.Client({ connectionString: dbUrl(database, opts) });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export const withAdmin = (fn) => withClient('postgres', fn);

function assertScratch(name) {
  if (!name.startsWith(DB_PREFIX)) throw new Error(`refusing to touch database "${name}": scratch names start with ${DB_PREFIX}`);
}

export async function dropDb(name) {
  assertScratch(name);
  await withAdmin((c) => c.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`));
}

export async function recreateDb(name) {
  await dropDb(name);
  await withAdmin((c) => c.query(`CREATE DATABASE "${name}"`));
}

export async function dropRole(name) {
  if (!name.startsWith(DB_PREFIX)) throw new Error(`refusing to drop role ${name}`);
  await withAdmin((c) => c.query(`DROP ROLE IF EXISTS "${name}"`));
}

export async function scalar(database, sql, params = []) {
  return withClient(database, async (c) => {
    const r = await c.query(sql, params);
    return r.rows[0] ? Object.values(r.rows[0])[0] : null;
  });
}

export async function rows(database, sql, params = [], opts) {
  return withClient(database, async (c) => (await c.query(sql, params)).rows, opts);
}

// -- Prisma CLI --------------------------------------------------------------

const PRISMA_BIN = require.resolve('prisma/build/index.js', { paths: [API_ROOT] });

/**
 * Runs the Prisma CLI. `cwd` must contain a prisma.config.ts (every experiment
 * workdir does). Never throws on a non-zero exit: the caller asserts, because
 * several experiments EXPECT a failure and record its message.
 */
export function prisma(args, { cwd, database, env = {}, input } = {}) {
  const r = spawnSync(process.execPath, [PRISMA_BIN, ...args], {
    cwd,
    env: { ...(database ? pgEnv(database) : process.env), ...(database ? { DATABASE_URL: dbUrl(database) } : {}), ...env },
    encoding: 'utf8',
    input,
    maxBuffer: 64 * 1024 * 1024,
  });
  // Strip Prisma's "update available" banner so recorded output stays readable.
  return { status: r.status, stdout: clean(r.stdout ?? ''), stderr: clean(r.stderr ?? '') };
}

/** Strips ANSI colour, dotenv tips and Prisma's update banner so recorded output stays readable. */
export const clean = (s) =>
  s
    .replace(/\x1b\[[0-9;]*m/g, '')
    .replace(/┌─+┐[\s\S]*?└─+┘\n?/g, '')
    .replace(/^.*injected env.*\n/gm, '')
    .replace(/Loaded Prisma config from [^\n]*\n\n?/g, '');

/** Run a command in a workdir (npm scripts, node, pg_dump...). */
export function run(cmd, args, { cwd, env = process.env, input, allowFail = true } = {}) {
  const r = spawnSync(cmd, args, { cwd, env, encoding: 'utf8', input, maxBuffer: 256 * 1024 * 1024 });
  if (!allowFail && r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed (${r.status}): ${r.stderr}`);
  return { status: r.status, stdout: clean(r.stdout ?? ''), stderr: clean(r.stderr ?? '') };
}

// -- Files ---------------------------------------------------------------------

export function freshWorkdir(name) {
  const dir = join(WORK_ROOT, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function write(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

export const read = (path) => readFileSync(path, 'utf8');
export const sha256 = (bufOrText) => createHash('sha256').update(bufOrText).digest('hex');
export { cpSync, existsSync, mkdirSync, rmSync, readFileSync, writeFileSync, join, dirname, resolve };

// -- Reporting -------------------------------------------------------------------

const results = [];
const transcript = [];
let tag = 'spike';

export function begin(name) {
  tag = name;
  say(`\n=== ${name} ===`);
}

export function say(...parts) {
  const line = parts.join(' ').split(REPO_ROOT).join('<repo>');
  transcript.push(line);
  console.log(line);
}

export function show(title, text) {
  const body = String(text).trimEnd();
  say(`--- ${title}`);
  if (body) say(body.split('\n').map((l) => `    ${l}`).join('\n'));
}

export function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok });
  say(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  return !!ok;
}

/** Writes spike/results/<tag>.txt (the last run's transcript) and sets the exit code. */
export function finish() {
  const failed = results.filter((r) => !r.ok);
  say(`\n${results.length - failed.length}/${results.length} checks passed${failed.length ? `; FAILED: ${failed.map((f) => f.name).join('; ')}` : ''}`);
  mkdirSync(RESULTS_ROOT, { recursive: true });
  writeFileSync(join(RESULTS_ROOT, `${tag}.txt`), `${transcript.join('\n')}\n`);
  process.exitCode = failed.length ? 1 : 0;
}

/** Make a script's top level fail loudly, with the transcript still saved. */
export async function main(fn) {
  try {
    await fn();
  } catch (err) {
    say(`\nFATAL: ${err?.stack ?? err}`);
    results.push({ name: 'script completed without throwing', ok: false });
  }
  finish();
}

// -- Project scaffolding ---------------------------------------------------------

/**
 * Writes a minimal Prisma project into `dir`: prisma.config.ts pointing at
 * `schema` (a file or folder), `migrations.path` explicit, optional shadow DB.
 */
export function writeConfig(dir, { schema = 'prisma/schema', migrations = 'prisma/migrations', shadowDatabaseUrl } = {}) {
  write(
    join(dir, 'prisma.config.ts'),
    `import { defineConfig } from '@prisma/config';
export default defineConfig({
  schema: '${schema}',
  migrations: { path: '${migrations}' },
  datasource: { url: process.env.DATABASE_URL as string${shadowDatabaseUrl ? `, shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL as string` : ''} },
});
`,
  );
}

/** Copies the real 21-migration history (and lock file) to `<dir>/prisma/migrations`. */
export function copyRealMigrations(dir, { only } = {}) {
  const src = join(API_ROOT, 'prisma', 'migrations');
  const dst = join(dir, 'prisma', 'migrations');
  mkdirSync(dst, { recursive: true });
  cpSync(join(src, 'migration_lock.toml'), join(dst, 'migration_lock.toml'));
  const dirs = readdirSync(src, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  for (const d of dirs.slice(0, only ?? dirs.length)) cpSync(join(src, d), join(dst, d), { recursive: true });
  return dirs.slice(0, only ?? dirs.length);
}

export const realMigrationDirs = () => readdirSync(join(API_ROOT, 'prisma', 'migrations'), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();

export const tsc = (args, opts) => run(process.execPath, [join(REPO_ROOT, 'node_modules', 'typescript', 'bin', 'tsc'), ...args], opts);
