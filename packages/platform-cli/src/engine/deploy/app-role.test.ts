import { createHash, createHmac } from 'node:crypto';

import { afterEach, describe, expect, it } from 'vitest';

import { PreconditionError, UsageError } from '../errors.js';
import { replaceCliIdentityForTests } from '../identity.js';
import {
  assertCreatableRoleName,
  createRoleStatement,
  defaultAppRoleName,
  ensureApplicationRole,
  extractRoleAnswers,
  generateAppPassword,
  grantCreateRoleStatement,
  ownershipScript,
  plannedRoleName,
  provisioningMetadata,
  resolveAdminLogin,
  scramSha256Verifier,
  selfGrantStatement,
  setPasswordStatement,
  type EnsureApplicationRoleOptions,
} from './app-role.js';
import {
  createFakePostgres,
  ordinaryRole,
  superRole,
  verifierMatches,
  type FakePostgres,
} from './testing/fake-postgres.js';

// Fixtures, not credentials. Distinctive, so the egress scans below cannot
// match something else by accident.
const ADMIN_SECRET = 'admin-secret-7f3a91c2-zz';
const FIXED_PASSWORD = 'GENERATED-PASSWORD-0123456789abcdefghijklmnopqrs';
const ROLE = 'example_app';

function env(user = 'admin', password = ADMIN_SECRET, extra: Record<string, string> = {}): Map<string, string> {
  return new Map([
    ['POSTGRES_HOST', 'db.internal'],
    ['POSTGRES_PORT', '5432'],
    ['POSTGRES_USER', user],
    ['POSTGRES_PASSWORD', password],
    ['POSTGRES_DB', 'appdb'],
    ...Object.entries(extra),
  ]);
}

function server(over: Partial<Parameters<typeof createFakePostgres>[0]> = {}): FakePostgres {
  return createFakePostgres({
    roles: { admin: superRole({ password: ADMIN_SECRET }) },
    ...over,
  });
}

function options(
  fake: FakePostgres,
  extra: Partial<EnsureApplicationRoleOptions> = {},
): EnsureApplicationRoleOptions & { lines: string[] } {
  const lines: string[] = [];
  return {
    env: env(),
    runCommand: fake.run,
    onLine: (line) => lines.push(line),
    whenNotConsented: 'refuse',
    nonInteractive: true,
    provisionConsent: true,
    generatePassword: () => FIXED_PASSWORD,
    lines,
    ...extra,
  };
}

describe('the role name and the default', () => {
  it('derives <app>_app from the identity, once', () => {
    expect(defaultAppRoleName()).toBe('example_app');
    const restore = replaceCliIdentityForTests({ name: 'forkctl', displayName: 'Fork', repoSlug: 'fork/Acme-Portal' });
    try {
      expect(defaultAppRoleName()).toBe('acme_portal_app');
    } finally {
      restore();
    }
    const pg = replaceCliIdentityForTests({ name: 'forkctl', displayName: 'Fork', repoSlug: 'fork/pg-tools' });
    try {
      expect(defaultAppRoleName()).toBe('app_pg_tools_app');
    } finally {
      pg();
    }
  });

  it.each(['postgres', 'public', 'pg_admin', '1app', 'app-role', 'app role', 'a"; DROP ROLE x; --', '', 'a'.repeat(64)])(
    'refuses %j',
    (name) => {
      expect(() => assertCreatableRoleName(name)).toThrow(UsageError);
    },
  );
});

describe('the password and its verifier', () => {
  it('is 32 random bytes, URL-safe, and different every time', () => {
    const first = generateAppPassword();
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateAppPassword()).not.toBe(first);
  });

  it('is sent as a SCRAM-SHA-256 verifier that opens with exactly that password', () => {
    const verifier = scramSha256Verifier('a-password');
    expect(verifier).toMatch(/^SCRAM-SHA-256\$4096:[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
    expect(verifierMatches('a-password', verifier)).toBe(true);
    expect(verifierMatches('another', verifier)).toBe(false);
    expect(verifier).not.toContain('a-password');
  });

  it('agrees with the RFC 7677 SCRAM-SHA-256 example exchange (password "pencil")', () => {
    const verifier = scramSha256Verifier('pencil', Buffer.from('W22ZaJ0SNY7soEsUEjb6gQ==', 'base64'));
    const [, , keys] = verifier.split('$') as [string, string, string];
    const [storedKey, serverKey] = keys.split(':').map((part) => Buffer.from(part, 'base64')) as [Buffer, Buffer];

    const authMessage =
      'n=user,r=rOprNGfwEbeRWgbNEkqO,' +
      'r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0,s=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096,' +
      'c=biws,r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0';
    const proof = Buffer.from('dHzbZapWIk4jUhN+Ute9ytag9zjfMHgsqmmiz7AndVQ=', 'base64');

    // The client proves it knows ClientKey: proof = ClientKey XOR HMAC(StoredKey, AuthMessage).
    const signature = createHmac('sha256', storedKey).update(authMessage).digest();
    const clientKey = Buffer.from(proof.map((byte, index) => byte ^ (signature[index] as number)));
    expect(createHash('sha256').update(clientKey).digest().equals(storedKey)).toBe(true);

    // And the server answers with HMAC(ServerKey, AuthMessage).
    expect(createHmac('sha256', serverKey).update(authMessage).digest().toString('base64')).toBe(
      '6rriTRBi23WpRR/wtup+mMhUZUn/dB5nLTJRsjl95G4=',
    );
  });
});

describe('the statements', () => {
  it('creates the role with exactly the attributes 10-application-role.sh gives, and no password yet', () => {
    expect(createRoleStatement(ROLE)).toBe(`CREATE ROLE "${ROLE}" LOGIN NOSUPERUSER NOBYPASSRLS CREATEDB`);
    expect(setPasswordStatement(ROLE, 'SCRAM-SHA-256$4096:s$k:k')).toBe(
      `ALTER ROLE "${ROLE}" PASSWORD 'SCRAM-SHA-256$4096:s$k:k'`,
    );
    expect(grantCreateRoleStatement(ROLE)).toBe(`ALTER ROLE "${ROLE}" CREATEROLE`);
    expect(selfGrantStatement(ROLE)).toBe(`ALTER ROLE "${ROLE}" SET createrole_self_grant = 'inherit, set'`);
  });

  it('transfers ownership object by object, in one transaction, and never REASSIGN OWNED', () => {
    const script = ownershipScript(ROLE, 'appdb');
    expect(script).toMatch(/^BEGIN;/);
    expect(script).toMatch(/COMMIT;\n$/);
    expect(script).toContain(`ALTER DATABASE "appdb" OWNER TO "${ROLE}";`);
    for (const kind of [
      'ALTER SCHEMA public OWNER TO %I',
      'ALTER %s public.%I OWNER TO',
      'ALTER SEQUENCE public.%I OWNER TO',
      'ALTER %s %s OWNER TO',
    ]) {
      expect(script).toContain(kind);
    }
    expect(script).not.toMatch(/REASSIGN/i);
    expect(script).not.toMatch(/\bDROP\b/i);
    // Extension-owned objects are left to their extension.
    expect(script).toContain("e.deptype = 'e'");
  });

  it('leaves a PostgreSQL 15+ public schema (owned by pg_database_owner) alone', () => {
    expect(ownershipScript(ROLE, 'appdb')).toContain("NOT IN (target, 'pg_database_owner')");
  });

  it('covers domains, range types and standalone composite types, and makes a column-owned sequence usable', () => {
    const script = ownershipScript(ROLE, 'appdb');
    expect(script).toContain("o.typtype IN ('e','d','r')");
    expect(script).toContain("WHEN 'd' THEN 'DOMAIN'");
    expect(script).toContain("o.relkind IN ('r','p','v','m','f','c')");
    expect(script).toContain('GRANT ALL ON SEQUENCE public.%I TO %I');
  });

  it('counts neither extension members nor column-owned sequences as work to do', async () => {
    const fake = server({
      databases: ['appdb'],
      owners: { appdb: { databaseOwner: ROLE, schemaOwner: 'pg_database_owner', toMove: 0, total: 5 } },
    });
    const result = await ensureApplicationRole(options(fake, { transferOwnership: undefined }));
    expect(result.ownershipTransferred).toBe(false);
    expect(fake.seen.some((call) => /ALTER DATABASE/.test(call.sql))).toBe(false);
    const info = fake.seen.find((call) => /pg_get_userbyid\(d\.datdba\)/.test(call.sql))?.sql ?? '';
    expect(info).toContain("e.deptype = 'e'");
    expect(info).toContain("not (c.relkind = 'S' and exists");
    expect(info).toContain("t.typtype in ('e','d','r')");
  });

  it('quotes a database name rather than refusing it: this only ever alters one that exists', () => {
    for (const name of ['my-app', 'my.app', 'Mixed Case']) {
      expect(ownershipScript(ROLE, name)).toContain(`ALTER DATABASE "${name}" OWNER TO`);
    }
    expect(ownershipScript(ROLE, 'a"; DROP DATABASE x; --')).toContain('ALTER DATABASE "a""; DROP DATABASE x; --" OWNER TO');
  });

  it('refuses a ROLE name that would extend a statement', () => {
    expect(() => createRoleStatement('x"; DROP ROLE y; --')).toThrow(UsageError);
    expect(() => ownershipScript('x"; DROP ROLE y; --', 'appdb')).toThrow(UsageError);
  });
});

describe('ensureApplicationRole: a new database', () => {
  it('creates the role with the full attribute set, holding the administrator in memory only', async () => {
    const fake = server();
    const o = options(fake);
    const result = await ensureApplicationRole(o);

    expect(result.outcome).toBe('provisioned');
    expect(result.created).toBe(true);
    expect(result.credentials).toEqual({ user: ROLE, password: FIXED_PASSWORD });

    const role = fake.state.roles.get(ROLE);
    expect(role).toMatchObject({
      superuser: false,
      bypassRls: false,
      createRole: true,
      createDb: true,
      canLogin: true,
      selfGrant: true,
    });
    // The server holds a verifier that opens with the generated password.
    expect(verifierMatches(FIXED_PASSWORD, role?.verifier ?? '')).toBe(true);

    const statements = fake.mutations().map((call) => call.sql);
    expect(statements[0]).toBe(`CREATE ROLE "${ROLE}" LOGIN NOSUPERUSER NOBYPASSRLS CREATEDB;\n`);
    expect(statements).toContainEqual(`ALTER ROLE "${ROLE}" CREATEROLE;\n`);
    expect(statements).toContainEqual(`ALTER ROLE "${ROLE}" SET createrole_self_grant = 'inherit, set';\n`);
    // The password is the LAST thing the server is told.
    expect(statements[statements.length - 1]).toContain(`ALTER ROLE "${ROLE}" PASSWORD 'SCRAM-SHA-256$`);
    // The database does not exist yet, so there is no ownership to move: ensureDatabase
    // creates it later, as this role, which then owns it.
    expect(statements.some((sql) => /OWNER TO/.test(sql))).toBe(false);
    // Proven by logging in as the new role before returning.
    const last = fake.seen[fake.seen.length - 1];
    expect(last?.user).toBe(ROLE);
  });

  it('uses an explicit administrative login instead of the entered one, with consent implied', async () => {
    const fake = server({
      roles: { admin: superRole({ password: ADMIN_SECRET }), ignored: ordinaryRole({ password: 'x' }) },
    });
    const o = options(fake, {
      env: env('someone', 'whatever'),
      admin: { user: 'admin', password: ADMIN_SECRET },
      provisionConsent: undefined,
    });
    const result = await ensureApplicationRole(o);
    expect(result.outcome).toBe('provisioned');
    expect(fake.seen.every((call) => call.user === 'admin' || call.user === ROLE)).toBe(true);
  });

  it('honours --app-db-user', async () => {
    const fake = server();
    const result = await ensureApplicationRole(options(fake, { roleName: 'shop_app' }));
    expect(result.roleName).toBe('shop_app');
    expect(fake.state.roles.has('shop_app')).toBe(true);
  });

  it('skips CREATEROLE self-grant silently on a server older than 16', async () => {
    const fake = server({ hasSelfGrantSetting: false });
    const o = options(fake);
    const result = await ensureApplicationRole(o);
    expect(result.outcome).toBe('provisioned');
    expect(result.degraded).toEqual([]);
    expect(o.lines.join('\n')).toMatch(/before 16/);
  });
});

describe('ensureApplicationRole: idempotent and resumable', () => {
  it('a second run reuses the role and its recorded password: no mutation, no rotation', async () => {
    const fake = server();
    const first = await ensureApplicationRole(options(fake));
    const before = fake.mutations().length;
    const verifier = fake.state.roles.get(ROLE)?.verifier;

    const second = await ensureApplicationRole(
      options(fake, {
        recordedEnv: env(ROLE, first.credentials?.password ?? '', {}),
        generatePassword: () => 'SHOULD-NEVER-BE-USED-0123456789012345678',
      }),
    );

    expect(second.outcome).toBe('provisioned');
    expect(second.created).toBe(false);
    expect(second.credentials).toEqual(first.credentials);
    expect(fake.mutations()).toHaveLength(before);
    expect(fake.state.roles.get(ROLE)?.verifier).toBe(verifier);
  });

  it('resumes without the administrator when .env already holds the application login', async () => {
    const fake = server();
    const first = await ensureApplicationRole(options(fake));
    const calls = fake.seen.length;

    // Nothing but the app credentials: the administrator is not asked for, and not needed.
    const resumed = await ensureApplicationRole(
      options(fake, {
        env: env(ROLE, first.credentials?.password ?? ''),
        provisionConsent: undefined,
        admin: undefined,
      }),
    );

    expect(resumed.outcome).toBe('ordinary');
    expect(resumed.credentials).toBeUndefined();
    expect(fake.seen.slice(calls).every((call) => call.user === ROLE)).toBe(true);
    expect(fake.mutations().filter((call) => call.user === ROLE)).toHaveLength(0);
  });

  it('does not reset the password of a role it did not make: nothing on record opens it, so it refuses', async () => {
    // Staging and production of one fork on one cluster default to the same <repo>_app.
    const fake = server();
    await ensureApplicationRole(options(fake, { generatePassword: () => 'THE-FIRST-DEPLOYMENTS-PASSWORD-0123456789abcdef' }));
    const verifier = fake.state.roles.get(ROLE)?.verifier;
    const before = fake.mutations().length;

    const o = options(fake);
    const error = await ensureApplicationRole(o).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PreconditionError);
    expect((error as Error).message).toContain('--rotate-app-password');
    expect((error as Error).message).toContain('--app-db-user');
    expect(fake.mutations()).toHaveLength(before);
    expect(fake.state.roles.get(ROLE)?.verifier).toBe(verifier);
  });

  it('refuses the same way when the recorded password is rejected', async () => {
    const fake = server();
    await ensureApplicationRole(options(fake));
    const error = await ensureApplicationRole(
      options(fake, { recordedEnv: env(ROLE, 'a-stale-password-0123456789') }),
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PreconditionError);
    expect((error as Error).message).toMatch(/rejected/);
    expect(verifierMatches(FIXED_PASSWORD, fake.state.roles.get(ROLE)?.verifier ?? '')).toBe(true);
  });

  it('sets a new password for an existing role with --rotate-app-password', async () => {
    const fake = server();
    await ensureApplicationRole(options(fake, { generatePassword: () => 'LOST-PASSWORD-0123456789012345678901234567' }));
    const result = await ensureApplicationRole(options(fake, { rotate: true }));
    expect(result.credentials?.password).toBe(FIXED_PASSWORD);
    expect(verifierMatches(FIXED_PASSWORD, fake.state.roles.get(ROLE)?.verifier ?? '')).toBe(true);
  });

  it('sets it after an interactive yes that names the role, and not after a no', async () => {
    const fake = server();
    await ensureApplicationRole(options(fake, { generatePassword: () => 'LOST-PASSWORD-0123456789012345678901234567' }));
    const questions: string[] = [];

    await expect(
      ensureApplicationRole(options(fake, { nonInteractive: undefined, ask: async (q) => (questions.push(q), !q.includes('NEW password')) })),
    ).rejects.toThrow(/was not changed/);
    expect(questions.find((q) => q.includes('NEW password'))).toContain(`"${ROLE}"`);

    const result = await ensureApplicationRole(
      options(fake, { nonInteractive: undefined, ask: async () => true }),
    );
    expect(result.credentials?.password).toBe(FIXED_PASSWORD);
  });

  it('never resets a password because the check could not be made (pg_hba, revoked CONNECT): that is not a wrong password', async () => {
    for (const stderr of [
      'psql: error: FATAL:  no pg_hba.conf entry for host "10.0.0.1", user "example_app", database "appdb" (28000)',
      'psql: error: FATAL:  permission denied for database "appdb" (42501)',
      'psql: error: connection to server failed: Connection timed out',
    ]) {
      const fake = server({ databases: ['appdb'] });
      const first = await ensureApplicationRole(options(fake));
      const before = fake.mutations().length;
      fake.state.failures.push({ match: /select 1/, stderr });
      // The administrator's reads still work: only the app role's probe is refused.
      const fail = fake.run;
      const gated = (async (argv: readonly string[], opts: Parameters<typeof fail>[1]) => {
        const user = argv[argv.indexOf('-U') + 1];
        if (user === ROLE) return fail(argv, opts);
        const saved = fake.state.failures.splice(0);
        try {
          return await fail(argv, opts);
        } finally {
          fake.state.failures.push(...saved);
        }
      }) as typeof fail;

      const error = await ensureApplicationRole(
        options(fake, { runCommand: gated, recordedEnv: env(ROLE, first.credentials?.password ?? '') }),
      ).catch((e: unknown) => e);

      expect((error as Error).message).toMatch(/Could not check the credentials on record/);
      expect(fake.mutations()).toHaveLength(before);
    }
  });

  it('probes the recorded password against the application database, not the maintenance one', async () => {
    const fake = server({ databases: ['appdb'] });
    const first = await ensureApplicationRole(options(fake));
    fake.seen.length = 0;
    await ensureApplicationRole(options(fake, { recordedEnv: env(ROLE, first.credentials?.password ?? '') }));
    const asRole = fake.seen.filter((call) => call.user === ROLE);
    expect(asRole.length).toBeGreaterThan(0);
    expect(asRole.every((call) => call.database === 'appdb')).toBe(true);
  });

  it('falls back to the maintenance database to prove the role before the application database exists', async () => {
    const fake = server();
    await ensureApplicationRole(options(fake));
    expect(fake.seen.filter((call) => call.user === ROLE).every((call) => call.database === 'postgres')).toBe(true);
  });

  it('enables LOGIN on an existing NOLOGIN role instead of failing later at pg_hba', async () => {
    const fake = server({
      roles: { admin: superRole({ password: ADMIN_SECRET }), [ROLE]: ordinaryRole({ canLogin: false, password: 'old-password-0123456789' }) },
    });
    const result = await ensureApplicationRole(options(fake, { rotate: true }));
    expect(result.outcome).toBe('provisioned');
    expect(fake.state.roles.get(ROLE)?.canLogin).toBe(true);
    expect(fake.mutations().map((call) => call.sql)).toContainEqual(`ALTER ROLE "${ROLE}" LOGIN;\n`);
  });

  it('says so clearly when it cannot enable LOGIN', async () => {
    const fake = server({
      roles: { admin: superRole({ password: ADMIN_SECRET }), [ROLE]: ordinaryRole({ canLogin: false, password: 'x' }) },
      failures: [{ match: /ALTER ROLE "[^"]+" LOGIN/, stderr: 'ERROR:  permission denied to alter role' }],
    });
    const error = await ensureApplicationRole(options(fake, { rotate: true })).catch((e: unknown) => e);
    expect((error as Error).message).toMatch(/NOLOGIN/);
  });
});

describe('ensureApplicationRole: detecting the property', () => {
  it('leaves an ordinary login alone', async () => {
    const fake = createFakePostgres({ roles: { app: ordinaryRole({ password: 'secret-app-pw' }) } });
    const result = await ensureApplicationRole(options(fake, { env: env('app', 'secret-app-pw') }));
    expect(result.outcome).toBe('ordinary');
    expect(fake.mutations()).toHaveLength(0);
  });

  it('treats BYPASSRLS without SUPERUSER as privileged', async () => {
    const fake = createFakePostgres({ roles: { admin: ordinaryRole({ bypassRls: true, password: ADMIN_SECRET }) } });
    const result = await ensureApplicationRole(options(fake));
    expect(result.outcome).toBe('provisioned');
  });

  it('refuses without consent, naming every way forward, and changes nothing', async () => {
    const fake = server();
    const error = await ensureApplicationRole(options(fake, { provisionConsent: undefined })).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PreconditionError);
    for (const flag of ['--provision-app-role', '--skip-role-provisioning', '--allow-superuser']) {
      expect((error as Error).message).toContain(flag);
    }
    expect(fake.mutations()).toHaveLength(0);
  });

  it('asks interactively and provisions only on yes', async () => {
    const questions: string[] = [];
    const yes = server();
    await ensureApplicationRole(
      options(yes, {
        provisionConsent: undefined,
        nonInteractive: undefined,
        ask: async (question) => {
          questions.push(question);
          return true;
        },
      }),
    );
    expect(questions[0]).toContain(ROLE);
    expect(questions[0]).toContain('not saved');
    expect(yes.state.roles.has(ROLE)).toBe(true);

    const no = server();
    await expect(
      ensureApplicationRole(options(no, { provisionConsent: undefined, nonInteractive: undefined, ask: async () => false })),
    ).rejects.toThrow(/declined/);
    expect(no.mutations()).toHaveLength(0);
  });

  it('warns instead of failing when update has no consent', async () => {
    const fake = server();
    const o = options(fake, { provisionConsent: undefined, whenNotConsented: 'warn' });
    const result = await ensureApplicationRole(o);
    expect(result.outcome).toBe('declined');
    expect(o.lines.join('\n')).toContain('--provision-app-role');
    expect(fake.mutations()).toHaveLength(0);
  });

  it('--allow-superuser keeps the login and says what that costs', async () => {
    const fake = server();
    const o = options(fake, { allowSuperuser: true });
    const result = await ensureApplicationRole(o);
    expect(result.outcome).toBe('superuser-allowed');
    expect(o.lines.join('\n')).toMatch(/INERT/);
    expect(fake.mutations()).toHaveLength(0);
  });

  it('--skip-role-provisioning touches nothing and does not even connect', async () => {
    const fake = server();
    const result = await ensureApplicationRole(options(fake, { skip: true }));
    expect(result.outcome).toBe('skipped');
    expect(fake.seen).toHaveLength(0);
  });

  it('reports an unreachable database as unknown (validate-environment owns that)', async () => {
    const fake = createFakePostgres({ roles: {} });
    const result = await ensureApplicationRole(options(fake));
    expect(result.outcome).toBe('unknown');
  });

  it('fails clearly when the explicit administrator cannot connect', async () => {
    const fake = server();
    await expect(
      ensureApplicationRole(options(fake, { admin: { user: 'admin', password: 'wrong' } })),
    ).rejects.toThrow(/administrative login "admin"/);
  });

  it('does not alter or use an existing role that is privileged', async () => {
    const fake = server({ roles: { admin: superRole({ password: ADMIN_SECRET }), [ROLE]: superRole({ password: 'x' }) } });
    const error = await ensureApplicationRole(options(fake)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PreconditionError);
    expect((error as Error).message).toMatch(/superuser/);
    expect(fake.mutations()).toHaveLength(0);
  });

  it('refuses to be its own administrator', async () => {
    const fake = server({ roles: { admin: superRole({ password: ADMIN_SECRET }) } });
    await expect(ensureApplicationRole(options(fake, { roleName: 'admin' }))).rejects.toThrow(UsageError);
  });
});

describe('ensureApplicationRole: an existing database', () => {
  const existing = { appdb: { databaseOwner: 'admin', schemaOwner: 'admin', toMove: 14, total: 20 } };

  it('asks before changing the owner of a non-empty database, and recommends a backup', async () => {
    const fake = server({ databases: ['appdb'], owners: existing });
    const o = options(fake, { transferOwnership: undefined });
    const error = await ensureApplicationRole(o).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PreconditionError);
    expect((error as Error).message).toContain('--transfer-ownership');
    expect(o.lines.join('\n')).toMatch(/backup/i);
    expect(o.lines.join('\n')).toMatch(/never REASSIGN OWNED BY/);
    // Consent comes BEFORE any mutation: a "no" leaves the server as it was.
    expect(fake.mutations()).toHaveLength(0);
    expect(fake.state.roles.has(ROLE)).toBe(false);
  });

  it('transfers with --transfer-ownership, as ALTER ... OWNER TO and never REASSIGN OWNED', async () => {
    const fake = server({ databases: ['appdb'], owners: existing });
    const result = await ensureApplicationRole(options(fake, { transferOwnership: true }));

    expect(result.ownershipTransferred).toBe(true);
    expect(fake.state.owners.get('appdb')).toMatchObject({ databaseOwner: ROLE, schemaOwner: ROLE, toMove: 0 });
    const script = fake.seen.find((call) => /ALTER DATABASE/.test(call.sql));
    expect(script?.database).toBe('appdb');
    expect(script?.sql).toContain('ALTER SCHEMA public OWNER TO %I');
    for (const call of fake.seen) expect(call.sql).not.toMatch(/REASSIGN/i);
  });

  it('asks interactively and does nothing on no', async () => {
    const fake = server({ databases: ['appdb'], owners: existing });
    const questions: string[] = [];
    const result = await ensureApplicationRole(
      options(fake, {
        transferOwnership: undefined,
        nonInteractive: undefined,
        whenNotConsented: 'warn',
        ask: async (question) => {
          questions.push(question);
          return !/Change the owner/.test(question);
        },
      }),
    );
    expect(result.outcome).toBe('declined');
    expect(questions.find((q) => /Change the owner/.test(q))).toContain('backup is recommended');
    expect(fake.mutations()).toHaveLength(0);
  });

  it('needs no consent for an empty database that is simply owned by someone else', async () => {
    const fake = server({
      databases: ['appdb'],
      owners: { appdb: { databaseOwner: 'admin', schemaOwner: 'admin', toMove: 0, total: 0 } },
    });
    const result = await ensureApplicationRole(options(fake, { transferOwnership: undefined }));
    expect(result.ownershipTransferred).toBe(true);
  });

  it('does not touch ownership that is already the role', async () => {
    const fake = server({
      databases: ['appdb'],
      owners: { appdb: { databaseOwner: ROLE, schemaOwner: ROLE, toMove: 0, total: 20 } },
    });
    const result = await ensureApplicationRole(options(fake, { transferOwnership: undefined }));
    expect(result.ownershipTransferred).toBe(false);
    expect(fake.seen.some((call) => /ALTER DATABASE/.test(call.sql))).toBe(false);
  });

  it('grants a non-superuser administrator membership first, so it may give the objects away', async () => {
    const fake = createFakePostgres({
      roles: { rds: ordinaryRole({ bypassRls: true, password: ADMIN_SECRET }) },
      databases: ['appdb'],
      owners: existing,
    });
    await ensureApplicationRole(options(fake, { env: env('rds'), transferOwnership: true }));
    const sql = fake.mutations().map((call) => call.sql);
    const grant = sql.findIndex((statement) => statement.startsWith(`GRANT "${ROLE}" TO "rds"`));
    const owner = sql.findIndex((statement) => /ALTER DATABASE/.test(statement));
    expect(grant).toBeGreaterThanOrEqual(0);
    expect(grant).toBeLessThan(owner);
  });

  it('rolls ownership back as one transaction and says so when the script fails', async () => {
    const fake = server({
      databases: ['appdb'],
      owners: existing,
      failures: [{ match: /ALTER SCHEMA public/, stderr: 'ERROR:  must be owner of schema public' }],
    });
    const error = await ensureApplicationRole(options(fake, { transferOwnership: true })).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PreconditionError);
    expect((error as Error).message).toMatch(/one transaction/);
    expect(fake.seen.find((call) => /ALTER DATABASE/.test(call.sql))?.sql).toMatch(/^BEGIN;/);
  });
});

describe('ensureApplicationRole: a managed provider that withholds attributes', () => {
  const noCreateRole = [
    { match: /ALTER ROLE "[^"]+" CREATEROLE/, stderr: 'ERROR:  permission denied to alter role (42501)' },
  ];

  it('says which attribute and what stops working, and does not proceed unconsented', async () => {
    const fake = server({ failures: noCreateRole });
    const o = options(fake);
    const error = await ensureApplicationRole(o).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PreconditionError);
    expect((error as Error).message).toContain('CREATEROLE');
    expect((error as Error).message).toMatch(/node/i);
    expect((error as Error).message).toContain('--allow-reduced-role');
    // Never silently weaker: the role exists, but the deployment was not moved onto it.
    expect(fake.state.roles.get(ROLE)?.createRole).toBe(false);
  });

  it('proceeds with --allow-reduced-role and reports the degradation', async () => {
    const fake = server({ failures: noCreateRole });
    const result = await ensureApplicationRole(options(fake, { allowReducedRole: true }));
    expect(result.outcome).toBe('provisioned');
    expect(result.degraded).toHaveLength(1);
    expect(result.degraded[0]).toMatch(/^CREATEROLE/);
  });

  it('reports a withheld createrole_self_grant for what it is', async () => {
    const fake = server({
      failures: [{ match: /createrole_self_grant/, stderr: 'ERROR:  permission denied to set parameter (42501)' }],
    });
    const error = await ensureApplicationRole(options(fake)).catch((e: unknown) => e);
    expect((error as Error).message).toContain('createrole_self_grant');
    expect((error as Error).message).toMatch(/INHERIT nor SET|restore/);
  });

  it('gives the by-hand remedy when the administrator cannot create roles at all', async () => {
    const fake = createFakePostgres({
      roles: { rds: ordinaryRole({ bypassRls: true, createRole: false, password: ADMIN_SECRET }) },
    });
    const error = await ensureApplicationRole(options(fake, { env: env('rds') })).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PreconditionError);
    expect((error as Error).message).toContain('CREATE ROLE "example_app" LOGIN NOSUPERUSER NOBYPASSRLS CREATEDB CREATEROLE');
    expect((error as Error).message).toContain('--skip-role-provisioning');
    expect((error as Error).message).not.toContain('SCRAM');
  });
});

describe('ensureApplicationRole: rotation', () => {
  it('replaces the password only when asked, and the old one stops working', async () => {
    const fake = server();
    const first = await ensureApplicationRole(options(fake));

    const rotated = await ensureApplicationRole(
      options(fake, {
        recordedEnv: env(ROLE, first.credentials?.password ?? ''),
        rotate: true,
        generatePassword: () => 'ROTATED-PASSWORD-0123456789abcdefghijklmnopq',
      }),
    );

    expect(rotated.credentials?.password).toBe('ROTATED-PASSWORD-0123456789abcdefghijklmnopq');
    const verifier = fake.state.roles.get(ROLE)?.verifier ?? '';
    expect(verifierMatches('ROTATED-PASSWORD-0123456789abcdefghijklmnopq', verifier)).toBe(true);
    expect(verifierMatches(FIXED_PASSWORD, verifier)).toBe(false);
  });

  it('rotates with the application role alone: a role may change its own password', async () => {
    const fake = server({ databases: ['appdb'] });
    const first = await ensureApplicationRole(options(fake));
    const before = fake.seen.length;

    const result = await ensureApplicationRole(
      options(fake, {
        env: env(ROLE, first.credentials?.password ?? ''),
        provisionConsent: undefined,
        rotate: true,
        generatePassword: () => 'SELF-ROTATED-0123456789abcdefghijklmnopqrstu',
      }),
    );

    expect(result.outcome).toBe('rotated');
    expect(fake.seen.slice(before).every((call) => call.user === ROLE)).toBe(true);
    expect(verifierMatches('SELF-ROTATED-0123456789abcdefghijklmnopqrstu', fake.state.roles.get(ROLE)?.verifier ?? '')).toBe(true);
  });
});

describe('secret egress', () => {
  /** Everything a run sent anywhere that is not the child's environment or stdin. */
  function observable(fake: FakePostgres, lines: readonly string[], extra: readonly string[] = []): string {
    return [...fake.seen.map((call) => call.argv.join(' ')), ...lines, ...extra].join('\n');
  }

  it('never puts the generated password, the verifier or the administrator password in argv, lines or the result', async () => {
    const fake = server({ databases: ['appdb'], owners: { appdb: { databaseOwner: 'admin', schemaOwner: 'admin', toMove: 3, total: 5 } } });
    const o = options(fake, { transferOwnership: true });
    const result = await ensureApplicationRole(o);
    const verifier = fake.state.roles.get(ROLE)?.verifier ?? '';

    const visible = observable(fake, o.lines, [result.detail, result.outcome, JSON.stringify({ ...result, credentials: undefined })]);
    expect(visible).not.toContain(FIXED_PASSWORD);
    expect(visible).not.toContain(ADMIN_SECRET);
    expect(visible).not.toContain(verifier);

    // The channels that DO carry them are the two meant to: env and stdin.
    const created = fake.seen.find((call) => /CREATE ROLE/.test(call.sql));
    expect(created?.env?.['PGPASSWORD']).toBe(ADMIN_SECRET);
    const set = fake.seen.find((call) => /ALTER ROLE "[^"]+" PASSWORD/.test(call.sql));
    expect(set?.env?.['PGPASSWORD']).toBe(ADMIN_SECRET);
    expect(set?.input).toContain(verifier);
    expect(set?.input).not.toContain(FIXED_PASSWORD);
    expect(set?.argv).toContain('PGPASSWORD');
    expect(set?.argv).toContain('-i');
    expect(set?.argv.at(-1)).toBe('-');
  });

  it('never leaks them through an error, even when psql echoes the failing statement', async () => {
    const fake = server({
      failures: [
        {
          match: /CREATE ROLE/,
          // psql prints the statement it choked on, verifier included, and sometimes the connection secret.
          stderr: (sql) => `ERROR:  syntax error near "x"\nLINE 1: ${sql.trim()}\nhint: password ${ADMIN_SECRET}`,
        },
      ],
    });
    const o = options(fake);
    const error = await ensureApplicationRole(o).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PreconditionError);
    const text = `${(error as Error).message}\n${(error as Error).stack ?? ''}\n${o.lines.join('\n')}`;
    expect(text).not.toContain(ADMIN_SECRET);
    expect(text).not.toContain(FIXED_PASSWORD);
    expect(text).not.toMatch(/SCRAM-SHA-256\$/);
  });

  it('never leaks them through the by-hand remedy for a managed provider', async () => {
    const fake = createFakePostgres({
      roles: { rds: ordinaryRole({ bypassRls: true, createRole: false, password: ADMIN_SECRET }) },
    });
    const error = await ensureApplicationRole(options(fake, { env: env('rds') })).catch((e: unknown) => e);
    expect((error as Error).message).not.toContain(ADMIN_SECRET);
    expect((error as Error).message).not.toContain(FIXED_PASSWORD);
    expect((error as Error).message).toContain("PASSWORD '<password>'");
  });
});

describe('the role a run provisions', () => {
  it('prefers the flag, then the application login a previous run recorded, then <app>_app', () => {
    expect(plannedRoleName({ flag: 'shop_app', recordedUser: 'old_app', adminUser: 'admin' })).toBe('shop_app');
    expect(plannedRoleName({ recordedUser: 'old_app', adminUser: 'admin' })).toBe('old_app');
    expect(plannedRoleName({ adminUser: 'admin' })).toBe('example_app');
  });

  it('passes over a recorded login that is the administrator or one this will not create', () => {
    expect(plannedRoleName({ recordedUser: 'admin', adminUser: 'admin' })).toBe('example_app');
    expect(plannedRoleName({ recordedUser: 'postgres', adminUser: 'master' })).toBe('example_app');
    expect(plannedRoleName({ recordedUser: 'has-hyphen', adminUser: 'master' })).toBe('example_app');
  });
});

describe('the answers keys', () => {
  it('splits the role keys out, so none of them can be written to .env', () => {
    const { answers, role } = extractRoleAnswers(
      new Map([
        ['DB_ADMIN_USER', 'master'],
        ['DB_ADMIN_PASSWORD', 'the-admin-secret'],
        ['APP_DB_USER', 'shop_app'],
        ['POSTGRES_DB', 'appdb'],
      ]),
    );
    expect(role).toEqual({ adminUser: 'master', adminPassword: 'the-admin-secret', appDbUser: 'shop_app' });
    expect([...(answers ?? [])]).toEqual([['POSTGRES_DB', 'appdb']]);
  });

  it('leaves an answers map with nothing else as undefined, and blanks as unset', () => {
    expect(extractRoleAnswers(new Map([['DB_ADMIN_PASSWORD', 'x']])).answers).toBeUndefined();
    expect(extractRoleAnswers(new Map([['APP_DB_USER', '']])).role).toEqual({});
    expect(extractRoleAnswers(undefined)).toEqual({ answers: undefined, role: {} });
  });
});

describe('the administrative password', () => {
  const variable = 'APPCTL_DB_ADMIN_PASSWORD';
  const before = process.env[variable];
  afterEach(() => {
    if (before === undefined) delete process.env[variable];
    else process.env[variable] = before;
  });

  it('is needed only when an administrative user is named', async () => {
    expect(await resolveAdminLogin({}, { nonInteractive: true })).toBeUndefined();
  });

  it('comes from the environment, named by the CLI identity, never from a flag', async () => {
    process.env[variable] = 'from-the-environment-secret';
    expect(await resolveAdminLogin({ adminUser: 'master' }, { nonInteractive: true })).toEqual({
      user: 'master',
      password: 'from-the-environment-secret',
    });
  });

  it('comes from the answers file when given there, ahead of the environment', async () => {
    process.env[variable] = 'from-the-environment-secret';
    expect(
      await resolveAdminLogin({ adminUser: 'master', adminPassword: 'from-the-file-secret' }, { nonInteractive: true }),
    ).toEqual({ user: 'master', password: 'from-the-file-secret' });
  });

  it('is refused, naming the variable, when nobody can supply it', async () => {
    delete process.env[variable];
    const error = await resolveAdminLogin({ adminUser: 'master' }, { nonInteractive: true }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UsageError);
    expect((error as Error).message).toContain(variable);
    expect((error as Error).message).toContain('never a flag');
  });
});

describe('the wizard under provisioning', () => {
  it('does not ask for the login the provisioning decides, and never prints the password', () => {
    const user = provisioningMetadata('example_app')('POSTGRES_USER');
    const password = provisioningMetadata('example_app')('POSTGRES_PASSWORD');
    expect(user).toMatchObject({ essential: false, fixed: 'example_app' });
    expect(password.essential).toBe(false);
    expect(password.fixed).not.toMatch(/postgres/i);
    expect(provisioningMetadata('x')('POSTGRES_DB').essential).toBe(true);
  });
});

// =============================================================================
// Order of effects: the password is changed LAST, after .env holds it  (#980)
// =============================================================================
describe('order of effects', () => {
  /** A `.env` stand-in that records when it was written, relative to the server's statements. */
  function memoryStore(fake: FakePostgres, initial: string | undefined) {
    const events: string[] = [];
    let file = initial;
    return {
      events,
      get file() {
        return file;
      },
      store: {
        write(credentials: { user: string; password: string }) {
          events.push(`write@${fake.mutations().length}`);
          file = `${credentials.user}:${credentials.password}`;
        },
        restore() {
          events.push('restore');
          file = initial;
        },
      },
    };
  }
  const PREVIOUS = 'admin:the-previous-login';
  const passwordStatements = (fake: FakePostgres) => fake.seen.filter((call) => /ALTER ROLE "[^"]+" PASSWORD/.test(call.sql));
  const failing = (fake: FakePostgres, match: RegExp, stderr = 'ERROR: boom') => fake.state.failures.push({ match, stderr });

  /** Every call BY the application role fails (pg_hba, say); the administrator is unaffected. */
  function denyRole(fake: FakePostgres, stderr: string): typeof fake.run {
    return (async (argv, run) => {
      if (argv[argv.indexOf('-U') + 1] === ROLE) {
        const saved = fake.state.failures.splice(0, fake.state.failures.length, { match: /./, stderr });
        try {
          return await fake.run(argv, run);
        } finally {
          fake.state.failures.splice(0, fake.state.failures.length, ...saved);
        }
      }
      return fake.run(argv, run);
    }) as typeof fake.run;
  }

  it('writes .env BEFORE the server learns the password, and the two agree afterwards', async () => {
    const fake = server();
    const memory = memoryStore(fake, PREVIOUS);
    const result = await ensureApplicationRole(options(fake, { store: memory.store }));

    // At the write, the server had been given the role and its grants but no password.
    expect(memory.events).toEqual([`write@${fake.mutations().length - 1}`]);
    expect(memory.file).toBe(`${ROLE}:${result.credentials?.password}`);
    expect(passwordStatements(fake)).toHaveLength(1);
    expect(verifierMatches(result.credentials?.password ?? '', fake.state.roles.get(ROLE)?.verifier ?? '')).toBe(true);
  });

  it('leaves the server untouched, password included, when .env cannot be written', async () => {
    const fake = server();
    await ensureApplicationRole(options(fake));
    const verifier = fake.state.roles.get(ROLE)?.verifier;
    const before = passwordStatements(fake).length;

    const broken = { write: () => { throw new Error('EACCES: .env is not writable'); }, restore: () => undefined };
    await expect(
      ensureApplicationRole(options(fake, { rotate: true, store: broken, generatePassword: () => 'NEW-PASSWORD-0123456789012345678901234567' })),
    ).rejects.toThrow(/EACCES/);

    expect(passwordStatements(fake)).toHaveLength(before);
    expect(fake.state.roles.get(ROLE)?.verifier).toBe(verifier);
  });

  it('puts .env back when the ALTER ROLE ... PASSWORD fails, and a new role keeps no password', async () => {
    const fake = server();
    failing(fake, /ALTER ROLE "[^"]+" PASSWORD/);
    const memory = memoryStore(fake, PREVIOUS);

    const error = await ensureApplicationRole(options(fake, { store: memory.store })).catch((e: unknown) => e);

    expect((error as Error).message).toMatch(/Could not set the password/);
    expect((error as Error).message).toContain('.env was left as it was');
    expect(memory.events.at(-1)).toBe('restore');
    expect(memory.file).toBe(PREVIOUS);
    expect(fake.state.roles.get(ROLE)?.verifier).toBeUndefined();
  });

  it('puts .env back when an EXISTING role fails to take the new password: old server password and old .env agree', async () => {
    const fake = server();
    const first = await ensureApplicationRole(options(fake));
    const verifier = fake.state.roles.get(ROLE)?.verifier;
    failing(fake, /ALTER ROLE "[^"]+" PASSWORD/);
    const memory = memoryStore(fake, `${ROLE}:${first.credentials?.password}`);

    await expect(ensureApplicationRole(options(fake, { rotate: true, store: memory.store }))).rejects.toThrow(/Could not set/);

    expect(memory.file).toBe(`${ROLE}:${first.credentials?.password}`);
    expect(fake.state.roles.get(ROLE)?.verifier).toBe(verifier);
  });

  it('never writes .env or sets a password when the ownership transfer fails', async () => {
    const fake = server({
      databases: ['appdb'],
      owners: { appdb: { databaseOwner: 'admin', schemaOwner: 'admin', toMove: 3, total: 4 } },
      failures: [{ match: /ALTER DATABASE/, stderr: 'ERROR: must be owner of database appdb' }],
    });
    const memory = memoryStore(fake, PREVIOUS);

    const error = await ensureApplicationRole(options(fake, { transferOwnership: true, store: memory.store })).catch((e: unknown) => e);

    expect((error as Error).message).toMatch(/no password was set/);
    expect(memory.events).toEqual([]);
    expect(memory.file).toBe(PREVIOUS);
    expect(passwordStatements(fake)).toHaveLength(0);
  });

  it('never writes .env or sets a password when a reduced role is not accepted', async () => {
    const fake = server({ failures: [{ match: /ALTER ROLE "[^"]+" CREATEROLE/, stderr: 'ERROR:  permission denied to alter role (42501)' }] });
    const memory = memoryStore(fake, PREVIOUS);
    await expect(ensureApplicationRole(options(fake, { store: memory.store }))).rejects.toThrow(/--allow-reduced-role/);
    expect(memory.events).toEqual([]);
    expect(passwordStatements(fake)).toHaveLength(0);
  });

  it('after the password is set but the role cannot log in, .env goes back when it held another login (the admin still works)', async () => {
    const fake = server();
    const memory = memoryStore(fake, PREVIOUS);
    const error = await ensureApplicationRole(
      options(fake, { store: memory.store, runCommand: denyRole(fake, 'psql: error: FATAL:  no pg_hba.conf entry for host "10.0.0.2", user "example_app" (28000)') }),
    ).catch((e: unknown) => e);

    expect((error as Error).message).toContain('pg_hba.conf has no entry');
    expect((error as Error).message).toContain('.env is back to its previous login');
    expect(memory.file).toBe(PREVIOUS);
  });

  it('after the password is set but the proof fails, .env KEEPS the new password when it already held this role', async () => {
    const fake = server();
    const first = await ensureApplicationRole(options(fake));
    const memory = memoryStore(fake, `${ROLE}:${first.credentials?.password}`);

    const error = await ensureApplicationRole(
      options(fake, {
        rotate: true,
        store: memory.store,
        recordedEnv: env(ROLE, first.credentials?.password ?? ''),
        generatePassword: () => 'ROTATED-PASSWORD-0123456789abcdefghijklmnopq',
        runCommand: denyRole(fake, 'psql: error: FATAL:  no pg_hba.conf entry (28000)'),
      }),
    ).catch((e: unknown) => e);

    expect((error as Error).message).toMatch(/NEW password.*\.env holds it/s);
    // The server has the new password, and so does .env: nothing is locked out.
    expect(memory.file).toBe(`${ROLE}:ROTATED-PASSWORD-0123456789abcdefghijklmnopq`);
    expect(verifierMatches('ROTATED-PASSWORD-0123456789abcdefghijklmnopq', fake.state.roles.get(ROLE)?.verifier ?? '')).toBe(true);
  });

  it('rotating with the role alone writes .env first and restores it when the ALTER fails', async () => {
    const fake = server({ databases: ['appdb'] });
    const first = await ensureApplicationRole(options(fake));
    const login = env(ROLE, first.credentials?.password ?? '');
    const verifier = fake.state.roles.get(ROLE)?.verifier;

    const failed = memoryStore(fake, `${ROLE}:${first.credentials?.password}`);
    failing(fake, /ALTER ROLE "[^"]+" PASSWORD/);
    await expect(
      ensureApplicationRole(options(fake, { env: login, provisionConsent: undefined, rotate: true, store: failed.store })),
    ).rejects.toThrow(/\.env was left as it was/);
    expect(failed.file).toBe(`${ROLE}:${first.credentials?.password}`);
    expect(fake.state.roles.get(ROLE)?.verifier).toBe(verifier);

    fake.state.failures.length = 0;
    const broken = { write: () => { throw new Error('EROFS'); }, restore: () => undefined };
    const before = passwordStatements(fake).length;
    await expect(
      ensureApplicationRole(options(fake, { env: login, provisionConsent: undefined, rotate: true, store: broken })),
    ).rejects.toThrow(/EROFS/);
    expect(passwordStatements(fake)).toHaveLength(before);
  });

  it('tells the journal about the password and its verifier BEFORE any statement carries them', async () => {
    const fake = server();
    const told: Array<{ key: string; value: string; mutations: number; carried: boolean }> = [];
    await ensureApplicationRole(
      options(fake, {
        onSecrets: (secrets) => {
          for (const secret of secrets) {
            told.push({
              ...secret,
              mutations: fake.mutations().length,
              carried: fake.seen.some((call) => (call.input ?? '').includes(secret.value)),
            });
          }
        },
      }),
    );

    expect(told.map((entry) => entry.key)).toEqual(['POSTGRES_PASSWORD', 'POSTGRES_PASSWORD_VERIFIER']);
    expect(told[0]?.value).toBe(FIXED_PASSWORD);
    expect(told[1]?.value).toMatch(/^SCRAM-SHA-256\$/);
    for (const entry of told) {
      expect(entry.mutations).toBe(0);
      expect(entry.carried).toBe(false);
    }
  });
});

describe('a database called my-app or my.app', () => {
  for (const name of ['my-app', 'my.app']) {
    it(`is quoted, not refused: "${name}" is provisioned and its objects re-owned`, async () => {
      const fake = server({
        databases: [name],
        owners: { [name]: { databaseOwner: 'admin', schemaOwner: 'admin', toMove: 5, total: 9 } },
      });
      const result = await ensureApplicationRole(
        options(fake, { env: env('admin', ADMIN_SECRET, { POSTGRES_DB: name }), transferOwnership: true }),
      );
      expect(result.ownershipTransferred).toBe(true);
      expect(fake.seen.find((call) => /ALTER DATABASE/.test(call.sql))?.sql).toContain(`ALTER DATABASE "${name}" OWNER TO`);
    });

    it(`does not make an unattended update throw for "${name}"`, async () => {
      const fake = server({ databases: [name], owners: { [name]: { databaseOwner: ROLE, schemaOwner: ROLE, toMove: 0, total: 2 } } });
      const result = await ensureApplicationRole(
        options(fake, { env: env('admin', ADMIN_SECRET, { POSTGRES_DB: name }), whenNotConsented: 'warn' }),
      );
      expect(result.outcome).toBe('provisioned');
    });
  }
});

describe('update downgrades whatever goes wrong before the server changed', () => {
  const warn = { whenNotConsented: 'warn' as const };

  it('an unreadable role lookup is a warning, not a failure', async () => {
    const fake = server({ failures: [{ match: /from pg_roles where rolname = 'example_app'/, stderr: 'ERROR: boom' }] });
    const o = options(fake, warn);
    const result = await ensureApplicationRole(o);
    expect(result.outcome).toBe('declined');
    expect(o.lines.join('\n')).toMatch(/Could not look up role/);
    expect(fake.mutations()).toHaveLength(0);
  });

  it('an invalid role name, an administrator named as the role and an unreachable explicit admin are warnings too', async () => {
    const fake = server();
    expect((await ensureApplicationRole(options(fake, { ...warn, roleName: 'bad-name' }))).outcome).toBe('declined');
    expect((await ensureApplicationRole(options(fake, { ...warn, roleName: 'admin' }))).outcome).toBe('declined');
    expect(
      (await ensureApplicationRole(options(fake, { ...warn, admin: { user: 'admin', password: 'wrong' } }))).outcome,
    ).toBe('declined');
  });

  it('a pre-existing role the check cannot vouch for is a warning, and its password is left alone', async () => {
    const fake = server();
    await ensureApplicationRole(options(fake));
    const verifier = fake.state.roles.get(ROLE)?.verifier;
    const result = await ensureApplicationRole(options(fake, warn));
    expect(result.outcome).toBe('declined');
    expect(fake.state.roles.get(ROLE)?.verifier).toBe(verifier);
  });

  it('install (refuse) still throws for the same things', async () => {
    const fake = server();
    await expect(ensureApplicationRole(options(fake, { roleName: 'bad-name' }))).rejects.toThrow(UsageError);
  });

  it('a failure AFTER the server changed is still a failure', async () => {
    const fake = server({ failures: [{ match: /ALTER ROLE "[^"]+" PASSWORD/, stderr: 'ERROR: boom' }] });
    await expect(ensureApplicationRole(options(fake, warn))).rejects.toThrow(/Could not set the password/);
  });
});

describe('the temporary membership of a non-superuser administrator', () => {
  const existing = { appdb: { databaseOwner: 'rds', schemaOwner: 'rds', toMove: 3, total: 4 } };
  const rds = () => ({ rds: ordinaryRole({ bypassRls: true, password: ADMIN_SECRET }) });

  it('is granted before the ownership transfer and revoked after it, when this run created it', async () => {
    const fake = createFakePostgres({ roles: rds(), databases: ['appdb'], owners: existing });
    await ensureApplicationRole(options(fake, { env: env('rds'), transferOwnership: true }));
    const sql = fake.mutations().map((call) => call.sql.trim());
    const grant = sql.findIndex((statement) => statement === `GRANT "${ROLE}" TO "rds";`);
    const owner = sql.findIndex((statement) => /ALTER DATABASE/.test(statement));
    const revoke = sql.findIndex((statement) => statement === `REVOKE "${ROLE}" FROM "rds";`);
    expect(grant).toBeGreaterThanOrEqual(0);
    expect(grant).toBeLessThan(owner);
    expect(owner).toBeLessThan(revoke);
    expect(fake.state.memberships.has(`${ROLE}>rds`)).toBe(false);
  });

  it('is left alone when the administrator could already act as the role', async () => {
    const fake = createFakePostgres({ roles: rds(), databases: ['appdb'], owners: existing });
    fake.state.memberships.add(`${ROLE}>rds`);
    await ensureApplicationRole(options(fake, { env: env('rds'), transferOwnership: true }));
    expect(fake.mutations().some((call) => /^(GRANT|REVOKE) /.test(call.sql.trim()))).toBe(false);
    expect(fake.state.memberships.has(`${ROLE}>rds`)).toBe(true);
  });

  it('is revoked even when the transfer fails', async () => {
    const fake = createFakePostgres({
      roles: rds(),
      databases: ['appdb'],
      owners: existing,
      failures: [{ match: /ALTER DATABASE/, stderr: 'ERROR: must be owner' }],
    });
    await expect(ensureApplicationRole(options(fake, { env: env('rds'), transferOwnership: true }))).rejects.toThrow(/Could not transfer/);
    expect(fake.state.memberships.has(`${ROLE}>rds`)).toBe(false);
  });

  it('checks the GRANT: a failure is reported instead of a confusing ownership error', async () => {
    const fake = createFakePostgres({
      roles: rds(),
      databases: ['appdb'],
      owners: existing,
      failures: [{ match: /^GRANT /, stderr: 'ERROR: permission denied to grant role' }],
    });
    const error = await ensureApplicationRole(options(fake, { env: env('rds'), transferOwnership: true })).catch((e: unknown) => e);
    expect((error as Error).message).toMatch(/cannot act as/);
    expect(fake.seen.some((call) => /ALTER DATABASE/.test(call.sql))).toBe(false);
  });
});
