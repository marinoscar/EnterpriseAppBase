import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { parseEnvExample, parseEnvFile } from './env-spec.js';
import { runInstall, type InstallOptions } from './install.js';
import { deployStatePath, readState } from './state.js';
import { verifierMatches, createFakePostgres, ordinaryRole, postgresRoute, superRole } from './testing/fake-postgres.js';
import {
  createFakeVps,
  fakeGoogleFetch,
  listenForProbe,
  serveHealth,
  unattendedAnswers,
} from './testing/fake-vps.js';

// =============================================================================
// `deploy install` provisions the application role  (issue #980)
// =============================================================================
//
// The REAL install pipeline against the stateful fake PostgreSQL: the operator
// types an administrative login, and what reaches `.env` is a dedicated,
// ordinary role with a generated password -- the administrator nowhere.
// =============================================================================

const TEMPLATE = readFileSync(
  resolve(__dirname, '..', '..', '..', '..', '..', 'infra', 'compose', '.env.example'),
  'utf8',
);
const SPECS = parseEnvExample(TEMPLATE);

// Fixtures, not credentials.
const ADMIN_SECRET = 'admin-secret-7f3a91c2-zz';
const ROLE = 'example_app';

let probe: Awaited<ReturnType<typeof listenForProbe>>;
let api: Awaited<ReturnType<typeof serveHealth>>;
let ANSWERS: Map<string, string>;

beforeAll(async () => {
  probe = await listenForProbe();
  api = await serveHealth();
  ANSWERS = unattendedAnswers(
    SPECS,
    new Map([
      ['POSTGRES_HOST', '127.0.0.1'],
      ['POSTGRES_PORT', String(probe.port)],
      ['POSTGRES_USER', 'admin'],
      ['POSTGRES_PASSWORD', ADMIN_SECRET],
      ['POSTGRES_DB', 'appdb'],
    ]),
  );
});

afterAll(async () => {
  await probe.close();
  await api.close();
});

function setup(postgres = createFakePostgres({ roles: { admin: superRole({ password: ADMIN_SECRET }) }, databases: ['appdb'] })) {
  const vps = createFakeVps({
    envExample: TEMPLATE,
    routes: [
      { match: (invocation) => invocation.argv.includes('curl'), answer: '200' },
      postgresRoute(postgres),
    ],
  });
  return { vps, postgres };
}

function install(
  vps: ReturnType<typeof createFakeVps>,
  extra: Partial<InstallOptions> & { without?: readonly string[] } = {},
) {
  const { answers: extraAnswers, without = [], ...rest } = extra;
  const answers = new Map([
    ...ANSWERS,
    ['POSTGRES_PORT', String(probe.port)],
    ...(extraAnswers ?? []),
  ]);
  for (const key of without) answers.delete(key);
  return runInstall({
    deployRoot: vps.deployRoot,
    bindPort: api.port,
    proxyRoot: join(vps.appsRoot, 'proxy'),
    domain: 'app.example.test',
    repo: 'https://example.test/o/r',
    ref: 'main',
    runCommand: vps.runCommand,
    fetch: fakeGoogleFetch().fetch,
    answers,
    nonInteractive: true,
    skipDoctor: true,
    skipProxy: true,
    skipSeed: true,
    noVersionBump: true,
    ...rest,
  });
}

const envOf = (vps: ReturnType<typeof createFakeVps>): Map<string, string> =>
  parseEnvFile(readFileSync(join(vps.deployRoot, 'repo', 'infra', 'compose', '.env'), 'utf8'));

/** Every file under the deployment root that is not the repository clone's own contents. */
function everyFile(root: string): string[] {
  const found: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else found.push(path);
    }
  };
  walk(root);
  return found;
}

describe('install with an administrative login', () => {
  it('provisions the role and writes the role, not the administrator, to .env', async () => {
    const { vps, postgres } = setup();
    await install(vps, { provisionAppRole: true, transferOwnership: true });

    const env = envOf(vps);
    expect(env.get('POSTGRES_USER')).toBe(ROLE);
    const password = env.get('POSTGRES_PASSWORD') ?? '';
    expect(password).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(password).not.toBe(ADMIN_SECRET);

    // The role exists, ordinary, and opens with exactly the password in .env.
    const role = postgres.state.roles.get(ROLE);
    expect(role).toMatchObject({ superuser: false, bypassRls: false, createRole: true, createDb: true });
    expect(verifierMatches(password, role?.verifier ?? '')).toBe(true);

    expect(statSync(join(vps.deployRoot, 'repo', 'infra', 'compose', '.env')).mode & 0o777).toBe(0o600);
    expect(readState(vps.deployRoot)?.lastOutcome).toBe('success');
    // And the pipeline carried on: the migration ran, as the role (it reads .env).
    expect(vps.calls('docker', 'compose').some((call) => call.argv.includes('prisma:migrate'))).toBe(true);
  });

  it('moves an existing database to the role, only with consent', async () => {
    const postgres = createFakePostgres({
      roles: { admin: superRole({ password: ADMIN_SECRET }) },
      databases: ['appdb'],
      owners: { appdb: { databaseOwner: 'admin', schemaOwner: 'admin', toMove: 30, total: 41 } },
    });
    const { vps } = setup(postgres);

    await expect(install(vps, { provisionAppRole: true })).rejects.toThrow(/--transfer-ownership/);
    expect(postgres.mutations()).toHaveLength(0);
    expect(readState(vps.deployRoot)?.lastFailedStep).toBe('environment');

    const again = setup(postgres);
    await install(again.vps, { provisionAppRole: true, transferOwnership: true });
    expect(postgres.state.owners.get('appdb')).toMatchObject({ databaseOwner: ROLE, schemaOwner: ROLE });
    expect(postgres.seen.some((call) => /REASSIGN/i.test(call.sql))).toBe(false);
  });

  it('refuses to start the API as a superuser when nobody consented, naming the flags', async () => {
    const { vps, postgres } = setup();
    const error = await install(vps).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    for (const flag of ['--provision-app-role', '--skip-role-provisioning', '--allow-superuser']) {
      expect((error as Error).message).toContain(flag);
    }
    expect(postgres.mutations()).toHaveLength(0);
    // Nothing of the administrator reached the disk.
    expect(existsSync(join(vps.deployRoot, 'repo', 'infra', 'compose', '.env'))).toBe(false);
    for (const file of everyFile(vps.deployRoot)) {
      expect(readFileSync(file, 'utf8'), file).not.toContain(ADMIN_SECRET);
    }
  });

  it('with --skip-role-provisioning, database-role-ordinary stops a superuser at validate-environment', async () => {
    const { vps, postgres } = setup();
    const error = await install(vps, { skipRoleProvisioning: true }).catch((caught: unknown) => caught);

    expect((error as Error).message).toContain('row-level security is INERT');
    expect((error as Error).message).toContain('--provision-app-role');
    expect(readState(vps.deployRoot)?.lastFailedStep).toBe('validate-environment');
    expect(postgres.mutations()).toHaveLength(0);
  });

  it('with --skip-role-provisioning, an ordinary role the operator supplies passes the check', async () => {
    const postgres = createFakePostgres({
      roles: { shop: ordinaryRole({ password: 'shop-password-0123456789' }) },
      databases: ['appdb'],
    });
    const { vps } = setup(postgres);
    await install(vps, {
      skipRoleProvisioning: true,
      answers: new Map([
        ['POSTGRES_USER', 'shop'],
        ['POSTGRES_PASSWORD', 'shop-password-0123456789'],
      ]),
    });
    expect(envOf(vps).get('POSTGRES_USER')).toBe('shop');
    expect(postgres.mutations()).toHaveLength(0);
  });

  it('with --allow-superuser, proceeds, says tenant isolation is off, and records the choice', async () => {
    const { vps } = setup();
    const progress: string[] = [];
    await install(vps, {
      allowSuperuser: true,
      hooks: { onProgress: (message: string) => progress.push(message) },
    });

    expect(envOf(vps).get('POSTGRES_USER')).toBe('admin');
    expect(progress.join('\n')).toMatch(/Tenant isolation is OFF/);
    expect(readState(vps.deployRoot)?.allowSuperuser).toBe(true);

    const journal = everyFile(join(vps.deployRoot, 'logs'))
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n');
    expect(journal).toMatch(/Tenant isolation is OFF/);
  });
});

describe('install with --admin-user (non-interactive)', () => {
  const asAdmin = { adminUser: 'admin', adminPassword: ADMIN_SECRET };

  it('asks for no database login: the application role is decided by provisioning', async () => {
    const { vps, postgres } = setup();
    await install(vps, { ...asAdmin, without: ['POSTGRES_USER', 'POSTGRES_PASSWORD'] });

    expect(envOf(vps).get('POSTGRES_USER')).toBe(ROLE);
    expect(postgres.state.roles.has(ROLE)).toBe(true);
    expect(readState(vps.deployRoot)?.lastOutcome).toBe('success');
  });

  it('honours --app-db-user', async () => {
    const { vps, postgres } = setup();
    await install(vps, { ...asAdmin, appDbUser: 'shop_app', without: ['POSTGRES_USER', 'POSTGRES_PASSWORD'] });
    expect(envOf(vps).get('POSTGRES_USER')).toBe('shop_app');
    expect(postgres.state.roles.has('shop_app')).toBe(true);
  });

  it('fails clearly, naming the environment variable, when the administrative password is nowhere', async () => {
    const { vps } = setup();
    await expect(
      install(vps, { adminUser: 'admin', without: ['POSTGRES_USER', 'POSTGRES_PASSWORD'] }),
    ).rejects.toThrow(/APPCTL_DB_ADMIN_PASSWORD/);
  });
});

describe('install is idempotent and resumable', () => {
  it('re-running over its own .env needs no administrator and changes nothing on the server', async () => {
    const { vps, postgres } = setup();
    await install(vps, { provisionAppRole: true, transferOwnership: true });
    const first = envOf(vps);
    const mutations = postgres.mutations().length;

    // The operator now supplies the application login (the .env on disk), not the administrator.
    await install(vps, {
      reinstall: true,
      answers: new Map([
        ['POSTGRES_USER', first.get('POSTGRES_USER') ?? ''],
        ['POSTGRES_PASSWORD', first.get('POSTGRES_PASSWORD') ?? ''],
      ]),
    });

    expect(postgres.mutations()).toHaveLength(mutations);
    expect(envOf(vps).get('POSTGRES_USER')).toBe(ROLE);
    expect(envOf(vps).get('POSTGRES_PASSWORD')).toBe(first.get('POSTGRES_PASSWORD'));
  });

  it('re-running with the administrator again reuses the role and its recorded password', async () => {
    const { vps, postgres } = setup();
    await install(vps, { provisionAppRole: true, transferOwnership: true });
    const first = envOf(vps);
    const verifier = postgres.state.roles.get(ROLE)?.verifier;

    await install(vps, { reinstall: true, provisionAppRole: true, transferOwnership: true });

    expect(envOf(vps).get('POSTGRES_PASSWORD')).toBe(first.get('POSTGRES_PASSWORD'));
    expect(postgres.state.roles.get(ROLE)?.verifier).toBe(verifier);
  });

  it('rotates the password on request, and only then', async () => {
    const { vps, postgres } = setup();
    await install(vps, { provisionAppRole: true, transferOwnership: true });
    const first = envOf(vps).get('POSTGRES_PASSWORD');

    await install(vps, { reinstall: true, provisionAppRole: true, transferOwnership: true, rotateAppPassword: true });

    const rotated = envOf(vps).get('POSTGRES_PASSWORD');
    expect(rotated).not.toBe(first);
    expect(verifierMatches(rotated ?? '', postgres.state.roles.get(ROLE)?.verifier ?? '')).toBe(true);
    expect(verifierMatches(first ?? '', postgres.state.roles.get(ROLE)?.verifier ?? '')).toBe(false);
  });
});

describe('secret egress, through the whole pipeline', () => {
  it('keeps the administrator and the generated password out of argv, the journal, the state and the info document', async () => {
    const { vps } = setup();
    const progress: string[] = [];
    const result = await install(vps, {
      provisionAppRole: true,
      transferOwnership: true,
      hooks: { onProgress: (message: string) => progress.push(message), onLog: (line: string) => progress.push(line) },
    });

    const password = envOf(vps).get('POSTGRES_PASSWORD') ?? '';
    expect(password).not.toBe('');

    const argv = vps.invocations.map((call) => call.argv.join(' ')).join('\n');
    expect(argv).not.toContain(ADMIN_SECRET);
    expect(argv).not.toContain(password);

    // The password is in exactly one file on disk: .env.
    const holders = everyFile(vps.deployRoot).filter((file) => readFileSync(file, 'utf8').includes(password));
    expect(holders).toEqual([join(vps.deployRoot, 'repo', 'infra', 'compose', '.env')]);

    // The administrator is in none.
    for (const file of everyFile(vps.deployRoot)) {
      expect(readFileSync(file, 'utf8'), file).not.toContain(ADMIN_SECRET);
    }
    expect(readFileSync(deployStatePath(vps.deployRoot), 'utf8')).not.toContain(password);

    // Nor on screen, and the result only carries it on request.
    expect(progress.join('\n')).not.toContain(password);
    expect(progress.join('\n')).not.toContain(ADMIN_SECRET);
    expect(JSON.stringify(result)).not.toContain(password);
    expect(result.credentials).toBeUndefined();

    // The channels that do carry them are the ones meant to.
    const created = vps.invocations.find((call) => /CREATE ROLE/.test(call.input ?? ''));
    expect(created?.env?.['PGPASSWORD']).toBe(ADMIN_SECRET);
    expect(created?.input).not.toContain(password);
  });

  it('shows the credentials only with --show-credentials, and still never in the journal', async () => {
    const { vps } = setup();
    const result = await install(vps, { provisionAppRole: true, transferOwnership: true, showCredentials: true });

    const password = envOf(vps).get('POSTGRES_PASSWORD') ?? '';
    expect(result.credentials).toEqual({ user: ROLE, password });

    const journal = everyFile(join(vps.deployRoot, 'logs'))
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n');
    expect(journal).not.toContain(password);
  });

  it('keeps them out of the journal when the provisioning fails and psql echoes the statement', async () => {
    const postgres = createFakePostgres({
      roles: { admin: superRole({ password: ADMIN_SECRET }) },
      databases: ['appdb'],
      failures: [
        {
          match: /ALTER ROLE "[^"]+" SET createrole_self_grant/,
          stderr: (sql) => `ERROR:  permission denied to set parameter\nLINE 1: ${sql.trim()}\nPGPASSWORD=${ADMIN_SECRET}`,
        },
      ],
    });
    const { vps } = setup(postgres);

    const error = await install(vps, { provisionAppRole: true }).catch((caught: unknown) => caught);
    expect((error as Error).message).toContain('createrole_self_grant');
    expect((error as Error).message).toContain('--allow-reduced-role');

    for (const file of everyFile(vps.deployRoot)) {
      const text = readFileSync(file, 'utf8');
      expect(text, file).not.toContain(ADMIN_SECRET);
      expect(text, file).not.toMatch(/SCRAM-SHA-256\$/);
    }
    expect((error as Error).message).not.toContain(ADMIN_SECRET);
  });
});

describe('install keeps .env and the server in agreement (#980)', () => {
  const envPath = (vps: ReturnType<typeof createFakeVps>) => join(vps.deployRoot, 'repo', 'infra', 'compose', '.env');

  it('writes a whole .env before the server learns the password', async () => {
    const { vps, postgres } = setup();
    let atPassword: Map<string, string> | undefined;
    const run = vps.runCommand;
    vps.runCommand = (async (argv, options) => {
      if (/ALTER ROLE "[^"]+" PASSWORD/.test(options.input ?? '')) atPassword = envOf(vps);
      return run(argv, options);
    }) as typeof vps.runCommand;

    await install(vps, { provisionAppRole: true });

    expect(atPassword?.get('POSTGRES_USER')).toBe(ROLE);
    // A complete file, not a fragment: the CLI's own markers are there already.
    expect(atPassword?.get('DEPLOY_ROOT')).toBe(vps.deployRoot);
    expect(atPassword?.get('APP_BIND_PORT')).toBe(String(api.port));
    expect(verifierMatches(atPassword?.get('POSTGRES_PASSWORD') ?? '', postgres.state.roles.get(ROLE)?.verifier ?? '')).toBe(true);
  });

  it('removes the .env it wrote when the server refuses the password, so the administrator was never left on disk', async () => {
    const postgres = createFakePostgres({
      roles: { admin: superRole({ password: ADMIN_SECRET }) },
      databases: ['appdb'],
      failures: [{ match: /ALTER ROLE "[^"]+" PASSWORD/, stderr: 'ERROR: boom' }],
    });
    const { vps } = setup(postgres);

    await expect(install(vps, { provisionAppRole: true })).rejects.toThrow(/Could not set the password/);

    expect(existsSync(envPath(vps))).toBe(false);
    expect(postgres.state.roles.get(ROLE)?.verifier).toBeUndefined();
    for (const file of everyFile(vps.deployRoot)) {
      expect(readFileSync(file, 'utf8'), file).not.toContain(ADMIN_SECRET);
    }
  });

  it('restores the previous .env, not a hole, when there was one', async () => {
    const { vps, postgres } = setup();
    await install(vps, { provisionAppRole: true });
    const before = readFileSync(envPath(vps), 'utf8');
    postgres.state.failures.push({ match: /ALTER ROLE "[^"]+" PASSWORD/, stderr: 'ERROR: boom' });

    await expect(install(vps, { reinstall: true, provisionAppRole: true, rotateAppPassword: true })).rejects.toThrow(/Could not set/);

    expect(readFileSync(envPath(vps), 'utf8')).toBe(before);
    expect(statSync(envPath(vps)).mode & 0o777).toBe(0o600);
  });

  it('records --allow-superuser for the login it kept, and drops it once the login is a provisioned role', async () => {
    const { vps } = setup();
    await install(vps, { allowSuperuser: true });
    expect(readState(vps.deployRoot)).toMatchObject({ allowSuperuser: true, allowSuperuserLogin: 'admin' });

    await install(vps, { reinstall: true, provisionAppRole: true, transferOwnership: true });
    expect(readState(vps.deployRoot)?.allowSuperuser).toBeUndefined();
    expect(readState(vps.deployRoot)?.allowSuperuserLogin).toBeUndefined();
  });

  it('refuses to reset a role it did not make, and writes no .env for the attempt', async () => {
    const postgres = createFakePostgres({
      roles: {
        admin: superRole({ password: ADMIN_SECRET }),
        [ROLE]: ordinaryRole({ password: 'another-deployments-password-0123' }),
      },
      databases: ['appdb'],
    });
    const { vps } = setup(postgres);

    await expect(install(vps, { provisionAppRole: true })).rejects.toThrow(/--rotate-app-password/);

    expect(existsSync(envPath(vps))).toBe(false);
    expect(postgres.mutations()).toHaveLength(0);
    expect(postgres.state.roles.get(ROLE)?.password).toBe('another-deployments-password-0123');
  });
});
