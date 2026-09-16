import { UsageError } from '../errors.js';
import {
  DATABASE_CHECKS,
  databaseSettings,
  psql,
  runChecks,
  type CompletedCheck,
  type DatabaseSettings,
} from './checks/index.js';
import type { runCommand } from './executor.js';
import type { DeployHooks } from './hooks.js';
import { confirm, type PromptContext } from '../prompt.js';

// =============================================================================
// Creating the database that does not exist yet  (issue #391, epic #388)
// =============================================================================
//
// `database-exists` (#177) already reports a missing database and tells the
// operator to run `createdb`. This is the step that offers to run it - and the
// interesting part is not the SQL, it is WHY IT ASKS FIRST.
//
// "The database does not exist yet" and "you pointed at the wrong name" are
// INDISTINGUISHABLE FROM THE OUTSIDE. Both present as 3D000. Creating it
// silently means a typo in POSTGRES_DB produces a second, empty database, the
// migration succeeds against it, the seed succeeds against it, health goes
// green, and the operator's first evidence that anything is wrong is an
// application with none of their data in it - pointing at a database nobody
// meant to make, beside the real one nobody touched. The prompt is the only
// thing in this pipeline that can tell those two situations apart, because the
// person answering it is the only one who knows which name they meant.
//
// THREE RULES, ALL NON-NEGOTIABLE:
//
//   1. THE PASSWORD NEVER APPEARS IN AN ARGV. That is `psql`'s contract in
//      checks/database.ts - PGPASSWORD is passed by NAME and its value only in
//      the child's environment - and it is the reason this module reuses that
//      helper rather than assembling a command of its own.
//   2. THE NAME IS VALIDATED, THEN QUOTED. CREATE DATABASE takes an identifier,
//      not a parameter: there is no bind placeholder to hide behind. A name
//      that is not a plain identifier is REFUSED rather than escaped, because
//      a database this deployment could not afterwards address from a
//      connection string is not a database worth creating.
//   3. NOTHING EXISTING IS EVER DROPPED OR ALTERED. This module has exactly one
//      statement, and it is CREATE. A tool that can also destroy is a tool an
//      operator has to think about before running.
// =============================================================================

/**
 * A plain, unquoted PostgreSQL identifier.
 *
 * Deliberately narrower than what PostgreSQL will accept inside double quotes.
 * `POSTGRES_DB` also has to survive a shell in `scripts/prisma-env.js`, a URL
 * in `DATABASE_URL` and a compose file, and a name needing quotes in any one
 * of those is a name that will break something later on a day nobody
 * remembers this decision.
 */
export const DATABASE_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_$]*$/;

/** PostgreSQL's own limit; a longer name is silently truncated, not rejected. */
const MAX_IDENTIFIER_LENGTH = 63;

export function isValidDatabaseName(name: string): boolean {
  return name.length <= MAX_IDENTIFIER_LENGTH && DATABASE_NAME_PATTERN.test(name);
}

/** Refuses anything that is not a plain identifier. See rule 2. */
export function assertValidDatabaseName(name: string): void {
  if (!isValidDatabaseName(name)) {
    throw new UsageError(
      `"${name}" is not a usable database name, so it will not be created. Use letters, digits and underscores, starting with a letter or underscore (at most ${MAX_IDENTIFIER_LENGTH} characters), and set POSTGRES_DB to that.`,
    );
  }
}

/**
 * Quotes an identifier that has ALREADY been validated.
 *
 * The doubling rule is here for completeness and for the reader; it can never
 * fire, because `assertValidDatabaseName` has already refused every name that
 * contains a quote. Both are kept: the validation is the security boundary,
 * and the quoting is what stops a name that merely collides with a keyword
 * (`user`, `order`) from being a syntax error.
 */
export function quoteIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * What the database checks concluded, reduced to the three cases that matter.
 *
 *   `ok`       - it is there and usable.
 *   `missing`  - the server answered, the credentials worked, and the database
 *                is not there. The ONLY case this module acts on.
 *   `blocked`  - something else is wrong (unreachable, refused, wrong
 *                password). Creating a database is not the remedy for any of
 *                them, and trying would only replace a precise error with a
 *                vaguer one.
 *   `unknown`  - no environment resolved, so nothing is claimed.
 */
export type DatabaseVerdict = 'ok' | 'missing' | 'blocked' | 'unknown';

/** The three checks that decide the verdict, in their registry order. */
const VERDICT_CHECK_IDS = ['database-reachable', 'database-credentials', 'database-exists'];

/**
 * Reads a completed check run rather than probing again.
 *
 * Install already runs the database checks in `validate-environment`; asking
 * the same three questions a second time would double the psql containers and,
 * worse, could answer differently from the report the operator was just shown.
 */
export function classifyDatabase(results: readonly CompletedCheck[]): DatabaseVerdict {
  const byId = new Map(results.map((result) => [result.id, result]));
  const exists = byId.get('database-exists');

  if (exists === undefined) return 'unknown';
  if (exists.status === 'skip' && /no environment/i.test(exists.detail)) return 'unknown';
  if (exists.status === 'pass') return 'ok';

  const reachable = byId.get('database-reachable')?.status === 'pass';
  const credentials = byId.get('database-credentials')?.status === 'pass';
  if (!reachable || !credentials) return 'blocked';

  // 3D000 specifically. Any other failure against a reachable server with
  // working credentials is a problem creating a database would not fix.
  return /does not exist/i.test(exists.detail) ? 'missing' : 'blocked';
}

export interface AssessDatabaseOptions {
  runCommand: typeof runCommand;
  deployRoot: string;
  bindPort: number;
  proxyRoot: string;
  env?: ReadonlyMap<string, string> | undefined;
}

/** Runs the three checks and classifies them. For callers with no run to read. */
export async function assessDatabase(
  options: AssessDatabaseOptions,
): Promise<{ verdict: DatabaseVerdict; results: CompletedCheck[] }> {
  const results = await runChecks(
    DATABASE_CHECKS.filter((check) => VERDICT_CHECK_IDS.includes(check.id)),
    {
      runCommand: options.runCommand,
      deployRoot: options.deployRoot,
      bindPort: options.bindPort,
      proxyRoot: options.proxyRoot,
      ...(options.env === undefined ? {} : { env: options.env }),
    },
  );

  return { verdict: classifyDatabase(results), results };
}

export interface EnsureDatabaseOptions {
  runCommand: typeof runCommand;
  env: ReadonlyMap<string, string>;
  hooks?: DeployHooks | undefined;
  /** States the answer up front; required under --non-interactive. */
  createDatabase?: boolean | undefined;
  nonInteractive?: boolean | undefined;
  promptContext?: PromptContext | undefined;
  /** Asks the question; injected by the tests. Defaults to `confirm`. */
  confirm?: ((question: string) => Promise<boolean>) | undefined;
}

export type EnsureDatabaseOutcome = 'created' | 'declined';

export interface EnsureDatabaseResult {
  outcome: EnsureDatabaseOutcome;
  /** One line for the journal. Host, port, user and name only - never more. */
  detail: string;
  database: string;
}

/**
 * Creates the missing database, having asked.
 *
 * Called only when the verdict is `missing`; it does not re-derive that, so
 * the thing the operator was shown and the thing this acts on are the same
 * answer.
 */
export async function ensureDatabase(
  options: EnsureDatabaseOptions,
): Promise<EnsureDatabaseResult> {
  const settings = databaseSettings(options.env);
  if (settings === undefined) {
    throw new UsageError('No database settings were resolved, so there is nothing to create.');
  }

  // Refused BEFORE the question is asked: "shall I create <nonsense>?" is not
  // a question worth putting to anybody.
  assertValidDatabaseName(settings.database);

  const approved = await approve(options, settings);
  if (!approved) {
    return {
      outcome: 'declined',
      detail: `${settings.database} was not created`,
      database: settings.database,
    };
  }

  options.hooks?.onProgress?.(
    `Creating database ${settings.database} on ${settings.host}:${settings.port}`,
  );

  // Against `postgres`, the maintenance database every cluster has - the
  // database being created is by definition not connectable yet. Exactly one
  // statement, and it is CREATE: see rule 3.
  const result = await psql(
    { runCommand: options.runCommand },
    settings,
    'postgres',
    `CREATE DATABASE ${quoteIdentifier(settings.database)}`,
  );

  if (!result.ok) {
    // The two causes worth naming: a role without CREATEDB (which
    // `database-create-privilege` warned about before the install began), and
    // a race with somebody else creating the same name.
    if (/already exists/i.test(result.stderr)) {
      return {
        outcome: 'created',
        detail: `${settings.database} already existed`,
        database: settings.database,
      };
    }
    if (/permission denied|must be (a )?(super)?user|CREATEDB/i.test(result.stderr)) {
      throw new UsageError(
        `${settings.user} is not allowed to create databases, so ${settings.database} could not be created. Grant it (ALTER ROLE ${settings.user} CREATEDB;) or have an administrator create ${settings.database}, then re-run with --resume.`,
      );
    }
    throw new UsageError(
      `Could not create ${settings.database}: ${firstLine(result.stderr)}`,
    );
  }

  return {
    outcome: 'created',
    detail: `created ${settings.database} on ${settings.host}:${settings.port}`,
    database: settings.database,
  };
}

async function approve(
  options: EnsureDatabaseOptions,
  settings: DatabaseSettings,
): Promise<boolean> {
  if (options.createDatabase === true) return true;

  if (options.nonInteractive === true) {
    throw new UsageError(
      `The database "${settings.database}" does not exist on ${settings.host}:${settings.port}. Pass --create-database to have this run create it, or create it yourself and re-run. It is not created automatically because a typo in POSTGRES_DB looks exactly like this.`,
    );
  }

  const ask =
    options.confirm ??
    ((question: string) =>
      confirm(question, { defaultValue: false }, options.promptContext));

  return await ask(
    `The database "${settings.database}" does not exist on ${settings.host}:${settings.port}. Create it? (If that name is a typo, answer no and fix POSTGRES_DB — an empty database would migrate cleanly and look healthy.)`,
  );
}

function firstLine(text: string): string {
  return text.split('\n').find((line) => line.trim() !== '') ?? 'failed';
}
