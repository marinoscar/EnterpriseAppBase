import { UsageError } from '../errors.js';
import {
  DATABASE_CHECKS,
  databaseSettings,
  psql,
  runChecks,
  type CheckContext,
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

/**
 * The two checks a missing database can never excuse  (issue #396).
 *
 * "The database is not there" is recoverable; "the server is unreachable" and
 * "the password is wrong" are not, and creating a database is impossible in
 * both. They stay in every preflight, at `required`, whatever this run is
 * prepared to create - which is also what makes deferring the two below safe:
 * the condition being deferred has been narrowed to one an install can act on.
 */
export const DATABASE_GATE_CHECKS: readonly string[] = [
  'database-reachable',
  'database-credentials',
];

/**
 * The checks that describe a database this run is about to CREATE (#396).
 *
 * `database-exists` reports the very absence `offerDatabaseCreation` exists to
 * fix, and `database-privileges` only `requires` it - so with the database
 * absent it cannot report anything at all. `install`'s preflight drops both
 * when a creation is genuinely going to be offered, exactly as
 * `BOOTSTRAP_DEFERRED_CHECKS` drops the checks describing a proxy that is
 * about to be bootstrapped. ONE list, read twice: it is also what is re-run
 * after a successful creation, so the deferral and the re-verification cannot
 * drift apart.
 */
export const DATABASE_DEFERRED_CHECKS: readonly string[] = [
  'database-exists',
  'database-privileges',
];

/** The three checks that decide the verdict, in their registry order. */
const VERDICT_CHECK_IDS = [...DATABASE_GATE_CHECKS, 'database-exists'];

/** Everything the deferral held back, plus the two gates it never touched. */
const VERIFY_CHECK_IDS = [...DATABASE_GATE_CHECKS, ...DATABASE_DEFERRED_CHECKS];

/**
 * Only what talking to the configured database needs  (issue #396).
 *
 * The same narrowing `RenewalProbeContext` (checks/tls.ts) and
 * `CredentialProbeContext` (checks/gh.ts) make, and for the same reason: a
 * fork's own installer calling `offerDatabaseCreation` from inside its wizard
 * has a `runCommand` and an environment, and has no opinion about a bind port
 * or a proxy root. The database checks read neither, so demanding them would
 * be a lie about what this touches.
 */
export type DatabaseProbeContext = Pick<CheckContext, 'runCommand'> & {
  env: ReadonlyMap<string, string>;
};

/**
 * A `CheckContext` for the database checks alone.
 *
 * The three fields filled in here are structurally required by `CheckContext`
 * and provably unread by every check in `DATABASE_CHECKS` - each one reads
 * `runCommand` and `env` and nothing else. They are carried through when a
 * caller does have them, so a check that grows a use for one later sees the
 * real value rather than this placeholder.
 */
function databaseCheckContext(options: AssessDatabaseOptions): CheckContext {
  return {
    runCommand: options.runCommand,
    deployRoot: options.deployRoot ?? '',
    bindPort: options.bindPort ?? 0,
    proxyRoot: options.proxyRoot ?? '',
    env: options.env,
  };
}

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

export interface AssessDatabaseOptions extends DatabaseProbeContext {
  /** Carried through when the caller holds a full context; see above. */
  deployRoot?: string | undefined;
  bindPort?: number | undefined;
  proxyRoot?: string | undefined;
  /** Fires as each check completes, so a caller can journal the run. */
  onCheck?: ((result: CompletedCheck) => void) | undefined;
}

/** Runs the three checks and classifies them. For callers with no run to read. */
export async function assessDatabase(
  options: AssessDatabaseOptions,
): Promise<{ verdict: DatabaseVerdict; results: CompletedCheck[] }> {
  const results = await runDatabaseChecks(options, VERDICT_CHECK_IDS);
  return { verdict: classifyDatabase(results), results };
}

/** The named subset, in registry order, so `requires` is honoured. */
async function runDatabaseChecks(
  options: AssessDatabaseOptions,
  ids: readonly string[],
): Promise<CompletedCheck[]> {
  return await runChecks(
    DATABASE_CHECKS.filter((check) => ids.includes(check.id)),
    databaseCheckContext(options),
    options.onCheck,
  );
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

/**
 * The one sentence both refusal paths say  (issue #396).
 *
 * `ensureDatabase` throws it for a direct caller; `offerDatabaseCreation`
 * returns it as a `cannot` result for a pipeline that wants to decide for
 * itself where to stop. Two wordings of the same refusal is how an operator
 * ends up reading one message in the log and a different one on the terminal.
 */
export function nonInteractiveRefusal(settings: DatabaseSettings): string {
  return `The database "${settings.database}" does not exist on ${settings.host}:${settings.port}. Pass --create-database to have this run create it, or create it yourself and re-run. It is not created automatically because a typo in POSTGRES_DB looks exactly like this.`;
}

async function approve(
  options: EnsureDatabaseOptions,
  settings: DatabaseSettings,
): Promise<boolean> {
  if (options.createDatabase === true) return true;

  if (options.nonInteractive === true) {
    throw new UsageError(nonInteractiveRefusal(settings));
  }

  const ask =
    options.confirm ??
    ((question: string) =>
      confirm(question, { defaultValue: false }, options.promptContext));

  return await ask(
    `The database "${settings.database}" does not exist on ${settings.host}:${settings.port}. Create it? (If that name is a typo, answer no and fix POSTGRES_DB — an empty database would migrate cleanly and look healthy.)`,
  );
}

// =============================================================================
// Offer, create, verify  (issue #396, epic #388)
// =============================================================================
//
// One function, called by `install`'s `ensure-database` step, by `update`'s,
// and by any fork's own installer that runs these checks inside a wizard of its
// own. A second implementation of "is it missing, may I create it, did that
// work" is how the two drift until one of them forgets to ask.
//
// It does three things in order, and the third is the one #396 added: after a
// creation succeeds the DEFERRED CHECKS ARE RE-RUN, so `database-privileges`
// reports a real answer rather than `skipped: database-exists did not pass`.
// An operator who has just created a database wants to know whether the role
// can create tables in it - that is the next thing that would fail, and the
// migration is a much more expensive place to find out.
// =============================================================================

/** True when this run is in a position to offer creating the database. */
export function willOfferDatabaseCreation(options: {
  nonInteractive?: boolean | undefined;
  createDatabase?: boolean | undefined;
}): boolean {
  // Stated up front, so an unattended run may create one without prompting.
  if (options.createDatabase === true) return true;
  // Unattended runs must say so out loud; see `approve` above. `--non
  // -interactive` with no `--create-database` still fails, which is the whole
  // reason the deferral is conditional rather than unconditional.
  return options.nonInteractive !== true;
}

export interface OfferDatabaseOptions extends DatabaseProbeContext {
  /** Carried through when the caller holds a full context; see above. */
  deployRoot?: string | undefined;
  bindPort?: number | undefined;
  proxyRoot?: string | undefined;
  hooks?: DeployHooks | undefined;
  createDatabase?: boolean | undefined;
  nonInteractive?: boolean | undefined;
  promptContext?: PromptContext | undefined;
  /** Asks the question; injected by the tests. Defaults to `confirm`. */
  confirm?: ((question: string) => Promise<boolean>) | undefined;
  /**
   * A verdict the caller has already reached, from checks it already ran.
   *
   * Passed rather than re-probed wherever one exists: the thing the operator
   * was shown and the thing this acts on must be the same answer.
   */
  verdict?: DatabaseVerdict | undefined;
  /** A completed check run to classify, when the caller kept one. */
  results?: readonly CompletedCheck[] | undefined;
  /** Fires for every check this function runs itself. For the journal. */
  onCheck?: ((result: CompletedCheck) => void) | undefined;
}

/**
 * The result, discriminated so no caller has to infer what happened.
 *
 *   `created`    - it exists now, and `checks` says what is true of it.
 *   `declined`   - the operator said that name is not the one they meant.
 *   `not-needed` - it was already there.
 *   `cannot`     - creating it is not on the table, and `reason` says why.
 */
export type DatabaseCreationOutcome = 'created' | 'declined' | 'not-needed' | 'cannot';

export interface DatabaseCreatedResult {
  outcome: 'created';
  database: string;
  /** One line for the journal. Host, port, user and name only - never more. */
  detail: string;
  /** The deferred checks, re-run against the database that now exists. */
  checks: readonly CompletedCheck[];
  /** `database-privileges`' answer: the next thing that would fail. */
  privileges: CompletedCheck | undefined;
}

export interface DatabaseDeclinedResult {
  outcome: 'declined';
  database: string;
  detail: string;
  /** Written to be shown: it names POSTGRES_DB, because only a person knows. */
  reason: string;
}

export interface DatabaseNotNeededResult {
  outcome: 'not-needed';
  verdict: DatabaseVerdict;
  detail: string;
}

export interface DatabaseCannotResult {
  outcome: 'cannot';
  verdict: DatabaseVerdict;
  /**
   *   `non-interactive` - missing, but nothing may prompt and no flag said yes.
   *   `blocked`         - unreachable, refused, or a failure creating cannot fix.
   *   `unknown`         - nothing was resolved, so nothing is claimed.
   */
  reason: 'non-interactive' | 'blocked' | 'unknown';
  detail: string;
}

export type DatabaseCreationResult =
  | DatabaseCreatedResult
  | DatabaseDeclinedResult
  | DatabaseNotNeededResult
  | DatabaseCannotResult;

/**
 * Offers to create the database, creates it, and re-verifies it.
 *
 * NOTHING IS WRITTEN TO A TERMINAL from here: progress goes through `hooks`
 * and every conclusion comes back in the result, so the caller decides what a
 * `declined` or a `cannot` means for its own pipeline. It is deliberately not
 * a check - checks are read-only by rule 4 of `checks/types.ts`, which is why
 * `doctor` keeps failing on a missing database and `install` is what acts.
 */
export async function offerDatabaseCreation(
  options: OfferDatabaseOptions,
): Promise<DatabaseCreationResult> {
  const settings = databaseSettings(options.env);
  if (settings === undefined) {
    return {
      outcome: 'cannot',
      verdict: 'unknown',
      reason: 'unknown',
      detail: 'no database settings were resolved, so there is nothing to create',
    };
  }

  const verdict = await resolveVerdict(options);

  if (verdict === 'ok') {
    return {
      outcome: 'not-needed',
      verdict,
      detail: `${settings.database} already exists`,
    };
  }

  if (verdict !== 'missing') {
    return {
      outcome: 'cannot',
      verdict,
      reason: verdict === 'unknown' ? 'unknown' : 'blocked',
      // Left in the words of whatever check reported it: creating a database
      // is not the remedy for a refused connection or a wrong password, and
      // saying so again here would only make the real error harder to find.
      detail: `nothing to create (${verdict})`,
    };
  }

  if (!willOfferDatabaseCreation(options)) {
    // Refused as a RESULT rather than as a throw, so the caller can stop at
    // the earliest point its own pipeline allows. The sentence is the one
    // `ensureDatabase` would have thrown, to the character.
    return {
      outcome: 'cannot',
      verdict,
      reason: 'non-interactive',
      detail: nonInteractiveRefusal(settings),
    };
  }

  const result = await ensureDatabase({
    runCommand: options.runCommand,
    env: options.env,
    ...(options.hooks === undefined ? {} : { hooks: options.hooks }),
    ...(options.createDatabase === undefined
      ? {}
      : { createDatabase: options.createDatabase }),
    ...(options.nonInteractive === undefined
      ? {}
      : { nonInteractive: options.nonInteractive }),
    ...(options.promptContext === undefined
      ? {}
      : { promptContext: options.promptContext }),
    ...(options.confirm === undefined ? {} : { confirm: options.confirm }),
  });

  if (result.outcome === 'declined') {
    return {
      outcome: 'declined',
      database: result.database,
      detail: result.detail,
      reason: `${result.database} was not created. Check POSTGRES_DB: "does not exist yet" and "the wrong name" look identical from here, and only you can tell them apart.`,
    };
  }

  // The point of #396: the deferred checks, asked again now that the thing
  // they describe exists. `database-privileges` needs the two gates in the
  // same run to have anything to depend on, which is what VERIFY_CHECK_IDS is.
  const checks = await runDatabaseChecks(options, VERIFY_CHECK_IDS);
  const privileges = checks.find((check) => check.id === 'database-privileges');

  return {
    outcome: 'created',
    database: result.database,
    detail:
      privileges === undefined
        ? result.detail
        : `${result.detail}; ${privileges.detail}`,
    checks,
    privileges,
  };
}

async function resolveVerdict(options: OfferDatabaseOptions): Promise<DatabaseVerdict> {
  if (options.verdict !== undefined) return options.verdict;
  if (options.results !== undefined) return classifyDatabase(options.results);
  return (await assessDatabase(options)).verdict;
}

function firstLine(text: string): string {
  return text.split('\n').find((line) => line.trim() !== '') ?? 'failed';
}
