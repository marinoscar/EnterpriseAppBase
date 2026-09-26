import { PreconditionError, UsageError } from '../errors.js';
import {
  DATABASE_CHECKS,
  MAINTENANCE_DATABASE,
  canCreateDatabase,
  databaseSettings,
  runChecks,
  runPsql,
  type CheckContext,
  type CompletedCheck,
  type DatabaseSettings,
} from './checks/index.js';
import { consented, obtainConsent, type ConsentOptions } from './consent.js';
import type { runCommand } from './executor.js';

// =============================================================================
// Creating the application database when it does not exist  (issue #391)
// =============================================================================
//
// `database-exists` used to end an install with a `createdb` remedy, on a
// server that was reachable, whose credentials worked, and whose role often
// held CREATEDB -- so the install stopped to have a human type one command.
//
// THREE RULES, each pinned by a test:
//
//   1. ONLY THE ONE FAILURE. The database is created only when the server is
//      reachable, the credentials authenticate, and the ONLY problem is that
//      the named database does not exist (3D000). Anything else -- refused,
//      bad password, pg_hba -- is reported exactly as before; creating a
//      database is not a remedy for any of those.
//   2. NEVER SILENTLY. A typo in POSTGRES_DB is indistinguishable, from here,
//      from a database that simply does not exist yet; creating it silently
//      would migrate into a second, empty database and the operator's first
//      evidence would be an application with no data. So: a prompt, or
//      `--create-database` for a non-interactive run.
//   3. CREATE, NEVER DROP OR ALTER. The only statement this ever issues is
//      `CREATE DATABASE "<name>"`, against the `postgres` maintenance
//      database, with the password passed through PGPASSWORD (by name in the
//      argv, by value in the environment -- `runPsql`). The identifier is
//      validated against a conservative grammar and then double-quoted, so no
//      value from the `.env` can extend the statement.
// =============================================================================

/**
 * The identifiers this will create. Deliberately narrower than PostgreSQL's
 * own grammar: no quotes, no spaces, nothing that needs thinking about. A name
 * outside it is refused rather than escaped -- create it by hand if you must.
 */
export const CREATABLE_DATABASE_NAME = /^[A-Za-z_][A-Za-z0-9_$]*$/;

/** PostgreSQL truncates identifiers longer than this, silently. */
const MAX_IDENTIFIER_BYTES = 63;

/** Throws a UsageError unless `name` is safe to create. */
export function assertCreatableDatabaseName(name: string): void {
  if (!CREATABLE_DATABASE_NAME.test(name) || Buffer.byteLength(name) > MAX_IDENTIFIER_BYTES) {
    throw new UsageError(
      `POSTGRES_DB "${name}" is not a name this will create: it must match ` +
        `${CREATABLE_DATABASE_NAME.source} and be at most ${MAX_IDENTIFIER_BYTES} bytes. ` +
        'Create the database by hand, or choose a plainer name.',
    );
  }
}

/** The one statement ever issued. Validates, then quotes. */
export function createDatabaseStatement(name: string): string {
  assertCreatableDatabaseName(name);
  return `CREATE DATABASE "${name}"`;
}

/** True when `database-exists` failed because the database is absent (3D000). */
export function isMissingDatabase(result: Pick<CompletedCheck, 'id' | 'status' | 'detail'>): boolean {
  return (
    result.id === 'database-exists' &&
    result.status === 'fail' &&
    /does not exist/i.test(result.detail)
  );
}

/**
 * True when the ONLY required failure among database checks is a missing
 * database. That is the single case `ensure-database` may act on -- see rule 1.
 */
export function onlyDatabaseMissing(results: readonly CompletedCheck[]): boolean {
  const failed = results.filter((result) => result.status === 'fail' && result.severity === 'required');
  return failed.length === 1 && isMissingDatabase(failed[0] as CompletedCheck);
}

/** The checks that decide whether the database is usable, and nothing else. */
const EXISTENCE_CHECK_IDS = new Set(['database-reachable', 'database-credentials', 'database-exists']);

export interface EnsureDatabaseOptions extends Omit<ConsentOptions, 'flag'> {
  env: ReadonlyMap<string, string>;
  runCommand: typeof runCommand;
  /** `--create-database`: consent given in advance. */
  createDatabase?: boolean | undefined;
  /** Where to report, one line at a time. */
  onLine?: ((line: string) => void) | undefined;
  /**
   * The existence checks, replaceable in tests. Defaults to the real
   * reachable/credentials/exists subset of the registry.
   */
  check?: ((context: CheckContext) => Promise<CompletedCheck[]>) | undefined;
}

export interface EnsureDatabaseResult {
  outcome: 'exists' | 'created';
  database: string;
  detail: string;
}

function remedyFor(settings: DatabaseSettings): string {
  const name = settings.database;
  return (
    `Create it by hand: CREATE DATABASE "${name}"; (or: createdb -h ${settings.host} -p ${settings.port} -U ${settings.user} ${name}) ` +
    `-- or, if "${name}" is not the name you meant, correct POSTGRES_DB in the environment file.`
  );
}

/**
 * Makes sure the configured database exists, creating it (with consent) when
 * it is the only thing missing. Never drops or alters anything.
 */
export async function ensureDatabase(options: EnsureDatabaseOptions): Promise<EnsureDatabaseResult> {
  const settings = databaseSettings(options.env);
  if (settings === undefined) {
    throw new UsageError('No environment to read the database settings from.');
  }

  const check =
    options.check ??
    (async (context: CheckContext) =>
      await runChecks(DATABASE_CHECKS.filter((candidate) => EXISTENCE_CHECK_IDS.has(candidate.id)), context));

  const results = await check({
    runCommand: options.runCommand,
    deployRoot: '',
    bindPort: 0,
    proxyRoot: '',
    env: options.env,
  });
  for (const result of results) options.onLine?.(`${result.status} ${result.id}: ${result.detail}`);

  const failed = results.filter((result) => result.status === 'fail');
  if (failed.length === 0) {
    return { outcome: 'exists', database: settings.database, detail: `database "${settings.database}" exists` };
  }

  // Rule 1: anything but "absent" is reported, not acted on.
  if (!onlyDatabaseMissing(results)) {
    throw new PreconditionError(
      'The database is not usable with these settings:\n' +
        failed.map((result) => `  - ${result.detail}\n    ${result.remedy ?? ''}`).join('\n'),
    );
  }

  // Refused before anything else is asked: a name we would not create is not
  // worth a question.
  assertCreatableDatabaseName(settings.database);

  const capability = await canCreateDatabase(settings, options.runCommand);
  if (capability.canCreate === false) {
    throw new PreconditionError(
      `Database "${settings.database}" does not exist, and ${settings.user} is not allowed to create databases.\n` +
        `  Either have an administrator grant it: ALTER ROLE "${settings.user}" CREATEDB;\n` +
        `  or create it as a role that can: CREATE DATABASE "${settings.database}" OWNER "${settings.user}";`,
    );
  }
  if (capability.canCreate === undefined) {
    // Not a refusal: the CREATE below answers the question for certain.
    options.onLine?.(
      `could not tell whether ${settings.user} may create databases (${capability.error ?? 'unknown'}); will try`,
    );
  }

  const where = `${settings.host}:${settings.port}`;
  const consent = await obtainConsent(
    `Database "${settings.database}" does not exist on ${where}. Create it now as ${settings.user}?`,
    {
      flag: options.createDatabase,
      nonInteractive: options.nonInteractive,
      promptContext: options.promptContext,
      ask: options.ask,
    },
  );

  if (!consented(consent)) {
    throw new PreconditionError(
      (consent === 'declined'
        ? `Database "${settings.database}" does not exist, and creating it was declined.\n`
        : `Database "${settings.database}" does not exist on ${where}. ` +
          'Nothing could be asked in this mode, so it was not created. Re-run with --create-database to create it.\n') +
        `  ${remedyFor(settings)}`,
    );
  }

  options.onLine?.(`Creating database "${settings.database}" on ${where}`);
  const created = await runPsql(
    options.runCommand,
    settings,
    MAINTENANCE_DATABASE,
    createDatabaseStatement(settings.database),
  );

  // 42P04 duplicate_database: something else created it between the check and
  // now. The goal -- it exists -- is met, so that is not a failure.
  if (!created.ok && !/42P04|already exists/i.test(created.stderr)) {
    throw new PreconditionError(
      `Could not create database "${settings.database}": ${firstLine(created.stderr)}\n  ${remedyFor(settings)}`,
    );
  }

  // Confirmed rather than assumed: a CREATE that "succeeded" against the wrong
  // server would otherwise be discovered by the migration.
  const confirmed = await runPsql(options.runCommand, settings, settings.database, 'select 1');
  if (!confirmed.ok) {
    throw new PreconditionError(
      `Created database "${settings.database}", but could not connect to it afterwards: ${firstLine(confirmed.stderr)}`,
    );
  }

  return {
    outcome: 'created',
    database: settings.database,
    detail: `created database "${settings.database}" on ${where}`,
  };
}

function firstLine(text: string): string {
  return text.split('\n').find((line) => line.trim() !== '') ?? 'failed';
}
