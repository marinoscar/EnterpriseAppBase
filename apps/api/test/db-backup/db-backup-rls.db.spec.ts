// =============================================================================
// Real-Postgres test: a backup carries EVERY row of a database whose tables
// FORCE row-level security, and a restore puts every row back (issue #725
// PP-6.5, ADR 0002 D5)
// =============================================================================
//
// THE FAILURE THIS SUITE EXISTS FOR IS SILENT. With row-level security forced on
// the org-owned tables, `pg_dump --enable-row-security` WITHOUT the
// `app.rls_bypass` startup option exits 0 and writes a plausible, valid archive
// that contains the schema and NO ROWS. Nothing errors until the day somebody
// restores it. The pair (flag + option) is what makes a dump complete, and only
// a real server can prove it.
//
// The suite builds its own database owned by an ORDINARY role
// (`createRlsDatabase`), because a superuser ignores every policy and would pass
// a broken dump. It then proves, with exact row counts per organization:
//
//   1. the engine's dump (`spawnPgDump`) restores (`spawnPgRestore`) into a
//      fresh database with every row, and the restored database STILL enforces
//      isolation (forced RLS and policies came back with the data);
//   2. the NEGATIVE CONTROLS: the flag without the option restores to empty
//      tables; the option without the flag is refused by `pg_dump`;
//   3. the per-job SELECT-only role the broker mints dumps every row too;
//   4. the CLI's own node-side dump (`apps/cli`, run in a child process because
//      it is a standalone ESM package) produces an archive with every row.
// =============================================================================

import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { promisify } from 'node:util';

import { Client } from 'pg';

import {
  PG_DUMP_COMMAND,
  RLS_BYPASS_PGOPTIONS,
  buildPgDumpArgs,
  pgClientEnv,
  spawnPgDump,
  spawnPgProcess,
  type PgConnection,
} from '../../src/db-backup/pg-dump.util';
import {
  resolveAdminConnection,
  withAdminConnection,
} from '../../src/db-backup/admin-connection.util';
import { PgJobRoleBroker, type PgJobRoleSeam } from '../../src/db-backup/pg-job-role.broker';
import { spawnPgRestore } from '../../src/db-backup/pg-restore.util';
import { createRlsDatabase, seedTwoOrgs, ORG_A, ORG_B, type RlsDatabase, type TwoOrgFixture } from '../helpers/rls-database.helper';
import { envFor } from '../helpers/scratch-database.helper';
import { resolveDbSuite } from '../jobs/db-test-support';

const { describeWithDb } = resolveDbSuite('db-backup-rls.db.spec');

const run = promisify(execFile);
const API_ROOT = join(__dirname, '..', '..');
const CLI_RUNNER = join(__dirname, '..', 'helpers', 'cli-node-dump.runner.mts');

const TABLES = ['storage_objects', 'storage_object_chunks', 'ai_runs', 'ai_usage_events'] as const;
type Table = (typeof TABLES)[number];

/** Rows per organization, per table (null = the organization-less usage event). */
type Counts = Record<Table, Record<string, number>>;

async function collect(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

/** Counts per org per table over `client`, whatever policies say about that client. */
async function countsOver(client: Client): Promise<Counts> {
  const out = {} as Counts;
  for (const table of TABLES) {
    const { rows } = await client.query<{ org: string | null; n: number }>(
      `SELECT org_id::text AS org, count(*)::int AS n FROM ${table} GROUP BY org_id`,
    );
    out[table] = Object.fromEntries(rows.map((r) => [r.org ?? 'none', r.n]));
  }
  return out;
}

describeWithDb('Backup and restore with row-level security forced (real Postgres)', () => {
  let db: RlsDatabase;
  let fx: TwoOrgFixture;
  let truth: Counts;
  let tmp: string;
  const dropRoles: Array<() => Promise<void>> = [];

  /** An independent session as the application role, with the dump's startup option when `bypass`. */
  async function sessionOn(database: string, bypass: boolean, as: PgConnection = db.connection): Promise<Client> {
    const client = new Client({
      host: as.host,
      port: Number(as.port),
      user: as.user,
      password: as.password,
      database,
      ...(bypass ? { options: RLS_BYPASS_PGOPTIONS } : {}),
    });
    await client.connect();
    return client;
  }

  /** Counts every row in `database` (bypass on: this is the ground truth for "is the row there"). */
  async function countsIn(database: string, as?: PgConnection): Promise<Counts> {
    const client = await sessionOn(database, true, as);
    try {
      return await countsOver(client);
    } finally {
      await client.end();
    }
  }

  /** Counts the rows ONE organization sees in `database`, with no bypass. */
  async function scopedCount(database: string, org: string | null, table: Table): Promise<number> {
    const client = await sessionOn(database, false);
    try {
      await client.query('BEGIN');
      if (org) await client.query("SELECT set_config('app.org_id', $1, true)", [org]);
      const { rows } = await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`);
      await client.query('ROLLBACK');
      return rows[0].n;
    } finally {
      await client.end();
    }
  }

  async function dump(connection: PgConnection = db.connection): Promise<Buffer> {
    const process = spawnPgDump({ connection });
    const [archive] = await Promise.all([collect(process.stdout), process.done]);
    return archive;
  }

  async function restore(archive: Buffer, database: string): Promise<void> {
    const process = spawnPgRestore({ connection: { ...db.connection, database }, stdin: Readable.from([archive]) });
    process.stdout.resume();
    await process.done;
  }

  beforeAll(async () => {
    db = await createRlsDatabase('bk');
    fx = await seedTwoOrgs(db, 3);
    tmp = mkdtempSync(join(tmpdir(), 'rls-backup-'));
    // Ground truth: the administrator (a superuser, so policies do not apply).
    truth = await db.admin(countsOver);
  }, 120_000);

  afterAll(async () => {
    for (const drop of dropRoles) await drop().catch(() => undefined);
    if (db) await db.destroy();
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  }, 60_000);

  it('starts from a database whose ground truth is non-trivial and split across organizations', () => {
    expect(truth.storage_objects).toEqual({ [ORG_A]: 3, [ORG_B]: 3 });
    expect(truth.storage_object_chunks).toEqual({ [ORG_A]: 2, [ORG_B]: 2 });
    expect(truth.ai_runs).toEqual({ [ORG_A]: 3, [ORG_B]: 3 });
    expect(truth.ai_usage_events).toEqual({ [ORG_A]: 3, [ORG_B]: 3, none: 1 });
    expect(fx.usageNone).toHaveLength(1);
  });

  it('dumps and restores every row, and the restored database still enforces isolation', async () => {
    const archive = await dump();
    const target = await db.createSibling('restored');
    await restore(archive, target);

    expect(await countsIn(target)).toEqual(truth);

    // Forced RLS and the policies travelled with the data...
    const client = await sessionOn(target, false);
    try {
      const forced = await client.query<{ relname: string }>(
        `SELECT relname FROM pg_class WHERE relname = ANY($1) AND relrowsecurity AND relforcerowsecurity ORDER BY relname`,
        [[...TABLES]],
      );
      expect(forced.rows.map((r) => r.relname)).toEqual([...TABLES].sort());
      const policies = await client.query<{ tablename: string }>(
        `SELECT DISTINCT tablename FROM pg_policies WHERE tablename = ANY($1)`,
        [[...TABLES]],
      );
      expect(policies.rows.map((r) => r.tablename).sort()).toEqual([...TABLES].sort());
    } finally {
      await client.end();
    }

    // ...so an unscoped session sees nothing and each organization sees only its own.
    for (const table of TABLES) {
      expect(await scopedCount(target, null, table)).toBe(0);
      expect(await scopedCount(target, ORG_A, table)).toBe(truth[table][ORG_A]);
      expect(await scopedCount(target, ORG_B, table)).toBe(truth[table][ORG_B]);
    }
  }, 120_000);

  it('NEGATIVE CONTROL: --enable-row-security WITHOUT the startup option exits 0 with an archive that restores to empty tables', async () => {
    const withoutOption = spawnPgProcess({
      command: PG_DUMP_COMMAND,
      args: buildPgDumpArgs({ connection: db.connection }),
      password: db.connection.password,
      extraEnv: pgClientEnv(db.connection),
    });
    const [archive] = await Promise.all([collect(withoutOption.stdout), withoutOption.done]);
    expect(archive.length).toBeGreaterThan(0);

    const target = await db.createSibling('empty');
    await restore(archive, target);

    const restored = await countsIn(target);
    for (const table of TABLES) expect(restored[table]).toEqual({});
  }, 120_000);

  it('NEGATIVE CONTROL: the startup option WITHOUT --enable-row-security is refused by pg_dump', async () => {
    const withoutFlag = spawnPgProcess({
      command: PG_DUMP_COMMAND,
      args: buildPgDumpArgs({ connection: db.connection }).filter((arg) => arg !== '--enable-row-security'),
      password: db.connection.password,
      extraEnv: { ...pgClientEnv(db.connection), PGOPTIONS: RLS_BYPASS_PGOPTIONS },
    });
    withoutFlag.stdout.resume();
    await expect(withoutFlag.done).rejects.toMatchObject({ detail: { stderr: expect.stringMatching(/row-level security/i) } });
  }, 60_000);

  it('the SELECT-only role the broker mints for a node dumps every row', async () => {
    const admin = resolveAdminConnection(envFor(db.database));
    const seam: PgJobRoleSeam = {
      resolveConnection: () => admin,
      withAdminConnection: (config, fn, options) => withAdminConnection(config, fn, options),
    };
    const broker = new PgJobRoleBroker(seam);

    const issued = await broker.issue({ id: crypto.randomUUID(), type: 'db.backup.run' } as never, new Date(Date.now() + 10 * 60_000));
    dropRoles.push(() => broker.revoke(issued.handle));

    const asMinted: PgConnection = {
      ...db.connection,
      user: issued.handle,
      password: issued.material.password as string,
    };

    const archive = await dump(asMinted);
    const target = await db.createSibling('minted');
    await restore(archive, target);

    expect(await countsIn(target)).toEqual(truth);
  }, 120_000);

  it("the CLI's node-side dump (apps/cli) carries every row too", async () => {
    const out = join(tmp, 'node-side.dump');
    await run(process.execPath, ['--import', 'tsx', CLI_RUNNER, out], {
      cwd: API_ROOT,
      env: { ...process.env, NODE_DUMP_CONNECTION: JSON.stringify(db.connection) },
      timeout: 90_000,
    });

    const target = await db.createSibling('cli');
    await restore(readFileSync(out), target);

    expect(await countsIn(target)).toEqual(truth);
  }, 120_000);
});
