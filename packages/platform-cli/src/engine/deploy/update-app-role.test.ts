import { mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { parseEnvExample, parseEnvFile } from './env-spec.js';
import { runInstall, type InstallOptions } from './install.js';
import { readState, writeState, type DeployState } from './state.js';
import { createFakePostgres, postgresRoute, superRole, ordinaryRole, verifierMatches } from './testing/fake-postgres.js';
import {
  createFakeVps,
  fakeGoogleFetch,
  listenForProbe,
  serveHealth,
  unattendedAnswers,
} from './testing/fake-vps.js';
import { runUpdate, type UpdateOptions } from './update.js';

// =============================================================================
// `deploy update` moves a superuser deployment onto a dedicated role  (#980)
// =============================================================================
//
// A deployment installed before this, with the operator's administrative login
// in `.env`. update detects it, and -- consented -- provisions the role, moves
// ownership, rewrites `.env` with the one atomic writer and restarts the api.
// Without consent it WARNS and carries on: an unattended update must not start
// failing on a deployment that predates this.
// =============================================================================

const TEMPLATE = readFileSync(
  resolve(__dirname, '..', '..', '..', '..', '..', 'infra', 'compose', '.env.example'),
  'utf8',
);
const SPECS = parseEnvExample(TEMPLATE);

const ADMIN_SECRET = 'admin-secret-7f3a91c2-zz';
const ROLE = 'example_app';
const DF = 'Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/sda1 100000000 10000000 80000000 12% /';

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

const existingData = { appdb: { databaseOwner: 'admin', schemaOwner: 'admin', toMove: 30, total: 41 } };

/** A deployment installed the old way: the administrator's login is in .env, and nothing recorded a choice. */
async function legacyDeployment(roles = { admin: superRole({ password: ADMIN_SECRET }) } as Record<string, ReturnType<typeof superRole>>) {
  const postgres = createFakePostgres({ roles, databases: ['appdb'], owners: existingData });
  const vps = createFakeVps({
    envExample: TEMPLATE,
    routes: [{ match: (invocation) => invocation.argv.includes('curl'), answer: '200' }, postgresRoute(postgres)],
  });
  const options: InstallOptions = {
    deployRoot: vps.deployRoot,
    bindPort: api.port,
    proxyRoot: join(vps.appsRoot, 'proxy'),
    domain: 'app.example.test',
    repo: 'https://example.test/o/r',
    ref: 'main',
    runCommand: vps.runCommand,
    fetch: fakeGoogleFetch().fetch,
    answers: new Map([...ANSWERS, ['POSTGRES_PORT', String(probe.port)]]),
    nonInteractive: true,
    skipDoctor: true,
    skipProxy: true,
    skipSeed: true,
    noVersionBump: true,
    // How the old install behaved: it took the login as typed.
    allowSuperuser: true,
  };
  await runInstall(options);

  // Forget that choice, as a deployment from before this would have.
  const recorded = readState(vps.deployRoot) as DeployState;
  delete recorded.allowSuperuser;
  writeState(recorded);

  mkdirSync(join(vps.deployRoot, 'repo', '.git'), { recursive: true });
  vps.route(['df'], DF);
  vps.route(['git', 'rev-parse', 'HEAD'], 'e'.repeat(40));
  postgres.seen.length = 0;
  vps.invocations.length = 0;
  return { vps, postgres };
}

function update(vps: ReturnType<typeof createFakeVps>, extra: Partial<UpdateOptions> = {}) {
  return runUpdate({
    deployRoot: vps.deployRoot,
    runCommand: vps.runCommand,
    fetch: fakeGoogleFetch().fetch,
    nonInteractive: true,
    skipProxy: true,
    skipSeed: true,
    noVersionBump: true,
    skipOAuthCheck: true,
    force: true,
    answers: new Map([...ANSWERS, ['POSTGRES_PORT', String(probe.port)]]),
    ...extra,
  });
}

const envOf = (vps: ReturnType<typeof createFakeVps>): Map<string, string> =>
  parseEnvFile(readFileSync(join(vps.deployRoot, 'repo', 'infra', 'compose', '.env'), 'utf8'));

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

describe('update on a superuser deployment', () => {
  it('migrates it onto a dedicated role: provision, transfer, rewrite .env, restart', async () => {
    const { vps, postgres } = await legacyDeployment();
    const before = envOf(vps);

    await update(vps, { provisionAppRole: true, transferOwnership: true });

    const env = envOf(vps);
    expect(env.get('POSTGRES_USER')).toBe(ROLE);
    expect(env.get('POSTGRES_PASSWORD')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(env.get('POSTGRES_PASSWORD')).not.toBe(ADMIN_SECRET);
    // Everything else the operator had is untouched.
    expect(env.get('JWT_SECRET')).toBe(before.get('JWT_SECRET'));
    expect(env.get('SECRETS_ENCRYPTION_KEY')).toBe(before.get('SECRETS_ENCRYPTION_KEY'));
    // Mode 0600 preserved by the atomic writer.
    expect(statSync(join(vps.deployRoot, 'repo', 'infra', 'compose', '.env')).mode & 0o777).toBe(0o600);

    expect(postgres.state.roles.get(ROLE)).toMatchObject({ superuser: false, bypassRls: false });
    expect(postgres.state.owners.get('appdb')).toMatchObject({ databaseOwner: ROLE, schemaOwner: ROLE });
    expect(verifierMatches(env.get('POSTGRES_PASSWORD') ?? '', postgres.state.roles.get(ROLE)?.verifier ?? '')).toBe(true);

    // Ordering: the role exists and owns the data BEFORE the migration runs as it,
    // and the stack is restarted after.
    const calls = vps.invocations.map((call) => call.argv.join(' ') + (call.input ?? ''));
    const provisioned = calls.findIndex((call) => /ALTER DATABASE/.test(call));
    const migrated = calls.findIndex((call) => /prisma:migrate/.test(call));
    const restarted = calls.findIndex((call) => /compose.* up -d$/.test(call));
    expect(provisioned).toBeGreaterThanOrEqual(0);
    expect(provisioned).toBeLessThan(migrated);
    expect(migrated).toBeLessThan(restarted);
    expect(readState(vps.deployRoot)?.lastOutcome).toBe('success');
  });

  it('warns and carries on, changing nothing, when nobody consented (an unattended update must not break)', async () => {
    const { vps, postgres } = await legacyDeployment();
    const before = readFileSync(join(vps.deployRoot, 'repo', 'infra', 'compose', '.env'), 'utf8');
    const progress: string[] = [];

    const result = await update(vps, { hooks: { onProgress: (message: string) => progress.push(message) } });

    expect(result.changed).toBe(true);
    expect(readFileSync(join(vps.deployRoot, 'repo', 'infra', 'compose', '.env'), 'utf8')).toBe(before);
    expect(postgres.mutations()).toHaveLength(0);
    expect(progress.join('\n')).toMatch(/--provision-app-role/);
    expect(progress.join('\n')).toMatch(/row-level security would be inert/i);
  });

  it('asks interactively, and a "no" changes nothing', async () => {
    const { vps, postgres } = await legacyDeployment();
    const questions: string[] = [];

    await update(vps, {
      nonInteractive: false,
      ask: async (question) => {
        questions.push(question);
        return false;
      },
    });

    expect(questions[0]).toContain(ROLE);
    expect(postgres.mutations()).toHaveLength(0);
    expect(envOf(vps).get('POSTGRES_USER')).toBe('admin');
  });

  it('leaves existing data alone without --transfer-ownership: a backup is recommended first', async () => {
    const { vps, postgres } = await legacyDeployment();
    const progress: string[] = [];
    await update(vps, { provisionAppRole: true, hooks: { onProgress: (message: string) => progress.push(message) } });

    expect(postgres.mutations()).toHaveLength(0);
    expect(progress.join('\n')).toMatch(/--transfer-ownership/);
    expect(envOf(vps).get('POSTGRES_USER')).toBe('admin');
  });

  it('is skipped on an unchanged revision unless asked, so a cron run stays quiet', async () => {
    const { vps, postgres } = await legacyDeployment();
    vps.route(['git', 'rev-parse', 'HEAD'], 'a'.repeat(40));

    const result = await update(vps, { force: false });

    expect(result.changed).toBe(false);
    expect(vps.invocations.some((call) => call.argv.includes('psql'))).toBe(false);
    expect(postgres.seen).toHaveLength(0);
  });

  it('migrates an UNCHANGED deployment when asked, recreating and proving the api itself', async () => {
    const { vps } = await legacyDeployment();
    vps.route(['git', 'rev-parse', 'HEAD'], 'a'.repeat(40));

    const result = await update(vps, { force: false, provisionAppRole: true, transferOwnership: true });

    expect(result.changed).toBe(false);
    expect(envOf(vps).get('POSTGRES_USER')).toBe(ROLE);
    expect(
      vps.calls('docker', 'compose').some((call) => call.argv.join(' ').includes('up -d --no-deps --force-recreate api')),
    ).toBe(true);
  });

  it('--allow-superuser is recorded, so doctor reports the choice and update stops asking', async () => {
    const { vps, postgres } = await legacyDeployment();
    await update(vps, { allowSuperuser: true });
    expect(readState(vps.deployRoot)?.allowSuperuser).toBe(true);
    expect(postgres.mutations()).toHaveLength(0);
    // And it survives the update's own state write.
    expect(readState(vps.deployRoot)?.lastCommand).toBe('update');
  });

  it('--skip-role-provisioning does not even connect for it', async () => {
    const { vps, postgres } = await legacyDeployment();
    await update(vps, { skipRoleProvisioning: true });
    expect(postgres.mutations()).toHaveLength(0);
    expect(envOf(vps).get('POSTGRES_USER')).toBe('admin');
  });
});

describe('update on a deployment that already has an ordinary role', () => {
  async function ordinaryDeployment() {
    const postgres = createFakePostgres({
      roles: { shop: ordinaryRole({ password: 'shop-password-0123456789' }) },
      databases: ['appdb'],
    });
    const vps = createFakeVps({
      envExample: TEMPLATE,
      routes: [{ match: (invocation) => invocation.argv.includes('curl'), answer: '200' }, postgresRoute(postgres)],
    });
    await runInstall({
      deployRoot: vps.deployRoot,
      bindPort: api.port,
      proxyRoot: join(vps.appsRoot, 'proxy'),
      domain: 'app.example.test',
      repo: 'https://example.test/o/r',
      ref: 'main',
      runCommand: vps.runCommand,
      fetch: fakeGoogleFetch().fetch,
      answers: new Map([
        ...ANSWERS,
        ['POSTGRES_PORT', String(probe.port)],
        ['POSTGRES_USER', 'shop'],
        ['POSTGRES_PASSWORD', 'shop-password-0123456789'],
      ]),
      nonInteractive: true,
      skipDoctor: true,
      skipProxy: true,
      skipSeed: true,
      noVersionBump: true,
    });
    mkdirSync(join(vps.deployRoot, 'repo', '.git'), { recursive: true });
    vps.route(['df'], DF);
    vps.route(['git', 'rev-parse', 'HEAD'], 'e'.repeat(40));
    postgres.seen.length = 0;
    return { vps, postgres };
  }

  it('touches nothing: no role is created, no password rotated, .env is unchanged', async () => {
    const { vps, postgres } = await ordinaryDeployment();
    const before = readFileSync(join(vps.deployRoot, 'repo', 'infra', 'compose', '.env'), 'utf8');
    await update(vps);
    expect(postgres.mutations()).toHaveLength(0);
    expect(readFileSync(join(vps.deployRoot, 'repo', 'infra', 'compose', '.env'), 'utf8')).toBe(before);
  });

  it('rotates the application password on request, with the application role alone', async () => {
    const { vps, postgres } = await ordinaryDeployment();
    await update(vps, { rotateAppPassword: true });

    const rotated = envOf(vps).get('POSTGRES_PASSWORD') ?? '';
    expect(rotated).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(verifierMatches(rotated, postgres.state.roles.get('shop')?.verifier ?? '')).toBe(true);
    expect(postgres.seen.every((call) => call.user === 'shop')).toBe(true);
  });
});

describe('update secret egress', () => {
  it('keeps the old login and the generated password out of argv, the journal and the state', async () => {
    const { vps } = await legacyDeployment();
    const progress: string[] = [];
    const result = await update(vps, {
      provisionAppRole: true,
      transferOwnership: true,
      hooks: { onProgress: (message: string) => progress.push(message), onLog: (line: string) => progress.push(line) },
    });

    const password = envOf(vps).get('POSTGRES_PASSWORD') ?? '';
    const argv = vps.invocations.map((call) => call.argv.join(' ')).join('\n');
    expect(argv).not.toContain(password);
    expect(argv).not.toContain(ADMIN_SECRET);
    // update's journal is written after the old .env held the administrator: it must not carry it.
    for (const file of everyFile(join(vps.deployRoot, 'logs')).concat(everyFile(join(vps.deployRoot, 'deploy-info')))) {
      const text = readFileSync(file, 'utf8');
      expect(text, file).not.toContain(password);
      expect(text, file).not.toContain(ADMIN_SECRET);
    }
    expect(JSON.stringify(readState(vps.deployRoot))).not.toContain(password);
    expect(progress.join('\n')).not.toContain(password);
    expect(JSON.stringify(result)).not.toContain(password);
  });

  it('shows the credentials once only with --show-credentials', async () => {
    const { vps } = await legacyDeployment();
    const result = await update(vps, { provisionAppRole: true, transferOwnership: true, showCredentials: true });
    expect(result.credentials).toEqual({ user: ROLE, password: envOf(vps).get('POSTGRES_PASSWORD') });
  });
});
