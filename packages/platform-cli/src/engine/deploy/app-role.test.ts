import { createHash, createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { PreconditionError, UsageError } from '../errors.js';
import { replaceCliIdentityForTests } from '../identity.js';
import {
  assertCreatableRoleName,
  createRoleStatement,
  defaultAppRoleName,
  ensureApplicationRole,
  generateAppPassword,
  grantCreateRoleStatement,
  ownershipScript,
  scramSha256Verifier,
  selfGrantStatement,
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
  it('creates the role with exactly the attributes 10-application-role.sh gives', () => {
    expect(createRoleStatement(ROLE, 'SCRAM-SHA-256$4096:s$k:k')).toBe(
      `CREATE ROLE "${ROLE}" LOGIN NOSUPERUSER NOBYPASSRLS CREATEDB PASSWORD 'SCRAM-SHA-256$4096:s$k:k'`,
    );
    expect(grantCreateRoleStatement(ROLE)).toBe(`ALTER ROLE "${ROLE}" CREATEROLE`);
    expect(selfGrantStatement(ROLE)).toBe(`ALTER ROLE "${ROLE}" SET createrole_self_grant = 'inherit, set'`);
  });

  it('transfers ownership object by object, in one transaction, and never REASSIGN OWNED', () => {
    const script = ownershipScript(ROLE, 'appdb');
    expect(script).toMatch(/^BEGIN;/);
    expect(script).toMatch(/COMMIT;\n$/);
    expect(script).toContain(`ALTER DATABASE "appdb" OWNER TO "${ROLE}";`);
    expect(script).toContain(`ALTER SCHEMA public OWNER TO "${ROLE}";`);
    for (const kind of ['ALTER %s public.%I OWNER TO', 'ALTER SEQUENCE public.%I OWNER TO', 'ALTER TYPE public.%I OWNER TO', 'ALTER %s %s OWNER TO']) {
      expect(script).toContain(kind);
    }
    expect(script).not.toMatch(/REASSIGN/i);
    expect(script).not.toMatch(/\bDROP\b/i);
    // Extension-owned objects and column-linked sequences are left to their owners.
    expect(script).toContain("e.deptype = 'e'");
    expect(script).toContain("l.deptype IN ('a','i')");
  });

  it('refuses an identifier that would extend a statement', () => {
    expect(() => createRoleStatement('x"; DROP ROLE y; --', 'v')).toThrow(UsageError);
    expect(() => ownershipScript(ROLE, 'a"; DROP DATABASE x; --')).toThrow(UsageError);
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
    expect(statements[0]).toContain(`CREATE ROLE "${ROLE}" LOGIN NOSUPERUSER NOBYPASSRLS CREATEDB PASSWORD 'SCRAM-SHA-256$`);
    expect(statements).toContainEqual(`ALTER ROLE "${ROLE}" CREATEROLE;\n`);
    expect(statements).toContainEqual(`ALTER ROLE "${ROLE}" SET createrole_self_grant = 'inherit, set';\n`);
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

  it('sets a password when the role exists but nothing on record opens it (a crashed first run)', async () => {
    const fake = server();
    await ensureApplicationRole(options(fake, { generatePassword: () => 'LOST-PASSWORD-0123456789012345678901234567' }));

    const result = await ensureApplicationRole(options(fake));
    expect(result.created).toBe(false);
    expect(result.credentials?.password).toBe(FIXED_PASSWORD);
    expect(verifierMatches(FIXED_PASSWORD, fake.state.roles.get(ROLE)?.verifier ?? '')).toBe(true);
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
    expect(script?.sql).toContain(`ALTER SCHEMA public OWNER TO "${ROLE}"`);
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
    const fake = server();
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
    expect(created?.input).toContain(verifier);
    expect(created?.input).not.toContain(FIXED_PASSWORD);
    expect(created?.argv).toContain('PGPASSWORD');
    expect(created?.argv).toContain('-i');
    expect(created?.argv.at(-1)).toBe('-');
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
