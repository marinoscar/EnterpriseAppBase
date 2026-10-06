import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { Command } from 'commander';
import { readLedgerRows, readPackageRawSqlIndexes, runDrift } from '../drift/index.js';
import { emptyLock, parseLock, parseManifest, serializeJson, serializeLock, type ManifestEntry, type PlatformLock } from '../lock/index.js';
import {
  applySync,
  checkLedger,
  checkLock,
  nextPlatformVersion,
  planSync,
  promote,
} from '../sync/index.js';
import { listMigrationDirs, readBytes, writeLocalMigration } from './fs-io.js';

/**
 * Output sinks and environment of the `platform db` commands, injectable so tests drive them.
 *
 * @stability experimental
 */
export interface DbCommandContext {
  /** Writes a line to standard output. */
  out: (line: string) => void;
  /** Writes a line to standard error. */
  err: (line: string) => void;
  /** The working directory; the default for `--root`. */
  cwd: string;
  /** The environment (`DATABASE_URL`, `SHADOW_DATABASE_URL`). */
  env: NodeJS.ProcessEnv;
  /** The clock for new migration timestamps. */
  now: () => Date;
  /** The package root holding `migrations/`, `raw-sql-indexes.json` and `package.json`. */
  packageRoot: string;
  /** Receives the exit code of the finished command. */
  setExitCode: (code: number) => void;
}

interface CommonOptions {
  root?: string;
  packageDir?: string;
}

interface Layout {
  prismaDir: string;
  migrationsDir: string;
  lockFile: string;
  packageDir: string;
  manifestFile: string;
}

function layout(ctx: DbCommandContext, options: CommonOptions): Layout {
  const root = resolve(ctx.cwd, options.root ?? '.');
  const packageDir = options.packageDir ? resolve(ctx.cwd, options.packageDir) : ctx.packageRoot;
  const prismaDir = join(root, 'prisma');
  return {
    prismaDir,
    migrationsDir: join(prismaDir, 'migrations'),
    lockFile: join(prismaDir, 'platform.lock'),
    packageDir,
    manifestFile: join(packageDir, 'migrations', 'manifest.json'),
  };
}

function loadManifest(l: Layout): ManifestEntry[] {
  const bytes = readBytes(l.manifestFile);
  if (!bytes) return [];
  return parseManifest(Buffer.from(bytes).toString('utf8'), l.manifestFile);
}

function loadLock(l: Layout): PlatformLock | undefined {
  const bytes = readBytes(l.lockFile);
  return bytes ? parseLock(Buffer.from(bytes).toString('utf8'), l.lockFile) : undefined;
}

function packageVersionOf(l: Layout): string {
  const raw = JSON.parse(readFileSync(join(l.packageDir, 'package.json'), 'utf8')) as { version: string };
  return raw.version;
}

function writeText(file: string, text: string): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}

/** Runs a command body and turns a refusal into a printed message and exit code 1. */
async function guarded(ctx: DbCommandContext, body: () => Promise<number> | number): Promise<void> {
  try {
    ctx.setExitCode(await body());
  } catch (error) {
    ctx.err(`platform db: ${(error as Error).message}`);
    ctx.setExitCode(1);
  }
}

function runCheck(ctx: DbCommandContext, options: CommonOptions & { database?: boolean }): Promise<number> | number {
  const l = layout(ctx, options);
  const manifest = loadManifest(l);
  const lock = loadLock(l);
  if (!lock) {
    if (manifest.length === 0) {
      ctx.out('platform db check: no platform.lock and no package migrations; nothing to check');
      return 0;
    }
    ctx.err(`platform db check: ${l.lockFile} not found; run \`platform db sync\``);
    return 1;
  }
  const readLocal = (dir: string) => readBytes(join(l.migrationsDir, dir, 'migration.sql'));
  const readPackage = (dir: string) => readBytes(join(l.packageDir, 'migrations', dir, 'migration.sql'));
  const result = checkLock(manifest, lock, readLocal, readPackage);
  for (const problem of result.problems) ctx.err(`${problem.code}  ${problem.message}`);
  if (!result.ok) {
    ctx.err(`platform db check: ${result.problems.length} problem(s)`);
    return 1;
  }
  ctx.out(`platform db check: ok (${lock.migrations.length} installed platform migration(s))`);
  if (!options.database) return 0;

  return (async () => {
    const url = ctx.env.DATABASE_URL;
    if (!url) {
      ctx.err('platform db check --database: DATABASE_URL is not set (the api scripts build it from POSTGRES_*)');
      return 2;
    }
    const rows = await readLedgerRows(url, ctx.cwd);
    const ledger = checkLedger(listMigrationDirs(l.migrationsDir), readLocal, rows);
    for (const problem of ledger.problems) ctx.err(`${problem.code}  ${problem.message}`);
    if (ledger.pending.length) ctx.out(`platform db check --database: ${ledger.pending.length} migration(s) not applied yet (run prisma migrate deploy)`);
    if (!ledger.ok) {
      ctx.err(`platform db check --database: ${ledger.problems.length} problem(s)`);
      return 1;
    }
    ctx.out(`platform db check --database: ok (${rows.length} ledger row(s) match the files)`);
    return 0;
  })();
}

function runSync(
  ctx: DbCommandContext,
  options: CommonOptions & { check?: boolean; dryRun?: boolean; timestamp?: string; database?: boolean },
): Promise<number> | number {
  if (options.check) return runCheck(ctx, options);
  const l = layout(ctx, options);
  const manifest = loadManifest(l);
  const version = packageVersionOf(l);
  const lock = loadLock(l) ?? emptyLock(version);
  const now = options.timestamp ? new Date(options.timestamp) : ctx.now();
  if (Number.isNaN(now.getTime())) throw new Error(`--timestamp "${options.timestamp}" is not a date`);
  const plan = planSync(manifest, lock, listMigrationDirs(l.migrationsDir), now, version);
  if (plan.installs.length === 0) {
    ctx.out('platform db sync: up to date; nothing to install');
    return 0;
  }
  for (const install of plan.installs) ctx.out(`${options.dryRun ? 'would install' : 'install'}  ${install.originId} -> ${install.localDir}`);
  if (options.dryRun) return 0;
  const next = applySync(plan, {
    readPackageFile: (dir) => {
      const bytes = readBytes(join(l.packageDir, 'migrations', dir, 'migration.sql'));
      if (!bytes) throw new Error(`package file migrations/${dir}/migration.sql does not exist`);
      return bytes;
    },
    writeLocalMigration: (dir, bytes) => writeLocalMigration(l.migrationsDir, dir, bytes),
  });
  writeText(l.lockFile, serializeLock(next));
  ctx.out(`platform db sync: installed ${plan.installs.length} migration(s); run \`prisma migrate deploy\` to apply`);
  return 0;
}

function runPromote(
  ctx: DbCommandContext,
  localDir: string,
  options: CommonOptions & { id: string; since?: string; slice?: string; requires?: string },
): number {
  const l = layout(ctx, options);
  const manifest = loadManifest(l);
  const lock = loadLock(l) ?? emptyLock(packageVersionOf(l));
  const requires = options.requires ? options.requires.split(',').map((s) => s.trim()).filter(Boolean) : [];
  const result = promote(localDir, options.id, {
    manifest,
    lock,
    readLocal: (dir) => readBytes(join(l.migrationsDir, dir, 'migration.sql')),
    writePackageFile: (dir, bytes) => writeBytes(join(l.packageDir, 'migrations', dir, 'migration.sql'), bytes),
    since: options.since ?? nextPlatformVersion(packageVersionOf(l), manifest.map((entry) => entry.since)),
    slice: options.slice ?? manifest[manifest.length - 1]?.slice ?? 'core',
    requires,
  });
  if (!result.changed) {
    ctx.out(`platform db promote: ${result.entry.id} is already promoted from ${localDir}; nothing to do`);
    return 0;
  }
  writeText(l.manifestFile, serializeJson(result.manifest));
  writeText(l.lockFile, serializeLock(result.lock));
  ctx.out(`platform db promote: ${localDir} -> platform:${result.entry.id} (since ${result.entry.since})`);
  ctx.out('commit both trees: packages/platform-db/migrations/** and apps/*/prisma/platform.lock');
  return 0;
}

function writeBytes(file: string, bytes: Uint8Array): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, bytes);
}

async function runDriftCommand(
  ctx: DbCommandContext,
  options: CommonOptions & { schema?: string; shadowDatabaseUrl?: string },
): Promise<number> {
  const l = layout(ctx, options);
  const url = ctx.env.DATABASE_URL;
  if (!url) {
    ctx.err('platform db drift: DATABASE_URL is not set (the api scripts build it from POSTGRES_*)');
    return 2;
  }
  const schemaFolder = join(l.prismaDir, 'schema');
  const schema = options.schema
    ? resolve(ctx.cwd, options.schema)
    : existsSync(schemaFolder)
      ? schemaFolder
      : join(l.prismaDir, 'schema.prisma');
  const lock = loadLock(l);
  const packageIndexesFile = join(l.packageDir, 'raw-sql-indexes.json');
  const packageIndexes = existsSync(packageIndexesFile) ? readPackageRawSqlIndexes(packageIndexesFile) : [];
  const result = await runDrift({
    cwd: resolve(ctx.cwd, options.root ?? '.'),
    migrations: l.migrationsDir,
    schema,
    databaseUrl: url,
    shadowDatabaseUrl: options.shadowDatabaseUrl ?? ctx.env.SHADOW_DATABASE_URL,
    rawSqlIndexes: [...packageIndexes, ...(lock?.rawSqlIndexes ?? [])],
  });
  if (result.schemaDiff) {
    ctx.err('SCHEMA_DRIFT  the schema has changes no migration creates; add a migration. The missing SQL is:');
    ctx.err(result.schemaDiff);
  }
  for (const problem of result.indexProblems) ctx.err(`${problem.code}  ${problem.message}`);
  if (!result.ok) return 1;
  ctx.out(`platform db drift: ok (the migrations equal the schema; ${packageIndexes.length + (lock?.rawSqlIndexes?.length ?? 0)} raw-SQL index(es) present)`);
  return 0;
}

/**
 * Registers `sync`, `check`, `promote` and `drift` on the `platform db` command.
 *
 * @param db - The `db` subcommand of the `platform` program.
 * @param ctx - Output sinks and environment.
 * @stability experimental
 */
export function registerDbSyncCommands(db: Command, ctx: DbCommandContext): void {
  const common = (cmd: Command): Command =>
    cmd
      .option('--root <dir>', "the app's directory holding prisma/ (default: the current directory)")
      .option('--package-dir <dir>', 'the platform-db package directory (default: the installed package)');

  common(
    db
      .command('sync')
      .description('install package migrations missing from prisma/platform.lock into the app history (byte copies)')
      .option('--check', 'read-only: same as `platform db check`')
      .option('--dry-run', 'print what would be installed and write nothing')
      .option('--timestamp <iso>', 'the clock for the new directory names (tests)')
      .option('--database', 'with --check: also compare _prisma_migrations'),
  ).action((options) => guarded(ctx, () => runSync(ctx, options)));

  common(
    db
      .command('check')
      .description('verify the lock against the files and the package (read-only; exits 1 on any problem)')
      .option('--database', 'also compare _prisma_migrations checksums with the files (needs DATABASE_URL)'),
  ).action((options) => guarded(ctx, () => runCheck(ctx, options)));

  common(
    db
      .command('promote <localDir>')
      .description('copy an app migration into the package, add it to the manifest and the app lock (platform-internal)')
      .requiredOption('--id <slug>', 'the package migration slug, e.g. add_orgs')
      .option('--since <version>', 'the platform version that ships it (default: the next minor)')
      .option('--slice <slice>', 'the owning slice (default: the previous migration\'s)')
      .option('--requires <slices>', 'comma-separated slice ids that must come earlier'),
  ).action((localDir: string, options) => guarded(ctx, () => runPromote(ctx, localDir, options)));

  common(
    db
      .command('drift')
      .description('CI drift test: migrations replayed in a shadow database must equal the schema; raw-SQL indexes must exist')
      .option('--schema <path>', 'the composed schema folder or file (default: prisma/schema, else prisma/schema.prisma)')
      .option('--shadow-database-url <url>', 'an empty database to replay into (default: a throwaway one is created)'),
  ).action((options) => guarded(ctx, () => runDriftCommand(ctx, options)));
}
