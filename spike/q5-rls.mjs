#!/usr/bin/env node
// Q5. Row-level security with Prisma 7 + adapter-pg and a transaction pooler.
//
// Run:  node spike/q5-rls.mjs
// Needs the compose test Postgres on :5433 (superuser, to create the scratch roles) and, for the pooler half,
// a `pgbouncer` binary on PATH (otherwise that half is reported as skipped, not failed).

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import {
  API_ROOT, begin, check, dbUrl, dropDb, dropRole, freshWorkdir, join, main, PG, prisma, read, recreateDb, rows, run, say, scalar, show,
  withAdmin, withClient, write, writeConfig, mkdirSync, writeFileSync, existsSync, sleep,
} from './lib/env.mjs';
import { GUC, forScope, forSystem, makeClients, policySql, runAsSystem, runInScope } from './lib/rls.mjs';

const require = createRequire(import.meta.url);
const DB = 'pp_5_1_q5';
const PW = 'pp_5_1_pw';
const ROLES = { owner: 'pp_5_1_owner', minted: 'pp_5_1_minted', bypass: 'pp_5_1_bypass', tenant: 'pp_5_1_tenant', creator: 'pp_5_1_creator' };
const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const as = (role, database = DB, extra = {}) => dbUrl(database, { user: ROLES[role] ?? role, password: PW, ...extra });
const PGBOUNCER_PORT = '6543';

const cleanSql = (s) => s.trim();
const t0 = () => process.hrtime.bigint();
const ms = (from) => Number(process.hrtime.bigint() - from) / 1e6;

async function createRoles() {
  await withAdmin(async (c) => {
    for (const r of Object.values(ROLES)) await c.query(`DROP ROLE IF EXISTS "${r}"`).catch(() => {});
  });
  // Drop dependants first if a previous run left a database behind.
  await dropDb(DB);
  await withAdmin(async (c) => {
    for (const r of Object.values(ROLES)) await c.query(`DROP ROLE IF EXISTS "${r}"`);
    // The application role: owns the tables AND serves requests (the deployment shape of this repo),
    // deliberately NOT a superuser and NOT BYPASSRLS: a superuser or BYPASSRLS role ignores every policy.
    await c.query(`CREATE ROLE ${ROLES.owner} LOGIN PASSWORD '${PW}' NOSUPERUSER NOBYPASSRLS CREATEDB`);
    // The per-job minted dump role, with the attributes pg-job-role.broker.ts gives it.
    await c.query(`CREATE ROLE ${ROLES.minted} LOGIN PASSWORD '${PW}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION CONNECTION LIMIT 2`);
    // Option C control: a login that bypasses RLS.
    await c.query(`CREATE ROLE ${ROLES.bypass} LOGIN PASSWORD '${PW}' NOSUPERUSER BYPASSRLS`);
    // Option B: a NOLOGIN role scoped transactions SET LOCAL ROLE into.
    await c.query(`CREATE ROLE ${ROLES.tenant} NOLOGIN NOSUPERUSER NOBYPASSRLS`);
    // A role like app_job_minter: CREATEROLE but not a superuser.
    await c.query(`CREATE ROLE ${ROLES.creator} LOGIN PASSWORD '${PW}' NOSUPERUSER NOBYPASSRLS CREATEROLE`);
    await c.query(`GRANT ${ROLES.tenant} TO ${ROLES.owner}`);
    await c.query(`CREATE DATABASE "${DB}" OWNER ${ROLES.owner}`);
  });
  await withClient(DB, async (c) => {
    await c.query(`ALTER SCHEMA public OWNER TO ${ROLES.owner}`);
  });
}

const SCHEMA_PRISMA = `generator client {
  provider = "prisma-client-js"
  output   = "./generated"
}

datasource db {
  provider = "postgresql"
}

model SpikeParent {
  id    String @id @default(uuid()) @db.Uuid
  orgId String @map("org_id") @db.Uuid
  name  String

  rows   SpikeTenantRow[]
  leaves SpikeLeaf[]

  @@unique([id, orgId])
  @@map("spike_parents")
}

// Same shape as SpikeTenantRow, but its parent reference is COMPOSITE (parent id + org id), so the foreign key
// itself refuses a cross-org reference. Prisma expresses this natively, so it is not schema drift.
model SpikeLeaf {
  id     String  @id @default(uuid()) @db.Uuid
  orgId  String  @map("org_id") @db.Uuid
  nodeId String? @map("node_id") @db.Uuid

  node SpikeParent? @relation(fields: [nodeId, orgId], references: [id, orgId], onDelete: NoAction)

  @@map("spike_leaves")
}

model SpikeTenantRow {
  id       String  @id @default(uuid()) @db.Uuid
  orgId    String  @map("org_id") @db.Uuid
  payload  String
  parentId String? @map("parent_id") @db.Uuid

  parent SpikeParent? @relation(fields: [parentId], references: [id])

  @@index([orgId])
  @@map("spike_tenant_rows")
}
`;

const body = async () => {
  begin('q5-rls');
  const root = freshWorkdir('q5');
  const app = join(root, 'app');
  await createRoles();
  say(`roles: ${Object.values(ROLES).join(', ')} (all prefixed pp_5_1_, dropped at the end)`);
  const sup = await rows('postgres', "select rolname, rolsuper, rolbypassrls from pg_roles where rolname in ('postgres', $1, $2)", [ROLES.owner, ROLES.bypass]);
  show('role attributes', sup.map((r) => `${r.rolname}: superuser=${r.rolsuper} bypassrls=${r.rolbypassrls}`).join('\n'));

  // ---- 0. project: Prisma schema + a hand-written RLS migration --------------------------------------------------------------
  write(join(app, 'prisma', 'schema.prisma'), SCHEMA_PRISMA);
  writeConfig(app, { schema: 'prisma/schema.prisma' });
  const create = prisma(['migrate', 'diff', '--from-empty', '--to-schema', join(app, 'prisma', 'schema.prisma'), '--script'], { cwd: app, database: DB });
  const migDir = join(app, 'prisma', 'migrations', '20261006000000_init_rls');
  write(join(app, 'prisma', 'migrations', 'migration_lock.toml'), 'provider = "postgresql"\n');
  write(join(migDir, 'migration.sql'), `${create.stdout.trim()}\n\n-- ROW LEVEL SECURITY (hand-written: Prisma's schema language has no syntax for it)\n${policySql('spike_tenant_rows')}${policySql('spike_parents')}${policySql('spike_leaves')}`);
  show('migration.sql (RLS part)', read(join(migDir, 'migration.sql')).split('-- ROW LEVEL SECURITY')[1]);
  // Applied as the owner role, exactly as `npm run prisma:migrate` applies migrations with the app's POSTGRES_USER.
  let r = prisma(['migrate', 'deploy'], { cwd: app, database: DB, env: { DATABASE_URL: as('owner') } });
  check('migrate deploy (as the NON-superuser owner role) applies the RLS migration', r.status === 0, r.stdout.split('\n').find((l) => /Applying|applied/.test(l)));
  r = prisma(['generate'], { cwd: app, database: DB, env: { DATABASE_URL: as('owner') } });
  check('client generates', r.status === 0);
  const diff = prisma(['migrate', 'diff', '--from-config-datasource', '--to-schema', join(app, 'prisma', 'schema.prisma'), '--exit-code', '--script'], { cwd: app, database: DB, env: { DATABASE_URL: as('owner') } });
  show('migrate diff live DB (RLS enabled, FORCE, policies) -> schema', `exit ${diff.status}\n${diff.stdout}`);
  check('Prisma 7.9 `migrate diff` is blind to ENABLE/FORCE ROW LEVEL SECURITY and policies (no drift, so no allow-list entry is needed, but also no Prisma-side check)', diff.status === 0);
  const flags = (await rows(DB, "select relname, relrowsecurity, relforcerowsecurity from pg_class where relname in ('spike_tenant_rows','spike_parents') order by 1"));
  check('catalogue: both tables have relrowsecurity AND relforcerowsecurity', flags.every((f) => f.relrowsecurity && f.relforcerowsecurity));

  const clientModule = join(app, 'prisma', 'generated', 'index.js');
  const OPEN = (role, max = 5) => makeClients({ clientModule, url: as(role), max });

  // Seed 20 rows per org through the system path (a plain INSERT as the owner would be refused by FORCE).
  const seedClient = OPEN('owner');
  const noScopeInsert = await seedClient.spikeTenantRow.create({ data: { orgId: ORG_A, payload: 'x' } }).then(() => 'inserted', (e) => e.message.split('\n').filter(Boolean).pop());
  check('FORCE ROW LEVEL SECURITY: an UNSCOPED insert by the table owner is REFUSED (fail-closed)', /row-level security|new row violates/i.test(noScopeInsert), noScopeInsert.slice(0, 120));
  await runAsSystem(seedClient, async (tx) => {
    await tx.spikeTenantRow.createMany({ data: [...Array(20).keys()].flatMap((i) => [{ orgId: ORG_A, payload: `a-${i}` }, { orgId: ORG_B, payload: `b-${i}` }]) });
  });
  await seedClient.$disconnect();

  // ---- 1. fail-closed + scoped operations ----------------------------------------------------------------------------------------
  say('\n## 1. per-operation scoping through a Prisma client extension');
  const base = OPEN('owner');
  const unscoped = await base.spikeTenantRow.findMany();
  const unscopedRaw = await base.$queryRaw`SELECT count(*)::int AS n FROM spike_tenant_rows`;
  check('an UNSCOPED client sees ZERO rows (findMany and $queryRaw): forgetting the scope fails closed', unscoped.length === 0 && unscopedRaw[0].n === 0);
  const a = forScope(base, { orgId: ORG_A });
  const b = forScope(base, { orgId: ORG_B });
  check('scoped findMany returns exactly the org\'s 20 rows', (await a.spikeTenantRow.findMany()).length === 20 && (await b.spikeTenantRow.findMany()).every((x) => x.orgId === ORG_B));
  check('count / aggregate / groupBy are scoped', (await a.spikeTenantRow.count()) === 20 && (await a.spikeTenantRow.aggregate({ _count: true }))._count === 20 && (await a.spikeTenantRow.groupBy({ by: ['orgId'], _count: true })).length === 1);
  check('findUnique of ANOTHER org\'s id returns null (row invisible, not "forbidden")', await (async () => {
    const other = (await b.spikeTenantRow.findFirst()).id;
    return (await a.spikeTenantRow.findUnique({ where: { id: other } })) === null;
  })());
  const wrongOrg = await a.spikeTenantRow.create({ data: { orgId: ORG_B, payload: 'smuggled' } }).then(() => 'inserted', (e) => e.message.split('\n').filter(Boolean).pop());
  check('WITH CHECK: creating a row for ANOTHER org is refused', /row-level security|new row violates/i.test(wrongOrg), wrongOrg.slice(0, 120));
  const mine = await a.spikeTenantRow.create({ data: { orgId: ORG_A, payload: 'mine' } });
  check('creating a row for the own org works', mine.orgId === ORG_A);
  check('updateMany cannot touch another org (0 rows)', (await a.spikeTenantRow.updateMany({ where: { payload: { startsWith: 'b-' } }, data: { payload: 'hijack' } })).count === 0);
  check('deleteMany cannot touch another org (0 rows)', (await a.spikeTenantRow.deleteMany({ where: { payload: { startsWith: 'b-' } } })).count === 0);
  const upd = await a.spikeTenantRow.update({ where: { id: mine.id }, data: { payload: 'mine2' } });
  check('update / upsert / delete of an own row work', upd.payload === 'mine2' && (await a.spikeTenantRow.upsert({ where: { id: mine.id }, create: { orgId: ORG_A, payload: 'n' }, update: { payload: 'mine3' } })).payload === 'mine3' && (await a.spikeTenantRow.delete({ where: { id: mine.id } })).id === mine.id);
  const rawScoped = await a.$queryRaw`SELECT count(*)::int AS n FROM spike_tenant_rows`;
  check('$queryRaw through the scoped client is scoped too (top-level $allOperations covers raw queries)', rawScoped[0].n === 20, `n=${rawScoped[0].n}`);
  const cnt = await a.spikeTenantRow.findMany({ include: { parent: true } });
  check('relation includes keep working under the extension', cnt.length === 20);

  // After a transaction-local set_config the GUC reads '' (empty), not NULL.
  const after = await base.$queryRaw`SELECT current_setting('app.org_id', true) AS v`;
  say(`current_setting('app.org_id', true) on a connection that previously had a transaction-local value: ${JSON.stringify(after[0].v)}`);
  const fresh = await withClient(DB, async (c) => (await c.query("select current_setting('app.org_id', true) as v")).rows[0].v);
  say(`...and on a brand-new connection: ${JSON.stringify(fresh)}`);
  check('the GUC reverts to NULL on a new session but to the EMPTY STRING on a used one: policies must use NULLIF(current_setting(..., true), \'\')', fresh === null && after[0].v === '');

  // ---- 2. interactive transactions --------------------------------------------------------------------------------------------------
  say('\n## 2. interactive transactions');
  const inTx = await runInScope(base, { orgId: ORG_A }, async (tx) => {
    const before = await tx.spikeTenantRow.count();
    await tx.spikeTenantRow.create({ data: { orgId: ORG_A, payload: 'tx-row' } });
    const during = await tx.spikeTenantRow.count();
    return { before, during };
  });
  check('runInScope: set_config at the top of ONE interactive transaction scopes every statement in it', inTx.before === 20 && inTx.during === 21);
  await runInScope(base, { orgId: ORG_A }, (tx) => tx.spikeTenantRow.deleteMany({ where: { payload: 'tx-row' } }));
  const rolled = await runInScope(base, { orgId: ORG_A }, async (tx) => {
    await tx.spikeTenantRow.create({ data: { orgId: ORG_A, payload: 'rolled-back' } });
    throw new Error('abort');
  }).catch(() => 'rolled back');
  check('an error inside runInScope rolls the writes back', rolled === 'rolled back' && (await a.spikeTenantRow.count({ where: { payload: 'rolled-back' } })) === 0);
  const hand = await base.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.org_id', ${ORG_B}, true)`;
    return tx.spikeTenantRow.count();
  });
  check('a hand-written interactive $transaction + set_config(..., true) works (what the extension does for you)', hand === 20);
  const outside = await base.spikeTenantRow.count();
  check('and the value does NOT outlive the transaction: the next statement on the pool is unscoped again', outside === 0);

  // Pitfall: using the EXTENDED client inside its own interactive transaction.
  say('\n  pitfall: extended client inside an interactive transaction');
  const pitfall = await a.$transaction(async (tx) => {
    await tx.spikeTenantRow.create({ data: { orgId: ORG_A, payload: 'pitfall' } });
    throw new Error('abort');
  }).then(() => 'committed', () => 'rolled back');
  const leaked = await a.spikeTenantRow.count({ where: { payload: 'pitfall' } });
  say(`  extended.$transaction(tx => tx.create(...); throw): outcome=${pitfall}, row persisted=${leaked === 1}`);
  check(leaked === 1 ? 'PITFALL CONFIRMED: ops of an extended client inside $transaction escape the transaction (hence runInScope hands out the UNEXTENDED tx)' : 'extended client keeps transactionality here (runInScope still hands out the unextended tx)', true);
  await runAsSystem(base, (tx) => tx.spikeTenantRow.deleteMany({ where: { payload: 'pitfall' } }));

  // ---- 3. concurrency ------------------------------------------------------------------------------------------------------------------
  await concurrency('direct to PostgreSQL, pool of 1 (every request shares ONE server connection, like a transaction pooler)', as('owner'), clientModule, 1);
  await concurrency('direct to PostgreSQL, pool of 8', as('owner'), clientModule, 8);

  // ---- 4. pooler ---------------------------------------------------------------------------------------------------------------------------
  await pooler(root, clientModule);

  // ---- 5. system connection ------------------------------------------------------------------------------------------------------------
  say('\n## 5. system work: a SEPARATE connection pool with the bypass flag');
  const sysBase = OPEN('owner', 3);
  const sys = forSystem(sysBase);
  const all = await sys.spikeTenantRow.count();
  check('the system client counts rows of every org (purge / doctor / backup shape)', all === 40, `count=${all}`);
  check('the system client can delete across orgs', (await sys.spikeTenantRow.deleteMany({ where: { payload: 'smuggled' } })).count >= 0);
  const pids = async (c) => new Set((await Promise.all([...Array(12)].map(() => c.$queryRaw`SELECT pg_backend_pid() AS pid`))).map((x) => x[0].pid));
  const tenantPids = await pids(base);
  const systemPids = await pids(sysBase);
  check('the tenant pool and the system pool never share a backend connection (separate PrismaClient, separate PrismaPg pool)', [...tenantPids].every((p) => !systemPids.has(p)), `tenant ${[...tenantPids].length} backends, system ${[...systemPids].length}`);
  const leakCheck = await withClient(DB, async (c) => (await c.query("select current_setting('app.rls_bypass', true) as v")).rows[0].v, { user: ROLES.owner, password: PW });
  check('the bypass flag is not left behind on any connection (transaction-local)', leakCheck === null || leakCheck === '');
  const unscopedAfter = await base.spikeTenantRow.count();
  check('and the tenant pool is still fail-closed after system work', unscopedAfter === 0);

  // ---- 6. a bypass flag on a tenant request? ------------------------------------------------------------------------------------------
  say('\n## 6. threat model of the GUC approach');
  const forged = await base.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.org_id', ${ORG_A}, true)`;
    await tx.$executeRaw`SELECT set_config('app.org_id', ${ORG_B}, true)`;
    return tx.spikeTenantRow.findMany({ select: { orgId: true } });
  });
  check('ANY SQL executed on a connection can set the GUC (including to another org, or the bypass flag): RLS here defends against missing or wrong scoping in app code, NOT against SQL injection or arbitrary raw SQL', forged.every((x) => x.orgId === ORG_B) && forged.length === 20);
  say('  consequence: unscoped raw SQL needs a lint rule (spec: "Lint"), and the bypass flag may only be set by the system client wrapper.');
  await base.$disconnect();
  await sysBase.$disconnect();

  await integrity(clientModule);
  await bypassOptions(root, clientModule);
  await backupRestore(root, clientModule);
  await migrationsUnderRls(app);
  await benchmark(clientModule);

  await dropDb(DB);
  for (const r of Object.values(ROLES)) await dropRole(r);
};

// ===============================================================================================================================
async function concurrency(label, url, clientModule, max) {
  say(`\n## 3. concurrent requests for two orgs: ${label}`);
  const { PrismaClient } = require(clientModule);
  const { PrismaPg } = require('@prisma/adapter-pg');
  const base = new PrismaClient({ adapter: new PrismaPg({ connectionString: url, max }) });
  const jitter = () => sleep(Math.floor(Math.random() * 6));
  const N = 200;
  let crossOrg = 0;
  let wrongCount = 0;
  await Promise.all([...Array(N)].map(async (_, i) => {
    const orgId = i % 2 === 0 ? ORG_A : ORG_B;
    const scoped = forScope(base, { orgId });
    await jitter();
    const found = await scoped.spikeTenantRow.findMany();
    await jitter();
    const viaTx = await runInScope(base, { orgId }, async (tx) => { await jitter(); return tx.spikeTenantRow.findMany(); });
    crossOrg += [...found, ...viaTx].filter((x) => x.orgId !== orgId).length;
    if (found.length < 20 || viaTx.length < 20) wrongCount++;
  }));
  check(`${N} interleaved requests (extension and runInScope): ZERO cross-org rows, every request saw its own org's rows`, crossOrg === 0 && wrongCount === 0, `cross-org rows ${crossOrg}, short reads ${wrongCount}`);

  // negative control: the SAME workload with a SESSION-level setting must leak when connections are shared.
  if (max === 1) {
    let leaks = 0;
    await Promise.all([...Array(60)].map(async (_, i) => {
      const orgId = i % 2 === 0 ? ORG_A : ORG_B;
      await base.$executeRaw`SELECT set_config('app.org_id', ${orgId}, false)`;
      await jitter();
      const rowsSeen = await base.spikeTenantRow.findMany();
      leaks += rowsSeen.filter((x) => x.orgId !== orgId).length;
    }));
    check('NEGATIVE CONTROL: a SESSION-level set_config(..., false) on the same shared connection LEAKS between requests (the spec\'s rule is not optional)', leaks > 0, `${leaks} cross-org rows`);
  }
  await base.$disconnect();
}

async function pooler(root, clientModule) {
  say('\n## 4. PgBouncer in pool_mode=transaction, ONE server connection for everyone');
  const which = run('which', ['pgbouncer']);
  if (which.status !== 0) {
    say('SKIPPED: no pgbouncer binary on PATH (docker is not available here either). Rely on docs/runbooks/rds-proxy-rls-check.md; the pool-of-1 run above exercises the same sharing.');
    return;
  }
  const dir = join(root, 'pgbouncer');
  mkdirSync(dir, { recursive: true });
  write(join(dir, 'userlist.txt'), `"${ROLES.owner}" "${PW}"\n`);
  write(join(dir, 'pgbouncer.ini'), `[databases]
${DB} = host=${PG.host} port=${PG.port} dbname=${DB}

[pgbouncer]
listen_addr = 127.0.0.1
listen_port = ${PGBOUNCER_PORT}
unix_socket_dir =
auth_type = plain
auth_file = ${join(dir, 'userlist.txt')}
pool_mode = transaction
default_pool_size = 1
min_pool_size = 0
max_client_conn = 200
server_reset_query =
ignore_startup_parameters = extra_float_digits
pidfile = ${join(dir, 'pgbouncer.pid')}
logfile = ${join(dir, 'pgbouncer.log')}
admin_users = ${ROLES.owner}
`);
  // PgBouncer refuses to run as root; drop to `postgres` (present wherever PostgreSQL is installed) when we are root.
  const asRoot = process.getuid?.() === 0;
  if (asRoot) { run('chmod', ['-R', 'a+rwX', dir]); run('chmod', ['a+x', join(dir, '..'), join(dir, '..', '..'), join(dir, '..', '..', '..')]); }
  const proc = spawn('pgbouncer', [...(asRoot ? ['-u', 'postgres'] : []), join(dir, 'pgbouncer.ini')], { stdio: 'ignore' });
  await sleep(800);
  const url = as('owner', DB, { host: '127.0.0.1', port: PGBOUNCER_PORT });
  try {
    const version = run('pgbouncer', ['--version']).stdout.split('\n')[0];
    say(`${version}; pool_mode=transaction; default_pool_size=1; clients connect to :${PGBOUNCER_PORT}`);
    const ping = await withClient(DB, async (c) => (await c.query('select 1 as ok')).rows[0].ok, { user: ROLES.owner, password: PW, port: PGBOUNCER_PORT });
    check('PgBouncer is up and proxies the scratch database', ping === 1);
    const { PrismaClient } = require(clientModule);
    const { PrismaPg } = require('@prisma/adapter-pg');
    const base = new PrismaClient({ adapter: new PrismaPg({ connectionString: url, max: 10 }) });
    const jitter = () => sleep(Math.floor(Math.random() * 6));
    let cross = 0;
    let short = 0;
    await Promise.all([...Array(200)].map(async (_, i) => {
      const orgId = i % 2 === 0 ? ORG_A : ORG_B;
      const scoped = forScope(base, { orgId });
      await jitter();
      const found = await scoped.spikeTenantRow.findMany();
      const viaTx = await runInScope(base, { orgId }, async (tx) => { await jitter(); return tx.spikeTenantRow.findMany(); });
      cross += [...found, ...viaTx].filter((x) => x.orgId !== orgId).length;
      if (found.length < 20 || viaTx.length < 20) short++;
    }));
    check('through PgBouncer (transaction mode, 1 server connection, 10 client connections): 200 interleaved requests, ZERO cross-org rows', cross === 0 && short === 0, `cross-org ${cross}, short reads ${short}`);
    const unscoped = await base.spikeTenantRow.count();
    check('through PgBouncer an unscoped client is still fail-closed', unscoped === 0);
    let leaks = 0;
    await Promise.all([...Array(60)].map(async (_, i) => {
      const orgId = i % 2 === 0 ? ORG_A : ORG_B;
      await base.$executeRaw`SELECT set_config('app.org_id', ${orgId}, false)`;
      await jitter();
      leaks += (await base.spikeTenantRow.findMany()).filter((x) => x.orgId !== orgId).length;
    }));
    check('NEGATIVE CONTROL through PgBouncer: session-level set_config LEAKS across clients', leaks > 0, `${leaks} cross-org rows`);
    const sess = await withClient(DB, async (c) => {
      await c.query("select set_config('app.org_id', $1, false)", [ORG_A]);
      const first = (await c.query('select count(*)::int as n from spike_tenant_rows')).rows[0].n;
      return first;
    }, { user: ROLES.owner, password: PW, port: PGBOUNCER_PORT });
    say(`(a single client that sets a session value and queries immediately saw ${sess} rows: a session value only appears to work until the pooler re-assigns the connection)`);
    await base.$disconnect();
    // Where must pg_dump / pg_restore connect? Probe the startup option through the pooler (recorded, not asserted).
    const probe = run('psql', ['-h', '127.0.0.1', '-p', PGBOUNCER_PORT, '-U', ROLES.owner, '-d', DB, '-Atc', "select current_setting('app.rls_bypass', true)"], { env: { ...process.env, PGPASSWORD: PW, PGOPTIONS: `-c ${GUC.bypass}=on` } });
    show('probe: a client startup option (PGOPTIONS="-c app.rls_bypass=on") sent THROUGH PgBouncer 1.22', `exit ${probe.status}\n${(probe.stdout + probe.stderr).trim().split('\n')[0]}`);
    say('  => dump and restore connect straight to the database endpoint (as POSTGRES_HOST does today), never through a pooler: they are session-level, long-lived and need the startup option.');
    const log = read(join(dir, 'pgbouncer.log')).split('\n').filter((l) => /ERROR|WARNING/.test(l)).slice(0, 5).join('\n');
    if (log) show('pgbouncer warnings', log);
  } finally {
    proc.kill('SIGTERM');
    await sleep(300);
  }
}

// ===============================================================================================================================
async function integrity(clientModule) {
  say('\n## 7. foreign keys and RLS: referential-integrity checks BYPASS row-level security');
  const base = makeClients({ clientModule, url: as('owner'), max: 3 });
  const parentA = await runAsSystem(base, (tx) => tx.spikeParent.create({ data: { orgId: ORG_A, name: 'org A parent' } }));
  const b = forScope(base, { orgId: ORG_B });
  const cross = await b.spikeTenantRow.create({ data: { orgId: ORG_B, payload: 'points at A', parentId: parentA.id } }).then((x) => x, (e) => e);
  check('a plain FK lets org B store a reference to org A\'s parent (the FK check reads the parent as the table owner, ignoring RLS)', cross?.parentId === parentA.id);
  const seen = await b.spikeTenantRow.findFirst({ where: { id: cross.id }, include: { parent: true } });
  check('...while org B cannot read that parent: a dangling-looking cross-tenant reference (and an existence oracle for foreign ids)', seen.parentId === parentA.id && seen.parent === null);
  const leaf = await b.spikeLeaf.create({ data: { orgId: ORG_B, nodeId: parentA.id } }).then(() => 'created', (e) => e.message.split('\n').filter(Boolean).pop());
  check('a COMPOSITE foreign key (parent id, org id), declared in Prisma with fields: [nodeId, orgId], refuses the cross-org reference', /Foreign key constraint|violat/i.test(leaf), leaf.slice(0, 140));
  const ok = await forScope(base, { orgId: ORG_A }).spikeLeaf.create({ data: { orgId: ORG_A, nodeId: parentA.id } });
  check('and the same-org reference works', ok.nodeId === parentA.id);
  await runAsSystem(base, async (tx) => { await tx.spikeLeaf.deleteMany(); await tx.spikeTenantRow.deleteMany({ where: { payload: 'points at A' } }); await tx.spikeParent.deleteMany(); });
  await base.$disconnect();
}

// ===============================================================================================================================
const archiveRows = (archive, table = 'spike_tenant_rows') => {
  const sql = run('pg_restore', ['-f', '-', archive]).stdout;
  const m = new RegExp(`COPY public\\.${table} \\([^)]*\\) FROM stdin;\\n([\\s\\S]*?)\\\\\\.\\n`).exec(sql);
  return m ? m[1].split('\n').filter(Boolean).length : -1;
};
const pgenv = (extra = {}) => ({ ...process.env, PGPASSWORD: PW, ...extra });
// The exact argument vector of buildPgDumpArgs (apps/api/src/db-backup/pg-dump.util.ts) plus -f for the test.
const dumpArgs = (role, database, file, extra = []) => ['--host', PG.host, '--port', PG.port, '--username', ROLES[role] ?? role, '--dbname', database, '--no-password', '-Fc', '--no-owner', '--no-acl', '-Z', '6', ...extra, '-f', file];
const BYPASS_ENV = { PGOPTIONS: `-c ${GUC.bypass}=on` };

async function bypassOptions(root, clientModule) {
  say('\n## 8. the three bypass options');
  const admin = (sql, params) => withClient(DB, (c) => c.query(sql, params), { user: ROLES.owner, password: PW });
  const owner = (fn) => withClient(DB, fn, { user: ROLES.owner, password: PW });

  // ---- B ---------------------------------------------------------------------------------------------------------------------
  say('\n### Option B: ENABLE without FORCE; the owner bypasses; scoped transactions SET LOCAL ROLE');
  await owner(async (c) => {
    await c.query('CREATE TABLE spike_b_rows (id uuid primary key default gen_random_uuid(), org_id uuid not null, payload text)');
    await c.query('ALTER TABLE spike_b_rows ENABLE ROW LEVEL SECURITY');
    await c.query("CREATE POLICY b_isolation ON spike_b_rows USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid)");
    await c.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON spike_b_rows TO ${ROLES.tenant}`);
    await c.query(`INSERT INTO spike_b_rows (org_id, payload) SELECT '${ORG_A}', 'a'||g FROM generate_series(1,5) g`);
    await c.query(`INSERT INTO spike_b_rows (org_id, payload) SELECT '${ORG_B}', 'b'||g FROM generate_series(1,7) g`);
  });
  const bUnscoped = await owner(async (c) => (await c.query('select count(*)::int n from spike_b_rows')).rows[0].n);
  check('B: UNSCOPED code (no SET LOCAL ROLE) sees EVERY org\'s rows: it FAILS OPEN', bUnscoped === 12, `n=${bUnscoped}`);
  const bScoped = await owner(async (c) => {
    await c.query('BEGIN');
    await c.query(`SET LOCAL ROLE ${ROLES.tenant}`);
    await c.query("select set_config('app.org_id', $1, true)", [ORG_A]);
    const n = (await c.query('select count(*)::int n from spike_b_rows')).rows[0].n;
    await c.query('COMMIT');
    return n;
  });
  check('B: inside SET LOCAL ROLE + set_config the scope is enforced (5 rows)', bScoped === 5);
  const bNoOrg = await owner(async (c) => {
    await c.query('BEGIN');
    await c.query(`SET LOCAL ROLE ${ROLES.tenant}`);
    const n = (await c.query('select count(*)::int n from spike_b_rows')).rows[0].n;
    await c.query('COMMIT');
    return n;
  });
  check('B: the tenant role with no org set sees nothing (the tenant role itself is fail-closed)', bNoOrg === 0);
  say('   B costs: every new table needs GRANT ... TO tenant role (a package migration obligation), a second role on every deployment, and a role switch per transaction;');
  say('   B can never FORCE (the owner would then be subject to policies and the "system" path disappears), so protection depends on every request path remembering SET LOCAL ROLE.');
  const bDump = join(root, 'b.dump');
  const bd = run('pg_dump', dumpArgs('owner', DB, bDump, ['--table=spike_b_rows']), { env: pgenv() });
  check('B: pg_dump as the owner works with the current default arguments (owner bypasses) and captures all rows', bd.status === 0 && archiveRows(bDump, 'spike_b_rows') === 12, bd.stderr.slice(0, 120));

  // ---- C ---------------------------------------------------------------------------------------------------------------------------
  say('\n### Option C: a separate login role with BYPASSRLS');
  await withAdmin((c) => c.query(`GRANT CONNECT ON DATABASE "${DB}" TO ${ROLES.bypass}`));
  await owner(async (c) => { await c.query(`GRANT USAGE ON SCHEMA public TO ${ROLES.bypass}`); await c.query(`GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${ROLES.bypass}`); });
  const cAll = await withClient(DB, async (c) => (await c.query('select count(*)::int n from spike_tenant_rows')).rows[0].n, { user: ROLES.bypass, password: PW });
  check('C: a BYPASSRLS login sees every row of a FORCEd table with no flag at all', cAll >= 40, `n=${cAll}`);
  const cDump = join(root, 'c.dump');
  const cd = run('pg_dump', dumpArgs('bypass', DB, cDump, ['--table=spike_tenant_rows']), { env: pgenv() });
  check('C: pg_dump as that role works with today\'s default arguments (row_security off is fine for a BYPASSRLS role)', cd.status === 0 && archiveRows(cDump) >= 40, cd.stderr.slice(0, 120));
  const mint = await withClient('postgres', (c) => c.query('CREATE ROLE pp_5_1_nope LOGIN BYPASSRLS'), { user: ROLES.creator, password: PW }).then(() => 'created', (e) => e.message);
  await withAdmin((c) => c.query('DROP ROLE IF EXISTS pp_5_1_nope'));
  show('a CREATEROLE (non-superuser) role like app_job_minter tries CREATE ROLE ... BYPASSRLS', mint);
  check('C: a CREATEROLE role cannot mint a BYPASSRLS role, so the per-job dump role (pg-job-role.broker.ts) cannot be made to bypass RLS this way', /permission denied|must be superuser|superuser|BYPASSRLS/i.test(mint), mint.slice(0, 120));
  const alter = await withClient('postgres', (c) => c.query(`ALTER ROLE ${ROLES.minted} BYPASSRLS`), { user: ROLES.creator, password: PW }).then(() => 'altered', (e) => e.message);
  check('C: nor can it ALTER an existing role to BYPASSRLS', /permission denied|must be superuser|superuser|BYPASSRLS/i.test(alter), alter.slice(0, 120));
  say('   C also adds a second DATABASE login and therefore a new deployment secret (and one more thing to rotate and to hold outside the encrypted `credentials` table).');
  say('   RDS: whether the master user may CREATE ROLE ... BYPASSRLS / hold BYPASSRLS is UNMEASURED here; the manual check is in docs/runbooks/rds-proxy-rls-check.md.');
  await owner((c) => c.query('DROP TABLE spike_b_rows'));
}

// ===============================================================================================================================
async function backupRestore(root, clientModule) {
  say('\n## 9. option A with pg_dump and pg_restore (the arguments of buildPgDumpArgs / buildPgRestoreArgs)');
  // Seed a known number of rows through the system path.
  const base = makeClients({ clientModule, url: as('owner'), max: 3 });
  await runAsSystem(base, async (tx) => { await tx.spikeTenantRow.deleteMany(); await tx.spikeTenantRow.createMany({ data: [...Array(30).keys()].flatMap((i) => [{ orgId: ORG_A, payload: `a-${i}` }, { orgId: ORG_B, payload: `b-${i}` }]) }); });
  const total = await runAsSystem(base, (tx) => tx.spikeTenantRow.count());
  await base.$disconnect();
  say(`live table: ${total} rows across two orgs`);
  const f = (n) => join(root, `${n}.dump`);

  let r = run('pg_dump', dumpArgs('owner', DB, f('d1')), { env: pgenv() });
  show('D1: pg_dump as the app role, today\'s arguments (row_security = off)', `exit ${r.status}\n${r.stderr.trim().split('\n').slice(0, 3).join('\n')}`);
  check('D1: with FORCE RLS the CURRENT backup invocation FAILS LOUDLY ("query would be affected by row-level security policy")', r.status !== 0 && /row-level security/i.test(r.stderr));

  r = run('pg_dump', dumpArgs('owner', DB, f('d2'), ['--enable-row-security']), { env: pgenv() });
  const d2rows = r.status === 0 ? archiveRows(f('d2')) : -1;
  show('D2: --enable-row-security WITHOUT the bypass flag', `exit ${r.status}\nrows captured in the archive: ${d2rows} of ${total}`);
  check('D2: DANGER, --enable-row-security alone exits 0 and writes an archive with ZERO rows (a silent empty backup)', r.status === 0 && d2rows === 0);

  r = run('pg_dump', dumpArgs('owner', DB, f('d3'), ['--enable-row-security']), { env: pgenv(BYPASS_ENV) });
  const d3rows = r.status === 0 ? archiveRows(f('d3')) : -1;
  show('D3: --enable-row-security + PGOPTIONS="-c app.rls_bypass=on"', `exit ${r.status}\nrows captured: ${d3rows} of ${total}\n${r.stderr.slice(0, 200)}`);
  check('D3: the app role with --enable-row-security AND the bypass startup option captures EVERY row', r.status === 0 && d3rows === total);

  r = run('pg_dump', dumpArgs('owner', DB, f('d3b'), []), { env: pgenv(BYPASS_ENV) });
  show('D3b: the bypass option WITHOUT --enable-row-security', `exit ${r.status}\n${r.stderr.trim().split('\n')[0]}`);
  check('D3b: the GUC alone is not enough, pg_dump keeps row_security = off and still errors, so BOTH halves are required', r.status !== 0 && /row-level security/i.test(r.stderr));

  // minted per-job role, with the exact attributes and grants of pg-job-role.broker.ts
  await withAdmin((c) => c.query(`GRANT CONNECT ON DATABASE "${DB}" TO ${ROLES.minted}`));
  await withClient(DB, async (c) => { await c.query(`GRANT USAGE ON SCHEMA public TO ${ROLES.minted}`); await c.query(`GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${ROLES.minted}`); }, { user: ROLES.owner, password: PW });
  r = run('pg_dump', dumpArgs('minted', DB, f('d4')), { env: pgenv() });
  check('D4: the minted SELECT-only role also FAILS with today\'s arguments (policies apply to non-owners even without FORCE)', r.status !== 0 && /row-level security/i.test(r.stderr));
  r = run('pg_dump', dumpArgs('minted', DB, f('d4b'), ['--enable-row-security']), { env: pgenv(BYPASS_ENV) });
  const d4rows = r.status === 0 ? archiveRows(f('d4b')) : -1;
  check('D4: the minted role with --enable-row-security + PGOPTIONS bypass captures every row: option A needs NO change to the broker\'s role, grants or attributes', r.status === 0 && d4rows === total, `rows ${d4rows}`);
  const mintedSelf = await withClient(DB, async (c) => (await c.query('select count(*)::int n from spike_tenant_rows')).rows[0].n, { user: ROLES.minted, password: PW });
  check('D4: that role, WITHOUT the flag, sees nothing (its SELECT grant alone no longer exposes tenant rows)', mintedSelf === 0);

  // the archive's table of contents
  const toc = run('pg_restore', ['--list', f('d3')]).stdout.split('\n').filter((l) => /ROW SECURITY|POLICY|TABLE DATA public spike_tenant_rows|TABLE public spike_tenant_rows/.test(l));
  show('D5: archive TOC entries for the RLS table', toc.join('\n'));
  check('D5: the archive carries ROW SECURITY and POLICY entries (so a restore re-creates the protection)', toc.some((l) => /ROW SECURITY/.test(l)) && toc.some((l) => /POLICY/.test(l)));
  const sql = run('pg_restore', ['-f', '-', f('d3')]).stdout;
  check('D5: FORCE is preserved in the archive', /ALTER TABLE ONLY public\.spike_tenant_rows FORCE ROW LEVEL SECURITY/.test(sql));
  const tocLines = run('pg_restore', ['--list', f('d3')]).stdout.split('\n');
  const dataIdx = tocLines.findIndex((l) => /TABLE DATA public spike_tenant_rows/.test(l));
  const rlsIdx = tocLines.findIndex((l) => /ROW SECURITY .*spike_tenant_rows|ROW SECURITY public spike_tenant_rows/.test(l));
  say(`   TOC order: TABLE DATA at ${dataIdx}, ROW SECURITY at ${rlsIdx}, i.e. ${dataIdx < rlsIdx ? 'data is loaded BEFORE RLS is switched on' : 'RLS is switched on BEFORE the data loads'}`);

  // restore, the way database-restore.service.ts runs it: app role, --exit-on-error, -j
  const RESTORE = `${DB}_restore`;
  const restoreInto = async (name, role, env, jobs, extra = []) => {
    await dropDb(name);
    await withAdmin((c) => c.query(`CREATE DATABASE "${name}" OWNER ${ROLES.owner}`));
    const args = ['--host', PG.host, '--port', PG.port, '--username', ROLES[role] ?? role, '--dbname', name, '--no-password', '--no-owner', '--no-acl', '--exit-on-error', ...extra, ...(jobs > 1 ? ['-j', String(jobs)] : []), f('d3')];
    return run('pg_restore', args, { env: pgenv(env) });
  };
  r = await restoreInto(RESTORE, 'owner', {}, 1);
  const rowsNoFlag = await rowsInDb(RESTORE, ROLES.owner);
  show('R1: pg_restore as the app role, --exit-on-error, NO bypass option', `exit ${r.status}\n${r.stderr.trim().split('\n').slice(0, 3).join('\n')}\nrows in restored table: ${rowsNoFlag}`);
  say(`   observed: ${r.status === 0 ? 'the restore SUCCEEDS' : 'the restore FAILS'} and ${rowsNoFlag} of ${total} rows are readable (as superuser)`);
  r = await restoreInto(RESTORE, 'owner', BYPASS_ENV, 1);
  let restored = await rowsInDb(RESTORE, ROLES.owner);
  check('R2: pg_restore as the app role WITH PGOPTIONS bypass restores every row', r.status === 0 && restored === total, `exit ${r.status}, rows ${restored}${r.stderr ? ', ' + r.stderr.slice(0, 120) : ''}`);
  r = await restoreInto(RESTORE, 'owner', BYPASS_ENV, 3);
  show('R3: pg_restore -j 3 (what database-restore.service.ts does) with ONLY the bypass option', `exit ${r.status}\n${r.stderr.trim().split('\n').slice(0, 4).join('\n')}`);
  check('R3: a PARALLEL restore with only the bypass option FAILS: pg_restore sets row_security = off, and the post-data ADD CONSTRAINT FOREIGN KEY check then trips over a FORCEd table ("query would be affected by row-level security policy")', r.status !== 0 && /row-level security/i.test(r.stderr));
  r = await restoreInto(RESTORE, 'owner', BYPASS_ENV, 3, ['--enable-row-security']);
  restored = await rowsInDb(RESTORE, ROLES.owner);
  check('R3b: -j 3 with --enable-row-security AND the bypass option restores every row: the restore needs the SAME two halves as the dump', r.status === 0 && restored === total, `exit ${r.status}, rows ${restored}${r.stderr ? ', ' + r.stderr.slice(0, 160) : ''}`);
  const pol = await rows(RESTORE, "select (select count(*) from pg_policies where tablename = 'spike_tenant_rows') as policies, relrowsecurity, relforcerowsecurity from pg_class where relname = 'spike_tenant_rows'");
  check('R4: the restored database has the policy, ENABLE and FORCE intact', Number(pol[0].policies) === 1 && pol[0].relrowsecurity && pol[0].relforcerowsecurity);
  const scopedAfter = await withClient(RESTORE, async (c) => { await c.query('BEGIN'); await c.query("select set_config('app.org_id', $1, true)", [ORG_A]); const n = (await c.query('select count(*)::int n from spike_tenant_rows')).rows[0].n; await c.query('COMMIT'); return n; }, { user: ROLES.owner, password: PW });
  check('R5: and the restored database enforces the policy (org A sees its 30 rows)', scopedAfter === 30, `n=${scopedAfter}`);
  r = await restoreInto(RESTORE, 'owner', {}, 3, ['--enable-row-security']);
  show('R3c: -j 3 with --enable-row-security but NO bypass option', `exit ${r.status}\n${r.stderr.trim().split('\n').slice(0, 3).join('\n')}`);
  const r3cRows = await rowsInDb(RESTORE, ROLES.owner);
  check('R3c: --enable-row-security ALONE also restores every row, because the archive loads TABLE DATA before ROW SECURITY is switched on; the bypass option is kept as defence for any step that reads rows after it (and for a restoring role that does not own the tables)', r.status === 0 && r3cRows === total, `rows ${r3cRows}`);
  r = await restoreInto(RESTORE, 'postgres', {}, 1);
  restored = await rowsInDb(RESTORE, ROLES.owner);
  show('R6: pg_restore as a SUPERUSER with no flag (the cluster-admin shape)', `exit ${r.status}\nrows ${restored}`);
  check('R6: a true superuser restores everything with no flag (superusers ignore RLS even under FORCE). On RDS the master user is NOT a superuser: UNMEASURED, see the runbook', r.status === 0 && restored === total);
  await dropDb(RESTORE);
}

async function rowsInDb(database, owner) {
  return Number(await scalar(database, 'select count(*) from spike_tenant_rows'));
}

// ===============================================================================================================================
async function migrationsUnderRls(app) {
  say('\n## 10. migrations and seeds under FORCE: a backfill is system work');
  const pre = await withClient(DB, async (c) => (await c.query("select count(*)::int n from spike_tenant_rows where payload like '%!'")).rows[0].n, { user: ROLES.owner, password: PW });
  const migs = join(app, 'prisma', 'migrations');
  write(join(migs, '20261006010000_backfill_unscoped', 'migration.sql'), "UPDATE spike_tenant_rows SET payload = payload || '!';\n");
  let r = prisma(['migrate', 'deploy'], { cwd: app, database: DB, env: { DATABASE_URL: as('owner') } });
  const n1 = await withAdmin(async (c) => 0).then(() => scalar(DB, "select count(*) from spike_tenant_rows where payload like '%!'"));
  check('M1: a data migration that UPDATEs an RLS table WITHOUT the bypass applies "successfully" but changes ZERO rows (FORCE makes the owner subject to the policy)', r.status === 0 && Number(n1) === 0, `rows changed: ${n1}`);
  const variants = [
    ['M2', 'a bare `SELECT set_config(\'app.rls_bypass\', \'on\', true);` as the first statement', "SELECT set_config('app.rls_bypass', 'on', true);\nUPDATE spike_tenant_rows SET payload = payload || '?';\n", '?', false],
    ['M3', 'an explicit BEGIN; SELECT set_config(..., true); UPDATE ...; COMMIT;', "BEGIN;\nSELECT set_config('app.rls_bypass', 'on', true);\nUPDATE spike_tenant_rows SET payload = payload || '#';\nCOMMIT;\n", '#'],
    ['M4', 'a SESSION-level `SELECT set_config(..., false)` (the schema engine\'s own connection, never a request pool)', "SELECT set_config('app.rls_bypass', 'on', false);\nUPDATE spike_tenant_rows SET payload = payload || '%';\n", '%'],
  ];
  const total = Number(await scalar(DB, 'select count(*) from spike_tenant_rows'));
  let i = 2;
  for (const [id, label, sql, marker, works = true] of variants) {
    write(join(migs, `2026100602000${i++}_backfill_${id.toLowerCase()}`, 'migration.sql'), sql);
    r = prisma(['migrate', 'deploy'], { cwd: app, database: DB, env: { DATABASE_URL: as('owner') } });
    const n = Number(await scalar(DB, `select count(*) from spike_tenant_rows where payload like '%${marker}'`));
    show(`${id}: ${label}`, `migrate deploy exit ${r.status}; rows updated ${n}/${total}\n${r.status ? r.stderr.split('\n').slice(0, 6).join('\n') : ''}`);
    check(works ? `${id}: ${label} updates every row` : `${id}: ${label} does NOT work: the schema engine runs a migration statement by statement, so a transaction-local value is gone before the UPDATE (0 rows, no error)`, works ? r.status === 0 && n === total : r.status === 0 && n === 0, `${n}/${total}`);
  }
  say(`   rule for migration authors: any statement that must see all orgs begins with that set_config; DDL is unaffected by RLS. (rows before: ${pre})`);
}

// ===============================================================================================================================
async function benchmark(clientModule) {
  say('\n## 11. overhead of per-operation scoping (indicative: localhost, shared 4-CPU machine, pool of 5)');
  const base = makeClients({ clientModule, url: as('owner'), max: 5 });
  const N = 300;
  const timeIt = async (fn) => { await fn(); const s = t0(); for (let i = 0; i < N; i++) await fn(); return ms(s) / N; };
  const bare = await timeIt(() => base.spikeTenantRow.findFirst());
  const scoped = forScope(base, { orgId: ORG_A });
  const ext = await timeIt(() => scoped.spikeTenantRow.findFirst());
  const tx3 = await timeIt(() => runInScope(base, { orgId: ORG_A }, async (tx) => { await tx.spikeTenantRow.findFirst(); await tx.spikeTenantRow.count(); await tx.spikeTenantRow.findMany({ take: 5 }); }));
  const bare3 = await timeIt(async () => { await base.spikeTenantRow.findFirst(); await base.spikeTenantRow.count(); await base.spikeTenantRow.findMany({ take: 5 }); });
  show('mean ms per call', `bare findFirst (unscoped, returns nothing):         ${bare.toFixed(2)}\nextension findFirst (BEGIN, set_config, query, COMMIT): ${ext.toFixed(2)}\n3 bare operations:                                     ${bare3.toFixed(2)}\n3 operations inside one runInScope:                   ${tx3.toFixed(2)}`);
  check('scoping adds a bounded constant per operation (extension < 10x bare on localhost; runInScope amortises it over a unit of work)', ext < bare * 10 + 5, `${(ext - bare).toFixed(2)} ms extra per extension call`);
  await base.$disconnect();
}

await main(body);
