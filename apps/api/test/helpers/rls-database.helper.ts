// =============================================================================
// A migrated throwaway database owned by an ORDINARY role, for the
// row-level-security suites (issue #725 PP-6.5, ADR 0002 D5)
// =============================================================================
//
// Row-level security is inert for a superuser: every Compose file and CI service
// in this repository connects as `postgres`, under which a `FORCE`d policy
// shows every row. So a suite that wants to PROVE isolation cannot use the
// shared test database. It builds its own:
//
//   1. an ordinary login role (NOSUPERUSER NOBYPASSRLS CREATEDB), the shape the
//      application runs as in a deployment that enforces tenant isolation;
//   2. a database OWNED by that role, migrated with the REAL `prisma migrate
//      deploy` AS that role, so the role owns every table (and `FORCE ROW
//      LEVEL SECURITY` is what makes the policies apply to it);
//   3. two Prisma clients on that role with separate pools: the tenant pool
//      (`tenant`) and the system pool (`system`), exactly the two the API has.
//
// The administrative connection (create the role and the database, drop them)
// uses the suite's configured `POSTGRES_*` credentials, which must therefore be
// able to `CREATE ROLE` and `CREATE DATABASE` (the superuser of the compose
// test database). Everything created here is dropped by `destroy()`.
//
// NOT A `*.spec.ts` FILE, so Jest never runs it as a suite.
// =============================================================================

import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { join } from 'node:path';

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Client } from 'pg';

import { buildDatabaseUrl, type DatabaseEnv } from '../../src/common/database-url';
import type { PgConnection } from '../../src/db-backup/pg-dump.util';
import { PrismaService } from '../../src/prisma/prisma.service';
import { PrismaSystemService } from '../../src/prisma/prisma-system.service';

/** `apps/api`, resolved from this file's location. */
const API_ROOT = join(__dirname, '..', '..');

/** The two organizations every fixture uses. */
export const ORG_A = '11111111-1111-4111-8111-aaaaaaaaaaaa';
export const ORG_B = '22222222-2222-4222-8222-bbbbbbbbbbbb';

export interface RlsDatabase {
  /** The database name. */
  database: string;
  /** The ordinary role that owns it and that both pools log in as. */
  role: string;
  /** That role's password. */
  password: string;
  /** The connection tuple for `pg_dump` / `pg_restore` as the application role. */
  connection: PgConnection;
  /** The environment (`POSTGRES_*`) that points the application's helpers at this database as the role. */
  env: DatabaseEnv;
  /** The tenant pool: the role's client with no scope set (what `PrismaService` is). */
  tenant: PrismaClient;
  /** A SEPARATE pool of the same role: what `PrismaSystemService` is. */
  system: PrismaClient;
  /** A connection to this database as the administrator (superuser), for catalogue reads and setup. */
  admin<T>(fn: (client: Client) => Promise<T>): Promise<T>;
  /** Creates a second empty database owned by the same role (a restore target). Dropped by `destroy()`. */
  createSibling(label: string): Promise<string>;
  /** Drops both pools, the databases and the role. Safe to call twice. */
  destroy(): Promise<void>;
}

function adminEnv(): DatabaseEnv {
  const { DATABASE_URL: _ignored, ...rest } = process.env;
  return rest;
}

async function withAdmin<T>(database: string, fn: (client: Client) => Promise<T>): Promise<T> {
  const env = adminEnv();
  const client = new Client({
    host: env.POSTGRES_HOST ?? 'localhost',
    port: Number(env.POSTGRES_PORT ?? 5432),
    user: env.POSTGRES_USER ?? 'postgres',
    password: env.POSTGRES_PASSWORD ?? 'postgres',
    database,
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end().catch(() => undefined);
  }
}

const quoteIdent = (name: string): string => `"${name.replace(/"/g, '""')}"`;

/**
 * Runs `prisma migrate deploy` against `database` AS `role`, through the same
 * `scripts/prisma-env.js` `npm run prisma:migrate` uses.
 */
function migrateAs(database: string, role: string, password: string): void {
  const { DATABASE_URL: _ignored, ...env } = process.env;
  execFileSync(process.execPath, ['scripts/prisma-env.js', 'migrate', 'deploy'], {
    cwd: API_ROOT,
    env: { ...env, POSTGRES_DB: database, POSTGRES_USER: role, POSTGRES_PASSWORD: password },
    stdio: 'pipe',
  });
}

function clientFor(env: DatabaseEnv, max: number): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: buildDatabaseUrl(env), max, application_name: 'rls-spec' }),
  });
}

/**
 * Creates the role, the database (owned by the role), migrates it as the role
 * and opens the two pools.
 *
 * @param label - a short tag for the names (letters, digits, underscore).
 * @param options - `pool`: connections per pool (default 8).
 */
export async function createRlsDatabase(label: string, options: { pool?: number } = {}): Promise<RlsDatabase> {
  const suffix = `${process.pid}_${randomBytes(3).toString('hex')}`;
  const role = `rls_${label}_${suffix}`.slice(0, 60);
  const database = `rls_${label}_db_${suffix}`.slice(0, 60);
  const password = randomBytes(12).toString('hex');
  const siblings: string[] = [];
  const base = adminEnv();

  await withAdmin('postgres', async (admin) => {
    await admin.query(`CREATE ROLE ${quoteIdent(role)} LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS CREATEDB`);
    await admin.query(`CREATE DATABASE ${quoteIdent(database)} OWNER ${quoteIdent(role)}`);
  });

  const env: DatabaseEnv = {
    ...base,
    POSTGRES_DB: database,
    POSTGRES_USER: role,
    POSTGRES_PASSWORD: password,
    POSTGRES_SSL: 'false',
  };

  try {
    migrateAs(database, role, password);
  } catch (error) {
    await dropAll(role, [database]);
    throw error;
  }

  const tenant = clientFor(env, options.pool ?? 8);
  const system = clientFor(env, options.pool ?? 8);
  let destroyed = false;

  return {
    database,
    role,
    password,
    connection: {
      host: env.POSTGRES_HOST ?? 'localhost',
      port: String(env.POSTGRES_PORT ?? 5432),
      user: role,
      password,
      database,
      sslMode: null,
    },
    env,
    tenant,
    system,
    admin: (fn) => withAdmin(database, fn),
    async createSibling(siblingLabel: string): Promise<string> {
      const name = `rls_${siblingLabel}_${suffix}`.slice(0, 60);
      siblings.push(name);
      await withAdmin('postgres', (admin) => admin.query(`CREATE DATABASE ${quoteIdent(name)} OWNER ${quoteIdent(role)}`));
      return name;
    },
    async destroy(): Promise<void> {
      if (destroyed) return;
      destroyed = true;
      await tenant.$disconnect().catch(() => undefined);
      await system.$disconnect().catch(() => undefined);
      await dropAll(role, [database, ...siblings]);
    },
  };
}

async function dropAll(role: string, databases: string[]): Promise<void> {
  await withAdmin('postgres', async (admin) => {
    for (const name of databases) {
      await admin.query(`DROP DATABASE IF EXISTS ${quoteIdent(name)} WITH (FORCE)`).catch(() => undefined);
    }
    await admin.query(`DROP ROLE IF EXISTS ${quoteIdent(role)}`).catch(() => undefined);
  });
}

/** What {@link seedTwoOrgs} created. */
export interface TwoOrgFixture {
  orgA: string;
  orgB: string;
  userA: string;
  userB: string;
  /** Storage object ids per organization. */
  objectsA: string[];
  objectsB: string[];
  /** `ai_runs` ids per organization. */
  runsA: string[];
  runsB: string[];
  /** `ai_usage_events` ids per organization. */
  usageA: string[];
  usageB: string[];
  /** The ids of usage events that belong to no organization (NULL). */
  usageNone: string[];
}

/**
 * Seeds two organizations, a user in each, and `perOrg` storage objects (the
 * first with two chunks), AI runs and usage events per organization, plus one
 * organization-less usage event, all through the SYSTEM pool (the only client
 * that may write across organizations).
 */
export async function seedTwoOrgs(db: RlsDatabase, perOrg = 3): Promise<TwoOrgFixture> {
  const f: TwoOrgFixture = {
    orgA: ORG_A,
    orgB: ORG_B,
    userA: randomUUID(),
    userB: randomUUID(),
    objectsA: [],
    objectsB: [],
    runsA: [],
    runsB: [],
    usageA: [],
    usageB: [],
    usageNone: [],
  };

  await db.system.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.rls_bypass', 'on', true)`;

    for (const [id, slug] of [[ORG_A, 'org-a'], [ORG_B, 'org-b']] as const) {
      await tx.organization.create({ data: { id, name: slug, slug } });
    }
    for (const [id, email] of [[f.userA, 'a@example.test'], [f.userB, 'b@example.test']] as const) {
      await tx.user.create({ data: { id, email, providerDisplayName: email } });
    }

    for (const [org, user, objects, runs, usage] of [
      [ORG_A, f.userA, f.objectsA, f.runsA, f.usageA],
      [ORG_B, f.userB, f.objectsB, f.runsB, f.usageB],
    ] as const) {
      for (let i = 0; i < perOrg; i += 1) {
        const object = await tx.storageObject.create({
          data: {
            orgId: org,
            name: `${org.slice(0, 4)}-${i}.txt`,
            size: BigInt(10 + i),
            mimeType: 'text/plain',
            storageKey: `uploads/${org}/${randomUUID()}.txt`,
            storageProvider: 's3',
            status: 'ready',
            uploadedById: user,
          },
        });
        objects.push(object.id);

        if (i === 0) {
          for (const partNumber of [1, 2]) {
            await tx.storageObjectChunk.create({
              data: { objectId: object.id, orgId: org, partNumber, eTag: `etag-${partNumber}`, size: BigInt(5) },
            });
          }
        }

        runs.push(
          (
            await tx.aiRun.create({
              data: { orgId: org, userId: user, provider: 'openai', modelId: 'm', status: 'succeeded', request: { input: `run ${i}` } },
            })
          ).id,
        );
        usage.push(
          (
            await tx.aiUsageEvent.create({
              data: { orgId: org, userId: user, provider: 'openai', modelId: 'm', operation: 'responses', keySource: 'user', latencyMs: 5, status: 'succeeded' },
            })
          ).id,
        );
      }
    }

    f.usageNone.push(
      (
        await tx.aiUsageEvent.create({
          data: { orgId: null, userId: null, provider: 'openai', modelId: '*', operation: 'catalog', keySource: 'admin_discovery', latencyMs: 1, status: 'succeeded' },
        })
      ).id,
    );
  });

  return f;
}

/**
 * The application's own two database providers, built against `db` as its
 * ordinary role: `PrismaService` (the tenant pool, `forOrg` / `runInOrg`) and
 * `PrismaSystemService` (the separate bypass pool). For a suite that drives a
 * REAL service (`ObjectsService`, a job handler) over a database that
 * enforces row-level security. `close()` disconnects both.
 */
export function rlsServices(db: RlsDatabase): { prisma: PrismaService; system: PrismaSystemService; close: () => Promise<void> } {
  const saved = { ...process.env };
  // Both constructors read the environment once; see `createDbClient` for why DATABASE_URL must not win.
  delete process.env.DATABASE_URL;
  Object.assign(process.env, {
    POSTGRES_HOST: db.env.POSTGRES_HOST,
    POSTGRES_PORT: db.env.POSTGRES_PORT,
    POSTGRES_DB: db.database,
    POSTGRES_USER: db.role,
    POSTGRES_PASSWORD: db.password,
    POSTGRES_SSL: 'false',
  });
  try {
    const prisma = new PrismaService();
    const system = new PrismaSystemService();
    return {
      prisma,
      system,
      close: async () => {
        await prisma.$disconnect();
        await system.$disconnect();
      },
    };
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
}
