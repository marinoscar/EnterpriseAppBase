import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';

import { cliIdentity, cliName, envVar, hasCliIdentity } from '../identity.js';
import { PreconditionError, UsageError } from '../errors.js';
import {
  MAINTENANCE_DATABASE,
  databaseSettings,
  readRoleAttributes,
  runPsql,
  runPsqlScript,
  type DatabaseSettings,
  type RoleAttributes,
} from './checks/index.js';
import { canPrompt, promptSecret, type PromptContext } from '../prompt.js';
import { consented, obtainConsent, type ConsentOptions } from './consent.js';
import { metadataFor, type EnvVarMetadata } from './env-metadata.js';
import type { SecretEntry } from './journal.js';
import { CREATABLE_DATABASE_NAME } from './database.js';
import type { runCommand } from './executor.js';

// =============================================================================
// The dedicated application database role  (issue #980; builds on #725 PP-6.5)
// =============================================================================
//
// `deploy install` used to write whatever login the operator typed into `.env`
// as POSTGRES_USER / POSTGRES_PASSWORD. Operators naturally typed an
// ADMINISTRATIVE login (`postgres`, an RDS master user), the API then ran as a
// superuser, and row-level security -- which a superuser and a BYPASSRLS role
// skip entirely -- was inert: every organization could read every other's rows.
// The Doctor said so only after the deployment was live.
//
// So the install provisions the role the API runs as. RULES, each pinned by a
// test:
//
//   1. THE ADMINISTRATIVE LOGIN IS USED ONCE AND NEVER KEPT. It is held in
//      memory for the run: never in `.env`, the journal, the state file or an
//      error. What `.env` receives is the application role.
//   2. THE PASSWORD IS GENERATED, NEVER PROMPTED. 32 random bytes, base64url.
//      It reaches the server as a SCRAM-SHA-256 VERIFIER on psql's stdin -- not
//      argv (`ps`, the journal's argv record), and not as plaintext in the
//      server's statement log. It is shown only on request (`--show-credentials`).
//   3. IDEMPOTENT, ROTATED ONLY ON REQUEST. A role that exists and whose
//      recorded credentials still authenticate is reused untouched. A new
//      password is set only for `--rotate-app-password`, or when the role exists
//      and nothing on record opens it (a crashed first run).
//   4. OWNERSHIP IS TRANSFERRED OBJECT BY OBJECT (`ALTER ... OWNER TO`), NEVER
//      `REASSIGN OWNED BY`, which also moves objects in other databases and
//      cluster-level objects. Changing the owner of an existing, non-empty
//      database needs consent.
//   5. NEVER SILENTLY WEAKER. Where the administrator cannot grant CREATEROLE or
//      `createrole_self_grant` (managed providers), that is said, with what
//      stops working, and proceeding needs consent.
//   6. ONE FUNCTION. `ensureApplicationRole` is THE detect-offer-provision
//      behaviour. install's `environment` step and update's `database-role` step
//      both call it, and a fork's own wizard must too -- the argument
//      `ensureDatabase` makes (database.ts): two copies of a gate drift.
// =============================================================================

/** The role names this will create: the same conservative grammar as database names. */
export const CREATABLE_ROLE_NAME = CREATABLE_DATABASE_NAME;

const MAX_IDENTIFIER_BYTES = 63;

/** The `rolname` of the PostgreSQL default superuser; never a name to create. */
const RESERVED_ROLE = /^(pg_|postgres$|public$)/i;

/** Throws a UsageError unless `name` is a role this will create. */
export function assertCreatableRoleName(name: string): void {
  if (
    !CREATABLE_ROLE_NAME.test(name) ||
    Buffer.byteLength(name) > MAX_IDENTIFIER_BYTES ||
    RESERVED_ROLE.test(name)
  ) {
    throw new UsageError(
      `"${name}" is not a role name this will create: it must match ${CREATABLE_ROLE_NAME.source}, ` +
        `be at most ${MAX_IDENTIFIER_BYTES} bytes, and not be "postgres", "public" or start with "pg_". ` +
        'Pass another --app-db-user, or create the role by hand and pass --skip-role-provisioning.',
    );
  }
}

/** Validates, then double-quotes. The only way an identifier reaches a statement. */
export function quoteRole(name: string): string {
  assertCreatableRoleName(name);
  return `"${name}"`;
}

/** Quotes an administrative login for GRANT, which may be any name the server holds. */
function quoteAny(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function literal(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * `<app>_app`, from the product identity the CLI was configured with (the
 * repository name), so two applications on one cluster do not share a role.
 */
export function defaultAppRoleName(): string {
  const repo = hasCliIdentity() ? (cliIdentity().repoSlug.split('/')[1] ?? '') : '';
  const slug = repo
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const start = slug === '' ? 'app' : /^[a-z]/.test(slug) && !slug.startsWith('pg_') ? slug : `app_${slug}`;
  const base = start.slice(0, MAX_IDENTIFIER_BYTES - '_app'.length);
  return base.endsWith('_app') ? base : `${base}_app`;
}

/** 32 random bytes, URL-safe. Never prompted, never printed unless asked. */
export function generateAppPassword(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * The SCRAM-SHA-256 verifier PostgreSQL stores for a password (RFC 5802 as
 * PostgreSQL writes it). Sent instead of the password, so the plaintext is
 * never in a statement the server may log.
 */
export function scramSha256Verifier(password: string, salt: Buffer = randomBytes(16)): string {
  const iterations = 4096;
  const salted = pbkdf2Sync(password, salt, iterations, 32, 'sha256');
  const clientKey = createHmac('sha256', salted).update('Client Key').digest();
  const storedKey = createHash('sha256').update(clientKey).digest();
  const serverKey = createHmac('sha256', salted).update('Server Key').digest();
  return `SCRAM-SHA-256$${iterations}:${salt.toString('base64')}$${storedKey.toString('base64')}:${serverKey.toString('base64')}`;
}

// -- statements ---------------------------------------------------------------
//
// Built from validated, quoted identifiers; the one value (the verifier) is
// base64 and `$`/`:`, so quoting it as a literal cannot be broken out of.

/**
 * The attributes the role is created with; CREATEROLE follows separately (see
 * grants). NO PASSWORD: it is set last (`setPasswordStatement`), after `.env`
 * holds it, so a failure part-way never leaves a password nobody has.
 */
export function createRoleStatement(role: string): string {
  return `CREATE ROLE ${quoteRole(role)} LOGIN NOSUPERUSER NOBYPASSRLS CREATEDB`;
}

export function setPasswordStatement(role: string, verifier: string): string {
  return `ALTER ROLE ${quoteRole(role)} PASSWORD ${literal(verifier)}`;
}

/** A role that exists but cannot log in (NOLOGIN) is enabled, not left to fail at pg_hba. */
export function enableLoginStatement(role: string): string {
  return `ALTER ROLE ${quoteRole(role)} LOGIN`;
}

/** So the node-offload broker can mint per-job roles, as 10-application-role.sh does. */
export function grantCreateRoleStatement(role: string): string {
  return `ALTER ROLE ${quoteRole(role)} CREATEROLE`;
}

/**
 * PostgreSQL 16: a non-superuser CREATEROLE role is given ADMIN but neither
 * INHERIT nor SET on a role it creates, so it could create a job role and then
 * not DROP OWNED BY it. Restore and worker-node dumps depend on this.
 */
export function selfGrantStatement(role: string): string {
  return `ALTER ROLE ${quoteRole(role)} SET createrole_self_grant = 'inherit, set'`;
}

export function grantMembershipStatement(role: string, admin: string): string {
  return `GRANT ${quoteRole(role)} TO ${quoteAny(admin)}`;
}

export function revokeMembershipStatement(role: string, admin: string): string {
  return `REVOKE ${quoteRole(role)} FROM ${quoteAny(admin)}`;
}

/** The relation kinds that carry an owner we move: tables, partitioned, views, materialized, foreign, sequences, composite types. */
const OWNED_RELATIONS = `('r','p','v','m','f','S','c')`;

/** A sequence a column owns (serial/identity): it follows its table and cannot be re-owned alone. */
const LINKED_SEQUENCE = (alias: string): string =>
  `(${alias}.relkind = 'S' and exists (select 1 from pg_depend l where l.classid = 'pg_class'::regclass and l.objid = ${alias}.oid and l.refclassid = 'pg_class'::regclass and l.deptype in ('a','i')))`;

function ownerInfoStatement(role: string): string {
  assertCreatableRoleName(role);
  const owner = literal(role);
  const extension = (catalog: string, alias: string): string =>
    `not exists (select 1 from pg_depend e where e.classid = '${catalog}'::regclass and e.objid = ${alias}.oid and e.deptype = 'e')`;
  const objects = `c.relnamespace = s.oid and c.relkind in ${OWNED_RELATIONS} and ${extension('pg_class', 'c')}`;
  return (
    `select pg_get_userbyid(d.datdba) || '|' || pg_get_userbyid(s.nspowner) || '|' || ` +
    // What would MOVE: extension members are never re-owned, a column-linked sequence follows its table.
    `((select count(*) from pg_class c where ${objects} and not ${LINKED_SEQUENCE('c')} and pg_get_userbyid(c.relowner) <> ${owner}) + ` +
    `(select count(*) from pg_type t where t.typnamespace = s.oid and t.typtype in ('e','d','r') and pg_get_userbyid(t.typowner) <> ${owner} and ${extension('pg_type', 't')}) + ` +
    `(select count(*) from pg_proc p where p.pronamespace = s.oid and p.prokind in ('f','p') and pg_get_userbyid(p.proowner) <> ${owner} and ${extension('pg_proc', 'p')})) || '|' || ` +
    // What is THERE (for "does this database hold data").
    `(select count(*) from pg_class c where ${objects}) ` +
    `from pg_database d, pg_namespace s where d.datname = current_database() and s.nspname = 'public'`
  );
}

/**
 * Moves the database, schema `public` and every object in it to `role`, in ONE
 * transaction. Object by object with `ALTER ... OWNER TO`; there is no
 * `REASSIGN OWNED BY` here and a test keeps it that way (it also rewrites
 * ownership in OTHER databases and of cluster objects the role never owned).
 *
 * Extension-owned objects are skipped (they cannot be re-owned). A sequence a
 * column owns follows its table; one that is still owned by someone else when
 * its table is the role's is granted to the role instead, so the role can use
 * it. The database name is quoted, not validated: this only ever alters a
 * database that already exists, whatever it is called.
 */
export function ownershipScript(role: string, database: string): string {
  const target = literal(role);
  const notExtension = (catalog: string): string =>
    `NOT EXISTS (SELECT 1 FROM pg_depend e WHERE e.classid = '${catalog}'::regclass AND e.objid = o.oid AND e.deptype = 'e')`;
  return [
    'BEGIN;',
    `ALTER DATABASE ${quoteAny(database)} OWNER TO ${quoteRole(role)};`,
    'DO $ownership$',
    'DECLARE',
    `  target constant text := ${target};`,
    '  item record;',
    'BEGIN',
    // PostgreSQL 15+: `public` belongs to pg_database_owner, which is the new database owner already.
    "  IF (SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname = 'public') NOT IN (target, 'pg_database_owner') THEN",
    "    EXECUTE format('ALTER SCHEMA public OWNER TO %I', target);",
    '  END IF;',
    '  FOR item IN',
    "    SELECT o.relname AS name, CASE o.relkind WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW' WHEN 'f' THEN 'FOREIGN TABLE' WHEN 'c' THEN 'TYPE' ELSE 'TABLE' END AS kind",
    '    FROM pg_class o JOIN pg_namespace n ON n.oid = o.relnamespace',
    `    WHERE n.nspname = 'public' AND o.relkind IN ('r','p','v','m','f','c') AND pg_get_userbyid(o.relowner) <> target AND ${notExtension('pg_class')}`,
    '    ORDER BY o.oid',
    '  LOOP',
    "    EXECUTE format('ALTER %s public.%I OWNER TO %I', item.kind, item.name, target);",
    '  END LOOP;',
    '  FOR item IN',
    '    SELECT o.relname AS name, EXISTS (SELECT 1 FROM pg_depend l WHERE l.classid = \'pg_class\'::regclass AND l.objid = o.oid AND l.refclassid = \'pg_class\'::regclass AND l.deptype IN (\'a\',\'i\')) AS linked',
    '    FROM pg_class o JOIN pg_namespace n ON n.oid = o.relnamespace',
    `    WHERE n.nspname = 'public' AND o.relkind = 'S' AND pg_get_userbyid(o.relowner) <> target AND ${notExtension('pg_class')}`,
    '    ORDER BY o.oid',
    '  LOOP',
    '    IF item.linked THEN',
    "      EXECUTE format('GRANT ALL ON SEQUENCE public.%I TO %I', item.name, target);",
    '    ELSE',
    "      EXECUTE format('ALTER SEQUENCE public.%I OWNER TO %I', item.name, target);",
    '    END IF;',
    '  END LOOP;',
    '  FOR item IN',
    "    SELECT o.typname AS name, CASE o.typtype WHEN 'd' THEN 'DOMAIN' ELSE 'TYPE' END AS kind",
    '    FROM pg_type o JOIN pg_namespace n ON n.oid = o.typnamespace',
    `    WHERE n.nspname = 'public' AND o.typtype IN ('e','d','r') AND pg_get_userbyid(o.typowner) <> target AND ${notExtension('pg_type')}`,
    '    ORDER BY o.oid',
    '  LOOP',
    "    EXECUTE format('ALTER %s public.%I OWNER TO %I', item.kind, item.name, target);",
    '  END LOOP;',
    '  FOR item IN',
    "    SELECT o.oid::regprocedure::text AS name, CASE o.prokind WHEN 'p' THEN 'PROCEDURE' ELSE 'FUNCTION' END AS kind",
    '    FROM pg_proc o JOIN pg_namespace n ON n.oid = o.pronamespace',
    `    WHERE n.nspname = 'public' AND o.prokind IN ('f','p') AND pg_get_userbyid(o.proowner) <> target AND ${notExtension('pg_proc')}`,
    '    ORDER BY o.oid',
    '  LOOP',
    "    EXECUTE format('ALTER %s %s OWNER TO %I', item.kind, item.name, target);",
    '  END LOOP;',
    'END',
    '$ownership$;',
    'COMMIT;',
    '',
  ].join('\n');
}

/**
 * The role a run provisions: the flag; else the application login a previous
 * run recorded (so a re-run finds ITS role instead of making a second); else
 * `<app>_app`. A recorded name that is the administrative login, or one this
 * would not create (`postgres`), is no application role and is passed over.
 */
export function plannedRoleName(input: {
  flag?: string | undefined;
  recordedUser?: string | undefined;
  adminUser?: string | undefined;
}): string {
  if (input.flag !== undefined) return input.flag;
  const recorded = input.recordedUser;
  if (
    recorded !== undefined &&
    recorded !== input.adminUser &&
    CREATABLE_ROLE_NAME.test(recorded) &&
    Buffer.byteLength(recorded) <= MAX_IDENTIFIER_BYTES &&
    !RESERVED_ROLE.test(recorded)
  ) {
    return recorded;
  }
  return defaultAppRoleName();
}

// -- the options the commands share ---------------------------------------------

/**
 * The application-role options `install` and `update` share (#980). Flat on
 * purpose: the TUI sets toggles as top-level option keys.
 */
export interface AppRoleOptions {
  /** `--app-db-user`. */
  appDbUser?: string | undefined;
  /** `--admin-user`; the password is never a flag (see `resolveAdminLogin`). */
  adminUser?: string | undefined;
  /** From the answers file (`DB_ADMIN_PASSWORD`) or the environment; never argv. */
  adminPassword?: string | undefined;
  /** `--skip-role-provisioning`. */
  skipRoleProvisioning?: boolean | undefined;
  /** `--allow-superuser`. */
  allowSuperuser?: boolean | undefined;
  /** `--rotate-app-password`. */
  rotateAppPassword?: boolean | undefined;
  /** `--provision-app-role`. */
  provisionAppRole?: boolean | undefined;
  /** `--transfer-ownership`. */
  transferOwnership?: boolean | undefined;
  /** `--allow-reduced-role`. */
  allowReducedRole?: boolean | undefined;
  /** `--show-credentials`. */
  showCredentials?: boolean | undefined;
}

/** The answers-file keys that feed `AppRoleOptions`; none of them ever reaches `.env`. */
export const APP_ROLE_ANSWER_KEYS = ['DB_ADMIN_USER', 'DB_ADMIN_PASSWORD', 'APP_DB_USER'] as const;

/**
 * Splits the role keys out of an answers map. They are INPUT to provisioning,
 * not environment: left in the map they would be written to `.env` as unknown
 * keys -- the administrative password included, which must never be on disk.
 */
export function extractRoleAnswers(answers: ReadonlyMap<string, string> | undefined): {
  answers: Map<string, string> | undefined;
  role: Pick<AppRoleOptions, 'adminUser' | 'adminPassword' | 'appDbUser'>;
} {
  if (answers === undefined) return { answers: undefined, role: {} };
  const rest = new Map(answers);
  const take = (key: (typeof APP_ROLE_ANSWER_KEYS)[number]): string | undefined => {
    const value = rest.get(key);
    rest.delete(key);
    return value === undefined || value === '' ? undefined : value;
  };
  const adminUser = take('DB_ADMIN_USER');
  const adminPassword = take('DB_ADMIN_PASSWORD');
  const appDbUser = take('APP_DB_USER');
  return {
    answers: rest.size === 0 ? undefined : rest,
    role: {
      ...(adminUser === undefined ? {} : { adminUser }),
      ...(adminPassword === undefined ? {} : { adminPassword }),
      ...(appDbUser === undefined ? {} : { appDbUser }),
    },
  };
}

/**
 * The explicit administrative login, or undefined when none was named. The
 * password comes from the options (an answers file), then the environment
 * (`<PREFIX>DB_ADMIN_PASSWORD`, so it is in neither argv nor shell history),
 * then -- on a terminal -- a masked prompt. It is held in memory only.
 */
export async function resolveAdminLogin(
  options: Pick<AppRoleOptions, 'adminUser' | 'adminPassword'>,
  prompt: { promptContext?: PromptContext | undefined; nonInteractive?: boolean | undefined },
): Promise<AdminLogin | undefined> {
  if (options.adminUser === undefined) return undefined;
  const fromEnvironment = process.env[envVar('DB_ADMIN_PASSWORD')];
  const supplied = options.adminPassword ?? (fromEnvironment === '' ? undefined : fromEnvironment);
  if (supplied !== undefined) return { user: options.adminUser, password: supplied };
  if (prompt.nonInteractive !== true && canPrompt(prompt.promptContext)) {
    const typed = await promptSecret(
      `  Password for the administrative login "${options.adminUser}" (used once, not saved): `,
      prompt.promptContext,
    );
    if (typed !== '') return { user: options.adminUser, password: typed };
  }
  throw new UsageError(
    `--admin-user ${options.adminUser} needs its password. It is never a flag: set ${envVar('DB_ADMIN_PASSWORD')} in the environment, ` +
      'or put DB_ADMIN_PASSWORD in the answers file (neither is written to .env).',
  );
}

/**
 * The wizard's view of POSTGRES_USER / POSTGRES_PASSWORD when an explicit
 * administrative login is in use: they are decided by provisioning, so they are
 * not asked. Both are overwritten with the real values before anything is written.
 */
export function provisioningMetadata(role: string): (key: string) => EnvVarMetadata {
  return (key) => {
    const base = metadataFor(key);
    if (key === 'POSTGRES_USER') return { ...base, essential: false, fixed: role };
    if (key === 'POSTGRES_PASSWORD') return { ...base, essential: false, fixed: '(set by role provisioning)' };
    return base;
  };
}

/**
 * The wizard's view of POSTGRES_USER when the operator is simply asked for a
 * login: the prompt says an administrative one is fine, because it is used once
 * and replaced. (`metadataFor` itself stays as it was: it is pinned by
 * env-metadata-equivalence.test.ts, and this help belongs to install.)
 */
export function loginHelpMetadata(key: string): EnvVarMetadata {
  const base = metadataFor(key);
  if (key !== 'POSTGRES_USER') return base;
  return {
    ...base,
    help:
      'The database login. An administrative login is fine: it is used once to create a dedicated\n' +
      'ordinary role for the application (row-level security does not apply to a superuser), and the\n' +
      "role's generated credentials, not these, are saved to .env.",
  };
}

/** The options `ensureApplicationRole` takes from the shared flags. */
export function roleOptionsFrom(
  options: AppRoleOptions & Omit<ConsentOptions, 'flag'>,
  admin: AdminLogin | undefined,
): Pick<
  EnsureApplicationRoleOptions,
  | 'admin'
  | 'roleName'
  | 'skip'
  | 'allowSuperuser'
  | 'rotate'
  | 'provisionConsent'
  | 'transferOwnership'
  | 'allowReducedRole'
  | 'nonInteractive'
  | 'promptContext'
  | 'ask'
> {
  return {
    admin,
    roleName: options.appDbUser,
    skip: options.skipRoleProvisioning,
    allowSuperuser: options.allowSuperuser,
    rotate: options.rotateAppPassword,
    provisionConsent: options.provisionAppRole,
    transferOwnership: options.transferOwnership,
    allowReducedRole: options.allowReducedRole,
    nonInteractive: options.nonInteractive,
    promptContext: options.promptContext,
    ask: options.ask,
  };
}

// -- the one implementation ---------------------------------------------------

export interface AdminLogin {
  user: string;
  password: string;
}

export interface EnsureApplicationRoleOptions extends Omit<ConsentOptions, 'flag'> {
  /**
   * POSTGRES_* as they stand: the login the operator entered (install) or the
   * deployment's `.env` (update). Host, port, database and TLS come from here.
   */
  env: ReadonlyMap<string, string>;
  /** The `.env` on disk before this run, for the credentials a previous run recorded. */
  recordedEnv?: ReadonlyMap<string, string> | undefined;
  runCommand: typeof runCommand;
  /** Where to report, one line at a time. Never carries a secret. */
  onLine?: ((line: string) => void) | undefined;
  /** `--admin-user` and its password: the administrative login, instead of the entered one. */
  admin?: AdminLogin | undefined;
  /** `--app-db-user`: the role to provision. Default `<app>_app`. */
  roleName?: string | undefined;
  /** `--skip-role-provisioning`: the operator supplies an ordinary role. */
  skip?: boolean | undefined;
  /** `--allow-superuser`: run as a privileged login knowingly. */
  allowSuperuser?: boolean | undefined;
  /** `--rotate-app-password`. */
  rotate?: boolean | undefined;
  /** `--provision-app-role`: consent, in advance, to provision when a privileged login is found. */
  provisionConsent?: boolean | undefined;
  /** `--transfer-ownership`: consent, in advance, to change the owner of an existing database's objects. */
  transferOwnership?: boolean | undefined;
  /** `--allow-reduced-role`: consent, in advance, to a role the server would not give every attribute. */
  allowReducedRole?: boolean | undefined;
  /**
   * What not being consented means. install `refuse`s (it will not start an API
   * as a superuser unasked); update `warn`s and carries on, because an
   * unattended `update` must not start failing on a deployment that predates
   * this.
   */
  whenNotConsented: 'refuse' | 'warn';
  /** Replaces the password generator; the test seam. */
  generatePassword?: (() => string) | undefined;
  /**
   * Where the application login is stored (`.env`). When given, the new login is
   * written there BEFORE the server's password is changed and put back if the
   * change fails, so `.env` and the server never disagree about a password that
   * was lost. Absent: the caller writes `result.credentials` itself.
   */
  store?: CredentialStore | undefined;
  /**
   * Told about every secret the moment it exists -- the generated password and
   * its verifier -- BEFORE any statement carries them, so the journal's redactor
   * has them for every line that follows.
   */
  onSecrets?: ((secrets: readonly SecretEntry[]) => void) | undefined;
}

/**
 * Where the application login lives (the deployment's `.env`), written
 * atomically at 0600 by the caller's own writer.
 */
export interface CredentialStore {
  /** Writes the login. Throws when it cannot: nothing on the server has changed yet. */
  write(credentials: { user: string; password: string }): void | Promise<void>;
  /** Puts back exactly what was there before `write`. */
  restore(): void | Promise<void>;
}

export type ApplicationRoleOutcome =
  /** The login is already an ordinary role; nothing to do. */
  | 'ordinary'
  /** `--skip-role-provisioning`. */
  | 'skipped'
  /** The login is privileged and `--allow-superuser` says to keep it. */
  | 'superuser-allowed'
  /** The database could not be reached to find out; `validate-environment` reports it. */
  | 'unknown'
  /** Privileged login, provisioning not consented (update only; install refuses). */
  | 'declined'
  /** The role exists and is configured; the deployment moves onto it. */
  | 'provisioned'
  /** Only the password was replaced. */
  | 'rotated';

export interface ApplicationRoleResult {
  outcome: ApplicationRoleOutcome;
  detail: string;
  /** The role the deployment runs as. Absent for the outcomes that change nothing. */
  roleName?: string | undefined;
  /**
   * What `.env` must now hold. Present when POSTGRES_USER / POSTGRES_PASSWORD
   * change. The password is a SECRET: the caller writes it to `.env` and
   * registers it with the journal's redactor, and shows it only on request.
   */
  credentials?: { user: string; password: string } | undefined;
  created: boolean;
  ownershipTransferred: boolean;
  /** Attributes the server would not grant, accepted with consent. */
  degraded: string[];
}

function unchanged(outcome: ApplicationRoleOutcome, detail: string): ApplicationRoleResult {
  return { outcome, detail, created: false, ownershipTransferred: false, degraded: [] };
}

function firstLine(text: string): string {
  return text.split('\n').find((line) => line.trim() !== '') ?? 'failed';
}

interface RoleRow extends RoleAttributes {
  canLogin: boolean;
}

function parseRoleRow(stdout: string): RoleRow | undefined {
  const fields = stdout.trim().split('|');
  if (fields.length !== 5 || fields.some((field) => field !== 't' && field !== 'f')) return undefined;
  return {
    superuser: fields[0] === 't',
    bypassRls: fields[1] === 't',
    createRole: fields[2] === 't',
    createDb: fields[3] === 't',
    canLogin: fields[4] === 't',
  };
}

interface OwnerInfo {
  databaseOwner: string;
  schemaOwner: string;
  toMove: number;
  total: number;
}

function parseOwnerInfo(stdout: string): OwnerInfo | undefined {
  const fields = stdout.trim().split('|');
  if (fields.length !== 4) return undefined;
  const toMove = Number(fields[2]);
  const total = Number(fields[3]);
  if (!Number.isInteger(toMove) || !Number.isInteger(total)) return undefined;
  return { databaseOwner: fields[0] as string, schemaOwner: fields[1] as string, toMove, total };
}

/** A failure that means "the administrator is not allowed to", on a managed provider above all. */
const NOT_PERMITTED = /permission denied|must have createrole|must be superuser|not permitted|insufficient_privilege|42501/i;

/** The sentence that says what a missing attribute costs. */
const CONSEQUENCE: Readonly<Record<string, string>> = {
  CREATEROLE:
    'worker-node offload cannot mint per-job roles for database dumps (a node-eligible job that needs one fails)',
  createrole_self_grant:
    "database restore and worker-node dumps cannot use or drop the roles the application creates (PostgreSQL 16 gives a CREATEROLE role ADMIN but neither INHERIT nor SET on a role it creates)",
  CREATEDB: 'database restore cannot create, rename or drop databases',
};

/**
 * Makes sure the deployment runs as a dedicated, ordinary role: detects a
 * privileged login, offers to provision a role, provisions it, and moves
 * ownership of the application database to it.
 *
 * ⚠ THIS IS THE ONE IMPLEMENTATION (#980). install's `environment` step and
 * update's `database-role` step call it, and a fork's own wizard MUST call it
 * rather than reimplement any part of "detect, offer, provision, transfer":
 * the consent rules, the statements and the refusals are all here so that no
 * two callers can disagree about them.
 *
 * ORDER OF EFFECTS, because a password lost between the server and `.env` locks
 * the application out of its own database:
 *
 *   1. everything is read and every consent obtained before the server is
 *      touched, so a "no", a refusal or an unreadable answer changes nothing;
 *   2. then the role, its attributes and the ownership (none of which carry a
 *      secret);
 *   3. the PASSWORD LAST: the new login is written to `.env` first
 *      (`options.store`, atomic, 0600), then `ALTER ROLE ... PASSWORD`, then the
 *      role logs in once as proof. A failure at the `ALTER` puts the old `.env`
 *      back; a failure after it keeps the password the server now has.
 */
export async function ensureApplicationRole(
  options: EnsureApplicationRoleOptions,
): Promise<ApplicationRoleResult> {
  const progress = { mutated: false };
  try {
    return await provision(options, progress);
  } catch (error) {
    // update must not start failing on a deployment that predates this: anything
    // that goes wrong BEFORE the server was changed is a warning there, not a failure.
    if (
      !progress.mutated &&
      options.whenNotConsented === 'warn' &&
      (error instanceof PreconditionError || error instanceof UsageError)
    ) {
      options.onLine?.(error.message);
      return unchanged('declined', error.message);
    }
    throw error;
  }
}

/** psql's answer to "may this role log in with that password?", kept apart from "wrong password". */
type LoginProbe = 'ok' | 'rejected' | 'unknown';

/**
 * Whether `user` opens `database` with `password`. Only a rejected PASSWORD is
 * `rejected`: a pg_hba.conf refusal, a revoked CONNECT, a timeout or anything
 * else is `unknown`, because resetting a password fixes none of them.
 */
async function probeLogin(
  run: typeof runCommand,
  settings: DatabaseSettings,
  database: string,
): Promise<{ result: LoginProbe; detail: string }> {
  const answer = await runPsql(run, settings, database, 'select 1');
  if (answer.ok) return { result: 'ok', detail: '' };
  if (/28P01|password authentication failed/i.test(answer.stderr)) {
    return { result: 'rejected', detail: firstLine(answer.stderr) };
  }
  return { result: 'unknown', detail: firstLine(answer.stderr) };
}

async function provision(
  options: EnsureApplicationRoleOptions,
  progress: { mutated: boolean },
): Promise<ApplicationRoleResult> {
  const line = (text: string): void => options.onLine?.(text);
  const entered = databaseSettings(options.env);
  if (entered === undefined) throw new UsageError('No environment to read the database settings from.');

  if (options.skip === true) {
    line('--skip-role-provisioning: no role is created; database-role-ordinary verifies the one supplied');
    return unchanged('skipped', 'role provisioning skipped');
  }

  const explicit = options.admin !== undefined;
  const connection: DatabaseSettings = explicit
    ? { ...entered, user: (options.admin as AdminLogin).user, password: (options.admin as AdminLogin).password }
    : entered;
  const adminName = connection.user;

  // 1. Who is this login?
  const probe = await readRoleAttributes(options.runCommand, connection);
  if (probe.attributes === undefined) {
    if (explicit) {
      throw new PreconditionError(
        `Could not connect to ${connection.host}:${connection.port} as the administrative login "${adminName}": ${probe.error ?? 'unknown error'}\n` +
          '  Check --admin-user and the administrative password.',
      );
    }
    line(`could not tell whether ${adminName} is an ordinary role (${probe.error ?? 'unknown'}); the database checks report it`);
    return unchanged('unknown', 'the database could not be queried');
  }
  const attributes = probe.attributes;
  const privileged = attributes.superuser || attributes.bypassRls;

  if (!explicit && !privileged) {
    if (options.rotate === true) return await rotateOwnPassword(options, entered, progress);
    line(`${adminName} is an ordinary role: nothing to provision`);
    return unchanged('ordinary', `${adminName} is an ordinary role`);
  }

  if (!explicit && options.allowSuperuser === true) {
    line(
      `--allow-superuser: running as ${adminName}, ${privilegeWords(attributes)}. Row-level security is INERT: every organization can read every other organization's rows.`,
    );
    return unchanged('superuser-allowed', `${adminName} kept (tenant isolation OFF)`);
  }

  // 2. The role this will provision.
  const recorded = options.recordedEnv;
  const roleName = plannedRoleName({
    flag: options.roleName,
    recordedUser: recorded?.get('POSTGRES_USER'),
    adminUser: adminName,
  });
  assertCreatableRoleName(roleName);
  if (roleName === adminName) {
    throw new UsageError(
      `The application role cannot be the administrative login "${adminName}". Pass a different --app-db-user.`,
    );
  }
  const existingPassword =
    recorded?.get('POSTGRES_USER') === roleName ? recorded.get('POSTGRES_PASSWORD') : undefined;

  const notConsented = (reason: string): ApplicationRoleResult => {
    if (options.whenNotConsented === 'warn') {
      line(reason);
      return unchanged('declined', reason);
    }
    throw new PreconditionError(reason);
  };

  // 3. Consent to provision at all. An explicit administrative login IS that
  // consent: the operator supplied it for this purpose.
  if (!explicit) {
    const consent = await obtainConsent(
      `"${adminName}" is ${privilegeWords(attributes)}, so row-level security would be inert and every organization could read every other's data. ` +
        `Create a dedicated ordinary role "${roleName}" now, using "${adminName}" once (its password is held in memory and not saved)?`,
      {
        flag: options.provisionConsent,
        nonInteractive: options.nonInteractive,
        promptContext: options.promptContext,
        ask: options.ask,
      },
    );
    if (!consented(consent)) {
      return notConsented(
        (consent === 'declined'
          ? `Provisioning a dedicated database role was declined, and "${adminName}" is ${privilegeWords(attributes)}.`
          : `"${adminName}" is ${privilegeWords(attributes)}, and nothing could be asked in this mode.`) +
          ` Row-level security would be inert. Re-run with --provision-app-role to create "${roleName}" and move the deployment onto it, ` +
          'pass --skip-role-provisioning with an ordinary POSTGRES_USER, or --allow-superuser to run as this login knowingly.',
      );
    }
  }

  const maintenance: DatabaseSettings = { ...connection, database: MAINTENANCE_DATABASE };

  // 4. What is there already: the role, the database, who owns what.
  const roleProbe = await runPsql(
    options.runCommand,
    maintenance,
    MAINTENANCE_DATABASE,
    `select rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolcanlogin from pg_roles where rolname = ${literal(roleName)}`,
  );
  if (!roleProbe.ok) throw new PreconditionError(`Could not look up role "${roleName}": ${firstLine(roleProbe.stderr)}`);
  const existing = roleProbe.stdout.trim() === '' ? undefined : parseRoleRow(roleProbe.stdout);
  if (roleProbe.stdout.trim() !== '' && existing === undefined) {
    throw new PreconditionError(`Could not read the attributes of role "${roleName}" (unexpected answer).`);
  }
  if (existing !== undefined && (existing.superuser || existing.bypassRls)) {
    throw new PreconditionError(
      `Role "${roleName}" already exists and is ${privilegeWords(existing)}. It is not altered or used. ` +
        'Choose another name with --app-db-user, or fix the role yourself: ' +
        `ALTER ROLE ${quoteRole(roleName)} NOSUPERUSER NOBYPASSRLS;`,
    );
  }

  const databaseProbe = await runPsql(
    options.runCommand,
    maintenance,
    MAINTENANCE_DATABASE,
    `select 1 from pg_database where datname = ${literal(entered.database)}`,
  );
  const databaseExists = databaseProbe.ok && databaseProbe.stdout.trim() === '1';
  // The role is proven, and its recorded password probed, against the database
  // it will actually use once that exists: the maintenance database says nothing
  // about CONNECT on the application database or a pg_hba.conf line for it.
  const probeDatabase = databaseExists ? entered.database : MAINTENANCE_DATABASE;

  let owners: OwnerInfo | undefined;
  if (databaseExists) {
    const info = await runPsql(
      options.runCommand,
      connection,
      entered.database,
      ownerInfoStatement(roleName),
    );
    if (!info.ok) {
      throw new PreconditionError(
        `Could not read who owns database "${entered.database}": ${firstLine(info.stderr)}`,
      );
    }
    owners = parseOwnerInfo(info.stdout);
    if (owners === undefined) line(`could not read the ownership of "${entered.database}"; ownership is left as it is`);
  }
  const needsTransfer =
    owners !== undefined &&
    (owners.databaseOwner !== roleName ||
      (owners.schemaOwner !== roleName && owners.schemaOwner !== 'pg_database_owner') ||
      owners.toMove > 0);

  // 5. Consent to change the owner of an existing, non-empty database.
  if (needsTransfer && owners !== undefined && owners.total > 0) {
    line(
      `Database "${entered.database}" already holds ${owners.total} object(s); the database is owned by ${owners.databaseOwner}. ` +
        `They will be re-owned to "${roleName}" with ALTER ... OWNER TO (never REASSIGN OWNED BY). Take a backup first: pg_dump, or your provider's snapshot.`,
    );
    const consent = await obtainConsent(
      `Change the owner of "${entered.database}" and its ${owners.total} existing object(s) to "${roleName}"? A backup is recommended and this is hard to undo.`,
      {
        flag: options.transferOwnership,
        nonInteractive: options.nonInteractive,
        promptContext: options.promptContext,
        ask: options.ask,
      },
    );
    if (!consented(consent)) {
      return notConsented(
        (consent === 'declined'
          ? `Changing the owner of database "${entered.database}" was declined.`
          : `Database "${entered.database}" already holds data and changing its owner needs consent; nothing could be asked in this mode.`) +
          ' Nothing was changed. Back up the database, then re-run with --transfer-ownership.',
      );
    }
  }

  // 6. The password: reuse what authenticates. A role that ALREADY EXISTS is
  // somebody's -- staging and production of one fork on one cluster default to
  // the same `<repo>_app` -- so its password is never reset because the
  // credentials on record merely fail: that needs --rotate-app-password, or a
  // yes that names the role.
  let reuse = false;
  if (existing !== undefined && options.rotate !== true) {
    if (existingPassword !== undefined && existingPassword !== '') {
      const login = await probeLogin(
        options.runCommand,
        { ...maintenance, user: roleName, password: existingPassword },
        probeDatabase,
      );
      if (login.result === 'ok') {
        reuse = true;
      } else if (login.result === 'unknown') {
        throw new PreconditionError(
          `Could not check the credentials on record for role "${roleName}" (${login.detail}). ` +
            'That is not a wrong password (a pg_hba.conf line, a revoked CONNECT or the network), so its password was left as it is. ' +
            'Fix the connection and re-run; --rotate-app-password sets a new password regardless.',
        );
      }
    }
    if (!reuse) {
      const why =
        existingPassword === undefined || existingPassword === ''
          ? 'nothing on record opens it'
          : 'the password on record is rejected';
      const consent = await obtainConsent(
        `Role "${roleName}" already exists and ${why}. It may belong to another deployment on this cluster, or to an earlier install that died. ` +
          `Set a NEW password for "${roleName}"? Whatever uses its current password is locked out.`,
        {
          flag: undefined,
          nonInteractive: options.nonInteractive,
          promptContext: options.promptContext,
          ask: options.ask,
        },
      );
      if (!consented(consent)) {
        throw new PreconditionError(
          `Role "${roleName}" already exists and ${why}, so its password was not changed. ` +
            `If it belongs to another deployment on this cluster, choose a different role with --app-db-user. ` +
            `If it is this deployment's (an earlier install died), re-run with --rotate-app-password to set a new password.`,
        );
      }
    }
  }
  const generate = options.generatePassword ?? generateAppPassword;
  const password = reuse ? (existingPassword as string) : generate();
  const verifier = reuse ? '' : scramSha256Verifier(password);
  // Before any statement carries them.
  if (!reuse) {
    options.onSecrets?.([
      { key: 'POSTGRES_PASSWORD', value: password },
      { key: 'POSTGRES_PASSWORD_VERIFIER', value: verifier },
    ]);
  }
  const secrets = [password, verifier, connection.password].filter((secret) => secret !== '');
  const script = async (database: string, sql: string): Promise<{ ok: boolean; stderr: string }> => {
    const result = await runPsqlScript(options.runCommand, connection, database, sql, { secrets });
    return { ok: result.ok, stderr: result.stderr };
  };

  // 7. The role. From here the server changes.
  progress.mutated = true;
  let created = false;
  const degraded: string[] = [];
  if (existing === undefined) {
    const result = await script(MAINTENANCE_DATABASE, `${createRoleStatement(roleName)};\n`);
    if (!result.ok) {
      throw new PreconditionError(
        NOT_PERMITTED.test(result.stderr)
          ? `"${adminName}" is not allowed to create roles on ${entered.host}:${entered.port} (${firstLine(result.stderr)}).\n` +
              `  Grant it (ALTER ROLE ${quoteAny(adminName)} CREATEROLE;) or use the provider's master login, or create the role by hand:\n` +
              `    CREATE ROLE ${quoteRole(roleName)} LOGIN NOSUPERUSER NOBYPASSRLS CREATEDB CREATEROLE PASSWORD '<password>';\n` +
              '  then re-run with --skip-role-provisioning and that POSTGRES_USER / POSTGRES_PASSWORD.'
          : `Could not create role "${roleName}": ${firstLine(result.stderr)}`,
      );
    }
    created = true;
    line(`Created role "${roleName}" (LOGIN NOSUPERUSER NOBYPASSRLS CREATEDB)`);
  } else {
    line(
      reuse
        ? `Role "${roleName}" exists and its recorded credentials work: reused, not rotated`
        : options.rotate === true
          ? `Role "${roleName}" exists: its password will be rotated`
          : `Role "${roleName}" exists: its password will be reset, as agreed`,
    );
    if (!existing.canLogin) {
      const login = await script(MAINTENANCE_DATABASE, `${enableLoginStatement(roleName)};\n`);
      if (!login.ok) {
        throw new PreconditionError(
          `Role "${roleName}" exists but cannot log in (NOLOGIN), and enabling it failed: ${firstLine(login.stderr)}\n` +
            `  Run ALTER ROLE ${quoteRole(roleName)} LOGIN; as an administrator, or choose another role with --app-db-user.`,
        );
      }
      line(`Enabled LOGIN on role "${roleName}"`);
    }
  }
  const afterCreate = `The role "${roleName}" exists; re-run with --rotate-app-password once the cause is fixed.`;

  if (existing !== undefined && !existing.createDb) {
    const result = await script(MAINTENANCE_DATABASE, `ALTER ROLE ${quoteRole(roleName)} CREATEDB;\n`);
    if (!result.ok) degraded.push(`CREATEDB: ${firstLine(result.stderr)}`);
  }
  if (existing === undefined || !existing.createRole) {
    const grant = await script(MAINTENANCE_DATABASE, `${grantCreateRoleStatement(roleName)};\n`);
    if (!grant.ok) {
      degraded.push(`CREATEROLE: ${firstLine(grant.stderr)}`);
    } else {
      const self = await script(MAINTENANCE_DATABASE, `${selfGrantStatement(roleName)};\n`);
      if (!self.ok) {
        if (/unrecognized configuration parameter/i.test(self.stderr)) {
          line('createrole_self_grant is not a setting on this server (PostgreSQL before 16): not needed');
        } else {
          degraded.push(`createrole_self_grant: ${firstLine(self.stderr)}`);
        }
      }
    }
  }

  if (degraded.length > 0) {
    const costs = degraded.map((item) => {
      const name = item.split(':')[0] as string;
      return `  - ${item}\n    Without it: ${CONSEQUENCE[name] ?? 'a platform feature is limited'}.`;
    });
    line(`The administrative login could not grant everything:\n${costs.join('\n')}`);
    const consent = await obtainConsent(
      `"${adminName}" could not give role "${roleName}" ${degraded.map((item) => item.split(':')[0]).join(', ')} (a managed provider often withholds them). Continue with a reduced role?`,
      {
        flag: options.allowReducedRole,
        nonInteractive: options.nonInteractive,
        promptContext: options.promptContext,
        ask: options.ask,
      },
    );
    if (!consented(consent)) {
      // The password was not set, so nothing but the (password-less) role was left behind.
      return notConsented(
        `Role "${roleName}" exists but lacks what the platform expects:\n${costs.join('\n')}\n` +
          '  The deployment was not moved onto it and no password was set. Ask the provider for a login that can grant them, or re-run with --allow-reduced-role to accept the limits.',
      );
    }
  }

  // 8. Ownership. A non-superuser administrator must be able to SET ROLE to the
  // new owner to give it things; that membership is revoked again afterwards if
  // this run is what created it.
  let ownershipTransferred = false;
  if (needsTransfer) {
    let granted = false;
    if (!attributes.superuser) {
      let canSet = await runPsql(
        options.runCommand,
        maintenance,
        MAINTENANCE_DATABASE,
        `select pg_has_role(${literal(adminName)}, ${literal(roleName)}, 'SET')`,
      );
      // `SET` is a PostgreSQL 16 privilege type; before it, membership is the question.
      if (!canSet.ok) {
        canSet = await runPsql(
          options.runCommand,
          maintenance,
          MAINTENANCE_DATABASE,
          `select pg_has_role(${literal(adminName)}, ${literal(roleName)}, 'MEMBER')`,
        );
      }
      if (!(canSet.ok && canSet.stdout.trim().startsWith('t'))) {
        const grant = await script(MAINTENANCE_DATABASE, `${grantMembershipStatement(roleName, adminName)};\n`);
        if (!grant.ok) {
          throw new PreconditionError(
            `"${adminName}" cannot act as "${roleName}" to give it the database: ${firstLine(grant.stderr)}\n  ${afterCreate}`,
          );
        }
        granted = true;
      }
    }
    const result = await script(entered.database, ownershipScript(roleName, entered.database));
    if (granted) {
      const revoke = await script(MAINTENANCE_DATABASE, `${revokeMembershipStatement(roleName, adminName)};\n`);
      if (!revoke.ok) line(`warning: could not revoke the temporary membership of "${adminName}" in "${roleName}": ${firstLine(revoke.stderr)}`);
    }
    if (!result.ok) {
      throw new PreconditionError(
        `Could not transfer ownership of "${entered.database}" to "${roleName}": ${firstLine(result.stderr)}\n` +
          `  Nothing was partially changed (one transaction), and no password was set. ${afterCreate}`,
      );
    }
    ownershipTransferred = true;
    line(`Transferred ownership of "${entered.database}" and its objects to "${roleName}"`);
  }

  // 9. The PASSWORD, last. `.env` first: if it cannot be written the server is
  // untouched; if the ALTER fails `.env` is put back; once the ALTER has
  // succeeded `.env` holds what the server holds.
  const credentials = { user: roleName, password };
  await options.store?.write(credentials);
  if (!reuse) {
    const set = await script(MAINTENANCE_DATABASE, `${setPasswordStatement(roleName, verifier)};\n`);
    if (!set.ok) {
      await options.store?.restore();
      throw new PreconditionError(
        `Could not set the password of role "${roleName}": ${firstLine(set.stderr)}\n  .env was left as it was. ${afterCreate}`,
      );
    }
    if (created) line(`Set the password of the new role "${roleName}"`);
  }

  // Prove the role opens, against the database it will use, before the
  // deployment is pointed at it.
  const proof = await probeLogin(options.runCommand, { ...maintenance, user: roleName, password }, probeDatabase);
  if (proof.result !== 'ok') {
    // When the old .env was this very role, its old password is dead now and the
    // new one is what the server has, so that is what .env keeps.
    const keepNew = !reuse && recorded?.get('POSTGRES_USER') === roleName;
    if (!keepNew) await options.store?.restore();
    throw new PreconditionError(
      `Role "${roleName}" was provisioned but cannot log in from this host: ${proof.detail}\n` +
        (/no pg_hba\.conf entry/i.test(proof.detail)
          ? `  pg_hba.conf has no entry for "${roleName}" from here: add one (the administrative login is not the only one that needs access).\n`
          : '') +
        (keepNew
          ? `  The server now has the NEW password for "${roleName}" and .env holds it.`
          : options.store === undefined
            ? '  The deployment was not moved onto it.'
            : `  The deployment was not moved onto it: .env is back to its previous login. ${afterCreate}`),
    );
  }

  return {
    outcome: 'provisioned',
    detail: created ? `created role "${roleName}"` : `using role "${roleName}"`,
    roleName,
    credentials,
    created,
    ownershipTransferred,
    degraded,
  };
}

/** `--rotate-app-password` with only the application role's own login: it may change its own password. */
async function rotateOwnPassword(
  options: EnsureApplicationRoleOptions,
  login: DatabaseSettings,
  progress: { mutated: boolean },
): Promise<ApplicationRoleResult> {
  const password = (options.generatePassword ?? generateAppPassword)();
  const verifier = scramSha256Verifier(password);
  options.onSecrets?.([
    { key: 'POSTGRES_PASSWORD', value: password },
    { key: 'POSTGRES_PASSWORD_VERIFIER', value: verifier },
  ]);
  const credentials = { user: login.user, password };

  // `.env` first: if it cannot be written the server is untouched.
  await options.store?.write(credentials);
  progress.mutated = true;
  const result = await runPsqlScript(
    options.runCommand,
    login,
    MAINTENANCE_DATABASE,
    `${setPasswordStatement(login.user, verifier)};\n`,
    { secrets: [password, verifier, login.password] },
  );
  if (!result.ok) {
    await options.store?.restore();
    throw new PreconditionError(
      `Could not rotate the password of "${login.user}": ${firstLine(result.stderr)}\n  .env was left as it was.`,
    );
  }
  options.onLine?.(`Rotated the password of role "${login.user}"`);

  const proof = await probeLogin(options.runCommand, { ...login, password }, login.database);
  if (proof.result !== 'ok') {
    // The server has the new password: .env keeps it.
    throw new PreconditionError(
      `The password of "${login.user}" was rotated but the new one did not open ${login.database}: ${proof.detail}\n` +
        '  The server has the NEW password and .env holds it.',
    );
  }
  return {
    outcome: 'rotated',
    detail: `rotated the password of "${login.user}"`,
    roleName: login.user,
    credentials,
    created: false,
    ownershipTransferred: false,
    degraded: [],
  };
}

function privilegeWords(attributes: Pick<RoleAttributes, 'superuser' | 'bypassRls'>): string {
  const parts = [
    ...(attributes.superuser ? ['a superuser'] : []),
    ...(attributes.bypassRls ? ['BYPASSRLS'] : []),
  ];
  return parts.join(' and ');
}

/** What an operator who runs on a privileged login knowingly should be told, every time. */
export function superuserConsequence(user: string): string {
  return (
    `${user} bypasses row-level security: tenant isolation is OFF and every organization can read every other organization's rows. ` +
    `${cliName()} deploy update --provision-app-role moves the deployment onto a dedicated role.`
  );
}

/**
 * Whether `--allow-superuser` was chosen for THIS login. The record is the
 * state's (`allowSuperuser` + `allowSuperuserLogin`); a flag with no matching
 * login is stale and permits nothing.
 */
export function superuserAllowedFor(
  state: { allowSuperuser?: boolean | undefined; allowSuperuserLogin?: string | undefined } | undefined,
  user: string | undefined,
): boolean {
  return state?.allowSuperuser === true && user !== undefined && state.allowSuperuserLogin === user;
}

/**
 * What the state records about `--allow-superuser` after a run: the login kept
 * in this run, else the previous record while `.env` still holds that login,
 * else nothing.
 */
export function superuserRecord(
  kept: string | undefined,
  previous: { allowSuperuser?: boolean | undefined; allowSuperuserLogin?: string | undefined } | undefined,
  currentUser: string | undefined,
): { allowSuperuser: true | undefined; allowSuperuserLogin: string | undefined } {
  if (kept !== undefined) return { allowSuperuser: true, allowSuperuserLogin: kept };
  if (superuserAllowedFor(previous, currentUser)) {
    return { allowSuperuser: true, allowSuperuserLogin: currentUser as string };
  }
  // Explicit undefined, so spreading it over an earlier record CLEARS the choice.
  return { allowSuperuser: undefined, allowSuperuserLogin: undefined };
}
