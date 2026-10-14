/**
 * A stateful fake PostgreSQL behind `psql`, for the application-role tests
 * (#980).
 *
 * It answers the statements `app-role.ts` and the database checks issue, keeps
 * the roles and ownership it is told about, and -- the point of making it
 * stateful -- REFUSES a login whose password does not match the SCRAM verifier
 * stored for the role. So a test that provisions a role and then connects as
 * it is proving the verifier and the password agree, not that a string was
 * passed along.
 *
 * Statements arrive two ways: `psql -tAc <statement>` (the last argv element)
 * and `psql -f -` with the script on stdin (`options.input`). Both are
 * recorded, with the environment, so a secret-egress test can scan everything
 * a run sent anywhere.
 */
import { createHash, createHmac, pbkdf2Sync } from 'node:crypto';

import { CommandFailedError, type CommandResult, type RunCommandOptions, type runCommand } from '../executor.js';

export interface FakeRole {
  superuser: boolean;
  bypassRls: boolean;
  createRole: boolean;
  createDb: boolean;
  canLogin: boolean;
  /** The stored SCRAM verifier; absent for a role whose password is not modelled. */
  verifier?: string | undefined;
  /** A plain password, for the roles a test creates by hand. */
  password?: string | undefined;
  selfGrant: boolean;
}

export interface FakeOwners {
  databaseOwner: string;
  schemaOwner: string;
  /** Objects not owned by the app role. */
  toMove: number;
  total: number;
}

export interface FakePostgresState {
  roles: Map<string, FakeRole>;
  /** database names present */
  databases: Set<string>;
  /** Owners of the application database, by database. */
  owners: Map<string, FakeOwners>;
  /** Statements (regex) that fail with the given stderr. */
  failures: { match: RegExp; stderr: string | ((sql: string) => string) }[];
  /** Whether `createrole_self_grant` is a setting on this server. */
  hasSelfGrantSetting: boolean;
  /** `<role>><member>` pairs a GRANT made and no REVOKE has taken back. */
  memberships: Set<string>;
}

export interface SeenCall {
  argv: readonly string[];
  env: NodeJS.ProcessEnv | undefined;
  input: string | undefined;
  /** The login the call used. */
  user: string;
  database: string;
  /** The SQL: the -c statement or the stdin script. */
  sql: string;
}

export interface FakePostgres {
  run: typeof runCommand;
  /** The synchronous core of `run`, for a harness whose routes cannot await. */
  respond(argv: readonly string[], options: RunCommandOptions): CommandResult;
  state: FakePostgresState;
  seen: SeenCall[];
  /** Calls whose SQL changed something (CREATE, ALTER, GRANT). */
  mutations(): SeenCall[];
}

export function verifierMatches(password: string, verifier: string): boolean {
  const match = /^SCRAM-SHA-256\$(\d+):([^$]+)\$([^:]+):(.+)$/.exec(verifier);
  if (match === null) return false;
  const salted = pbkdf2Sync(password, Buffer.from(match[2] as string, 'base64'), Number(match[1]), 32, 'sha256');
  const clientKey = createHmac('sha256', salted).update('Client Key').digest();
  const storedKey = createHash('sha256').update(clientKey).digest().toString('base64');
  const serverKey = createHmac('sha256', salted).update('Server Key').digest().toString('base64');
  return storedKey === match[3] && serverKey === match[4];
}

export function ordinaryRole(extra: Partial<FakeRole> = {}): FakeRole {
  return { superuser: false, bypassRls: false, createRole: true, createDb: true, canLogin: true, selfGrant: true, ...extra };
}

export function superRole(extra: Partial<FakeRole> = {}): FakeRole {
  return { superuser: true, bypassRls: true, createRole: true, createDb: true, canLogin: true, selfGrant: false, ...extra };
}

const flag = (value: boolean): string => (value ? 't' : 'f');

export function createFakePostgres(initial: {
  roles: Record<string, FakeRole>;
  databases?: readonly string[];
  owners?: Record<string, FakeOwners>;
  failures?: FakePostgresState['failures'];
  hasSelfGrantSetting?: boolean;
}): FakePostgres {
  const state: FakePostgresState = {
    roles: new Map(Object.entries(initial.roles)),
    databases: new Set(initial.databases ?? []),
    owners: new Map(Object.entries(initial.owners ?? {})),
    failures: [...(initial.failures ?? [])],
    hasSelfGrantSetting: initial.hasSelfGrantSetting ?? true,
    memberships: new Set(),
  };
  const seen: SeenCall[] = [];

  const fail = (argv: readonly string[], options: RunCommandOptions, stderr: string): never => {
    const result: CommandResult = {
      argv,
      cwd: options.cwd,
      exitCode: 2,
      stdout: '',
      stderr,
      durationMs: 0,
      timedOut: false,
    };
    throw new CommandFailedError(stderr, result);
  };

  const respond = (argv: readonly string[], options: RunCommandOptions): CommandResult => {
    const at = (flagName: string): string => argv[argv.indexOf(flagName) + 1] ?? '';
    const user = at('-U');
    const database = at('-d');
    const input = options.input;
    const sql = input ?? argv[argv.length - 1] ?? '';
    seen.push({ argv, env: options.env, input, user, database, sql });

    const ok = (stdout = ''): CommandResult => ({
      argv,
      cwd: options.cwd,
      exitCode: 0,
      stdout,
      stderr: '',
      durationMs: 0,
      timedOut: false,
    });

    // Authentication, as the server does it.
    const role = state.roles.get(user);
    const presented = options.env?.['PGPASSWORD'] ?? '';
    if (role === undefined) return fail(argv, options, `psql: error: FATAL:  role "${user}" does not exist`);
    const authentic =
      role.verifier !== undefined ? verifierMatches(presented, role.verifier) : role.password === presented;
    if (!authentic) {
      return fail(argv, options, `psql: error: FATAL:  password authentication failed for user "${user}" (28P01)`);
    }
    if (!role.canLogin) return fail(argv, options, `psql: error: FATAL:  role "${user}" is not permitted to log in`);

    if (database !== '' && database !== 'postgres' && !state.databases.has(database)) {
      return fail(argv, options, `psql: error: FATAL:  database "${database}" does not exist (3D000)`);
    }

    for (const failure of state.failures) {
      if (failure.match.test(sql)) {
        return fail(argv, options, typeof failure.stderr === 'function' ? failure.stderr(sql) : failure.stderr);
      }
    }

    // -- reads ------------------------------------------------------------------
    if (/from pg_roles where rolname = current_user/.test(sql)) {
      return ok(`${flag(role.superuser)}|${flag(role.bypassRls)}|${flag(role.createRole)}|${flag(role.createDb)}`);
    }
    const lookup = /from pg_roles where rolname = '([^']*)'/.exec(sql);
    if (lookup !== null) {
      const found = state.roles.get(lookup[1] as string);
      return ok(
        found === undefined
          ? ''
          : `${flag(found.superuser)}|${flag(found.bypassRls)}|${flag(found.createRole)}|${flag(found.createDb)}|${flag(found.canLogin)}`,
      );
    }
    const databaseLookup = /from pg_database where datname = '([^']*)'/.exec(sql);
    if (databaseLookup !== null) return ok(state.databases.has(databaseLookup[1] as string) ? '1' : '');
    if (/pg_get_userbyid\(d\.datdba\)/.test(sql)) {
      const owners = state.owners.get(database);
      return ok(owners === undefined ? '' : `${owners.databaseOwner}|${owners.schemaOwner}|${owners.toMove}|${owners.total}`);
    }
    if (/^select 1$/.test(sql.trim())) return ok('1');
    if (/has_schema_privilege/.test(sql) || /rolcreatedb or rolsuper/.test(sql)) return ok('t');
    const createDatabase = /^CREATE DATABASE "([^"]+)"$/.exec(sql.trim());
    if (createDatabase !== null) {
      if (!role.superuser && !role.createDb) return fail(argv, options, 'ERROR:  permission denied to create database (42501)');
      state.databases.add(createDatabase[1] as string);
      state.owners.set(createDatabase[1] as string, { databaseOwner: user, schemaOwner: user, toMove: 0, total: 0 });
      return ok();
    }

    // -- writes -----------------------------------------------------------------
    const create = /CREATE ROLE "([^"]+)" LOGIN NOSUPERUSER NOBYPASSRLS CREATEDB/.exec(sql);
    if (create !== null) {
      if (!role.superuser && !role.createRole) {
        return fail(argv, options, 'ERROR:  permission denied to create role (42501)');
      }
      state.roles.set(create[1] as string, {
        superuser: false,
        bypassRls: false,
        createRole: false,
        createDb: true,
        canLogin: true,
        selfGrant: false,
      });
      return ok();
    }
    const password = /ALTER ROLE "([^"]+)" PASSWORD '([^']*)'/.exec(sql);
    if (password !== null) {
      const target = state.roles.get(password[1] as string);
      if (target === undefined) return fail(argv, options, `ERROR:  role "${password[1]}" does not exist`);
      if (user !== password[1] && !role.superuser && !role.createRole) {
        return fail(argv, options, 'ERROR:  permission denied to alter role (42501)');
      }
      target.verifier = password[2] as string;
      return ok();
    }
    const login = /ALTER ROLE "([^"]+)" LOGIN/.exec(sql);
    if (login !== null) {
      (state.roles.get(login[1] as string) as FakeRole).canLogin = true;
      return ok();
    }
    const createRole = /ALTER ROLE "([^"]+)" CREATEROLE/.exec(sql);
    if (createRole !== null) {
      if (!role.superuser && !role.createRole) {
        return fail(argv, options, 'ERROR:  permission denied to alter role: must have CREATEROLE privilege (42501)');
      }
      (state.roles.get(createRole[1] as string) as FakeRole).createRole = true;
      return ok();
    }
    const createDb = /ALTER ROLE "([^"]+)" CREATEDB/.exec(sql);
    if (createDb !== null) {
      (state.roles.get(createDb[1] as string) as FakeRole).createDb = true;
      return ok();
    }
    const selfGrant = /ALTER ROLE "([^"]+)" SET createrole_self_grant = 'inherit, set'/.exec(sql);
    if (selfGrant !== null) {
      if (!state.hasSelfGrantSetting) {
        return fail(argv, options, 'ERROR:  unrecognized configuration parameter "createrole_self_grant"');
      }
      (state.roles.get(selfGrant[1] as string) as FakeRole).selfGrant = true;
      return ok();
    }
    const hasRole = /pg_has_role\('((?:[^']|'')*)', '((?:[^']|'')*)', '(SET|MEMBER)'\)/.exec(sql);
    if (hasRole !== null) {
      return ok(state.memberships.has(`${hasRole[2]}>${hasRole[1]}`) ? 't' : 'f');
    }
    const grant = /^GRANT "([^"]+)" TO "([^"]+)"/.exec(sql.trim());
    if (grant !== null) {
      state.memberships.add(`${grant[1]}>${grant[2]}`);
      return ok();
    }
    const revoke = /^REVOKE "([^"]+)" FROM "([^"]+)"/.exec(sql.trim());
    if (revoke !== null) {
      state.memberships.delete(`${revoke[1]}>${revoke[2]}`);
      return ok();
    }
    const ownership = /ALTER DATABASE "([^"]+)" OWNER TO "([^"]+)"/.exec(sql);
    if (ownership !== null) {
      state.owners.set(ownership[1] as string, {
        databaseOwner: ownership[2] as string,
        schemaOwner: ownership[2] as string,
        toMove: 0,
        total: state.owners.get(ownership[1] as string)?.total ?? 0,
      });
      return ok();
    }

    return fail(argv, options, `fake-postgres: nothing answers ${JSON.stringify(sql.slice(0, 120))}`);
  };

  const run = (async (argv: readonly string[], options: RunCommandOptions): Promise<CommandResult> =>
    respond(argv, options)) as typeof runCommand;

  return {
    run,
    respond,
    state,
    seen,
    mutations: () => seen.filter((call) => /^\s*(BEGIN;\s*)?(CREATE (ROLE|DATABASE)|ALTER (ROLE|DATABASE|SCHEMA)|GRANT|REVOKE) /i.test(call.sql)),
  };
}

/**
 * A fake-vps route that sends every `psql` invocation to `postgres`.
 *
 * The invocation's stdin is not part of fake-vps's record of it, so the route
 * is given the fake itself and reads `input` from the call's options -- which
 * `createFakeVps` now forwards as `invocation.input`.
 */
export function postgresRoute(postgres: FakePostgres): {
  match: (invocation: { argv: readonly string[] }) => boolean;
  answer: (invocation: {
    argv: readonly string[];
    cwd: string;
    env?: NodeJS.ProcessEnv | undefined;
    input?: string | undefined;
  }) => { stdout?: string; stderr?: string; fail?: Error };
} {
  return {
    match: (invocation) => invocation.argv.includes('psql'),
    answer: (invocation) => {
      try {
        const result = postgres.respond(invocation.argv, {
          cwd: invocation.cwd,
          env: invocation.env,
          input: invocation.input,
        });
        return { stdout: result.stdout };
      } catch (error) {
        return { fail: error as Error };
      }
    },
  };
}
