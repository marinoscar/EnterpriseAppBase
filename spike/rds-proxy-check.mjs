#!/usr/bin/env node
// Q6 helper: the workload for docs/runbooks/rds-proxy-rls-check.md.
//
// It is meant to be run by a person against RDS PostgreSQL + RDS Proxy in an AWS account, but it works against
// any PostgreSQL and any pooler (the spike's own dry run points it at PgBouncer). It does three things:
//   1. prepares disposable objects (a role, two tables, one with the RLS policy) over a DIRECT connection;
//   2. runs timed phases THROUGH the pooler, printing each phase's UTC start and end so the operator can read
//      the proxy's pinning metric for exactly that window;
//   3. asserts tenant isolation in the transaction-local phase (zero cross-org rows) and exits non-zero if it fails.
//
// Environment (no value is ever printed):
//   CHECK_ADMIN_URL      postgresql://user:pass@<DB endpoint>:5432/<db>   a DIRECT connection with rights to CREATE ROLE
//   CHECK_APP_PASSWORD   password to give (and that the proxy's secret must hold for) the role pp_5_1_rls_app
//   CHECK_PROXY_HOST     the pooler's endpoint (RDS Proxy endpoint or PgBouncer host)
//   CHECK_PROXY_PORT     default 5432
//   CHECK_SSL            "require" (verify), "no-verify" (TLS without CA verification), or unset (no TLS)
//   CHECK_PHASE_SECONDS  default 150 (CloudWatch pinning metrics are one-minute points: keep it at 120 or more on AWS)
//   CHECK_KEEP           "1" leaves the objects in place
//   CHECK_PROBE_BYPASSRLS "1" also probes whether the admin role may create a BYPASSRLS role

import { createRequire } from 'node:module';
import pg from 'pg';

import { begin, check, freshWorkdir, join, main, prisma, say, show, write, writeConfig } from './lib/env.mjs';
import { forScope, runInScope } from './lib/rls.mjs';

const require = createRequire(import.meta.url);
const need = (name) => {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required (see the header of spike/rds-proxy-check.mjs)`);
  return v;
};
const ROLE = 'pp_5_1_rls_app';
const PROBE = 'pp_5_1_probe_bypass';
const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const seconds = Number(process.env.CHECK_PHASE_SECONDS ?? 150);
const ssl = process.env.CHECK_SSL === 'require' ? true : process.env.CHECK_SSL === 'no-verify' ? { rejectUnauthorized: false } : undefined;

const SCHEMA = `generator client {
  provider = "prisma-client-js"
  output   = "./generated"
}

datasource db {
  provider = "postgresql"
}

model Row {
  id      String @id @default(uuid()) @db.Uuid
  orgId   String @map("org_id") @db.Uuid
  payload String

  @@map("pp_5_1_rows")
}

model Plain {
  id      String @id @default(uuid()) @db.Uuid
  payload String

  @@map("pp_5_1_plain")
}
`;

const stamp = () => new Date().toISOString();

await main(async () => {
  begin('rds-proxy-check');
  const admin = new URL(need('CHECK_ADMIN_URL'));
  const appPassword = need('CHECK_APP_PASSWORD');
  const proxyHost = need('CHECK_PROXY_HOST');
  const proxyPort = Number(process.env.CHECK_PROXY_PORT ?? 5432);
  const database = admin.pathname.slice(1);
  const pool = (cfg) => new pg.Client({ ssl, ...cfg });
  const adminClient = pool({ host: admin.hostname, port: Number(admin.port || 5432), user: decodeURIComponent(admin.username), password: decodeURIComponent(admin.password), database });
  await adminClient.connect();
  say(`server: ${(await adminClient.query('select version() as v')).rows[0].v}`);

  // ---- 1. facts about the roles (answers the BYPASSRLS question for option C) ---------------------------------
  const me = (await adminClient.query("select rolname, rolsuper, rolbypassrls, rolcreaterole from pg_roles where rolname = current_user")).rows[0];
  const rdsMember = (await adminClient.query("select pg_has_role(current_user, 'rds_superuser', 'member') as m").catch(() => ({ rows: [{ m: null }] }))).rows[0].m;
  show('admin role', `${me.rolname}: superuser=${me.rolsuper} bypassrls=${me.rolbypassrls} createrole=${me.rolcreaterole} rds_superuser member=${rdsMember}`);
  say(`FACT admin_bypassrls=${me.rolbypassrls} admin_superuser=${me.rolsuper}`);
  if (process.env.CHECK_PROBE_BYPASSRLS === '1') {
    const outcome = await adminClient.query(`CREATE ROLE ${PROBE} BYPASSRLS`).then(() => 'created', (e) => `refused: ${e.message}`);
    await adminClient.query(`DROP ROLE IF EXISTS ${PROBE}`).catch(() => {});
    say(`FACT create_role_bypassrls=${outcome}`);
  }

  // ---- 2. objects ----------------------------------------------------------------------------------------------------
  await adminClient.query(`DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${ROLE}') THEN CREATE ROLE ${ROLE} LOGIN NOSUPERUSER NOBYPASSRLS; END IF; END $$`);
  await adminClient.query(`ALTER ROLE ${ROLE} WITH LOGIN PASSWORD '${appPassword.replace(/'/g, "''")}' NOSUPERUSER NOBYPASSRLS`);
  await adminClient.query(`GRANT CONNECT ON DATABASE "${database}" TO ${ROLE}`);
  await adminClient.query(`GRANT ALL ON SCHEMA public TO ${ROLE}`);
  const appRole = (await adminClient.query('select rolsuper, rolbypassrls from pg_roles where rolname = $1', [ROLE])).rows[0];
  check('the application role is NOSUPERUSER and NOBYPASSRLS (otherwise RLS is inert)', !appRole.rolsuper && !appRole.rolbypassrls);

  const direct = pool({ host: admin.hostname, port: Number(admin.port || 5432), user: ROLE, password: appPassword, database });
  await direct.connect();
  await direct.query('DROP TABLE IF EXISTS pp_5_1_rows, pp_5_1_plain');
  await direct.query('CREATE TABLE pp_5_1_rows (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL, payload text NOT NULL)');
  await direct.query('CREATE TABLE pp_5_1_plain (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), payload text NOT NULL)');
  await direct.query('ALTER TABLE pp_5_1_rows ENABLE ROW LEVEL SECURITY');
  await direct.query('ALTER TABLE pp_5_1_rows FORCE ROW LEVEL SECURITY');
  await direct.query(`CREATE POLICY org_isolation ON pp_5_1_rows USING ("org_id" = NULLIF(current_setting('app.org_id', true), '')::uuid OR current_setting('app.rls_bypass', true) = 'on')`);
  await direct.query("SELECT set_config('app.rls_bypass', 'on', false)");
  await direct.query(`INSERT INTO pp_5_1_rows (org_id, payload) SELECT CASE WHEN g % 2 = 0 THEN '${ORG_A}'::uuid ELSE '${ORG_B}'::uuid END, 'row-' || g FROM generate_series(1, 40) g`);
  await direct.query("INSERT INTO pp_5_1_plain (payload) SELECT 'plain-' || g FROM generate_series(1, 20) g");
  await direct.end();

  // ---- 3. Prisma client -------------------------------------------------------------------------------------------------
  const dir = freshWorkdir('rds-check');
  write(join(dir, 'prisma', 'schema.prisma'), SCHEMA);
  writeConfig(dir, { schema: 'prisma/schema.prisma' });
  const gen = prisma(['generate'], { cwd: dir, env: { DATABASE_URL: 'postgresql://x:x@localhost:5432/x' } });
  if (gen.status !== 0) throw new Error(`prisma generate failed: ${gen.stderr}`);
  const { PrismaClient } = require(join(dir, 'prisma', 'generated', 'index.js'));
  const { PrismaPg } = require('@prisma/adapter-pg');
  const base = new PrismaClient({ adapter: new PrismaPg({ host: proxyHost, port: proxyPort, user: ROLE, password: appPassword, database, ssl, max: 10 }) });

  const phase = async (name, fn) => {
    const start = stamp();
    say(`\nPHASE ${name} start ${start}`);
    const until = Date.now() + seconds * 1000;
    let ops = 0;
    const result = await fn(() => Date.now() < until, () => { ops++; });
    const end = stamp();
    say(`PHASE ${name} end   ${end}   operations=${ops}`);
    say(`WINDOW ${name} ${start} ${end}`);
    return result;
  };
  const workers = (n, body) => Promise.all([...Array(n)].map((_, i) => body(i)));

  // P0 control: plain statements on a table with no RLS and no set_config.
  await phase('P0-plain-queries', (live, tick) => workers(8, async () => { while (live()) { await base.plain.findMany({ take: 5 }); tick(); } }));
  // P1 the real workload: transaction-local scope, two orgs, interleaved.
  let cross = 0;
  let short = 0;
  await phase('P1-transaction-local-scope', (live, tick) => workers(8, async (i) => {
    const orgId = i % 2 === 0 ? ORG_A : ORG_B;
    const scoped = forScope(base, { orgId });
    while (live()) {
      const a = await scoped.row.findMany();
      const b = await runInScope(base, { orgId }, (tx) => tx.row.findMany());
      cross += [...a, ...b].filter((r) => r.orgId !== orgId).length;
      if (a.length !== 20 || b.length !== 20) short++;
      tick();
    }
  }));
  check('P1: every request saw ONLY its own org (zero cross-org rows) and all 20 of its rows, through the pooler', cross === 0 && short === 0, `cross-org rows ${cross}, short reads ${short}`);
  const unscoped = await base.row.count();
  check('P1: an unscoped client through the pooler still sees nothing (fail-closed)', unscoped === 0);
  // P2 positive control: a session-level setting. This is EXPECTED to pin on RDS Proxy.
  let leaks = 0;
  await phase('P2-session-level-set-POSITIVE-CONTROL', (live, tick) => workers(8, async (i) => {
    const orgId = i % 2 === 0 ? ORG_A : ORG_B;
    while (live()) {
      await base.$executeRaw`SELECT set_config('app.org_id', ${orgId}, false)`;
      leaks += (await base.row.findMany()).filter((r) => r.orgId !== orgId).length;
      tick();
    }
  }));
  say(`FACT p2_cross_org_rows=${leaks}  (a pooler that pins the session makes this zero; a transaction pooler that does not pin makes it positive)`);
  await base.$disconnect();

  say('\nNEXT: read DatabaseConnectionsCurrentlySessionPinned (Maximum, 1-minute period) for each WINDOW line above and search the proxy log for "pinned". See docs/runbooks/rds-proxy-rls-check.md.');

  if (process.env.CHECK_KEEP !== '1') {
    // The application role owns the tables, so it drops them (the admin role may not be a member of it).
    const cleanup = pool({ host: admin.hostname, port: Number(admin.port || 5432), user: ROLE, password: appPassword, database });
    await cleanup.connect();
    await cleanup.query('DROP TABLE IF EXISTS pp_5_1_rows, pp_5_1_plain');
    await cleanup.end();
    await adminClient.query(`REVOKE ALL ON SCHEMA public FROM ${ROLE}`).catch(() => {});
    await adminClient.query(`REVOKE CONNECT ON DATABASE "${database}" FROM ${ROLE}`).catch(() => {});
    await adminClient.query(`DROP ROLE IF EXISTS ${ROLE}`).catch((e) => say(`note: role ${ROLE} left in place (${e.message})`));
  }
  await adminClient.end();
});
