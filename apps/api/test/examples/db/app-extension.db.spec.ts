// =============================================================================
// The app-extension data seams against real Postgres (PP-14.27)
// =============================================================================
//
// A migrated scratch database (the REAL `prisma migrate deploy`, as an operator
// runs it), then:
//
//   1. `users.metadata` and `organizations.metadata`: the default, the app
//      namespace through the platform's `IdentityMetadataService` (the
//      `FOR UPDATE` read-modify-write really serialises concurrent writers of
//      different namespaces), and the database CHECK that backs the 16 KiB limit;
//   2. an app table beside the platform's (`coach-notes.migration.sql`): its keys
//      to `notifications` and to `grants (id, org_id)` (composite, so a note
//      cannot point at another organization's grant), its forced row-level
//      security, and the SAME lock entries `app-schema-objects.spec.ts` checks
//      offline, now asserted against `pg_indexes`, `pg_policies` and `pg_class`
//      exactly as `platform db drift` does;
//   3. an app seed step through `seedPlatform(..., { extras })`, idempotent.
//
// THIS IS A `*.db.spec.ts` FILE: skipped with a warning when no Postgres is
// reachable. Run with `npm run test:db`.
// =============================================================================

import { Client } from 'pg';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';

import { withTemporaryEntries } from '@marinoscar/platform-api/core';
import { IdentityMetadataService, MetadataError, organizationMetadataRegistry, userMetadataRegistry, type IdentityPrisma } from '@marinoscar/platform-api/identity';
import {
  RAW_SQL_INDEXES,
  RLS_POLICIES,
  checkRawSqlIndexes,
  checkRlsPolicies,
  readIndexRows,
  readPolicyRows,
  readTableRlsRows,
} from '@marinoscar/platform-db';
import { assertSeedIdempotent, platformSeedInputFrom, seedPlatform } from '@marinoscar/platform-db/seed';
import { createDatabase, databaseExists, dropDatabase, resolveAdminConnection, withAdminConnection, type AdminConnection } from '@marinoscar/platform-api/db-backup/testing';

import { SEED_SNAPSHOT } from '../../../prisma/seed-data';
import { buildDatabaseUrl } from '../../../src/common/database-url';
import { coachPreferences } from '../../../src/app-registrations/identity';
import { COACH_PROGRAM_EMAIL, seedCoachDefaults } from '../../../src/platform-extensions/db/coach-defaults.seed-step';
import { envFor, migrateDeploy, prismaClientFor } from '../../helpers/scratch-database.helper';
import { resolveDbSuite } from '../../jobs/db-test-support';
import { COACH_NOTES_SQL, lockWithCoachNotes } from './coach-fixture';

const { describeWithDb } = resolveDbSuite('app-extension.db.spec');

const API_ROOT = `${__dirname}/../../..`;

describeWithDb('app metadata, an app table and an app seed step (real Postgres)', () => {
  const dbName = `app_extension_${process.pid}_${Date.now()}`;
  let admin: AdminConnection;
  let prisma: PrismaClient;
  let url: string;
  let metadata: IdentityMetadataService;

  /** Runs `sql` as a session of the application role in one transaction, with the bypass or an organization scope. */
  async function inTransaction<T>(scope: { orgId?: string; bypass?: boolean }, fn: (client: Client) => Promise<T>): Promise<T> {
    const client = new Client({ connectionString: url });
    await client.connect();
    try {
      await client.query('BEGIN');
      if (scope.bypass) await client.query("SELECT set_config('app.rls_bypass', 'on', true)");
      if (scope.orgId) await client.query("SELECT set_config('app.org_id', $1, true)", [scope.orgId]);
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      await client.end();
    }
  }

  beforeAll(async () => {
    const { DATABASE_URL: _ignored, ...env } = process.env;
    admin = resolveAdminConnection(env);
    await withAdminConnection(admin, (client) => createDatabase(client, dbName));
    migrateDeploy(dbName);
    url = buildDatabaseUrl(envFor(dbName));
    prisma = prismaClientFor(dbName);
    metadata = new IdentityMetadataService(prisma as unknown as IdentityPrisma);
  }, 240_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await withAdminConnection(admin, async (client) => {
      if (await databaseExists(client, dbName)) await dropDatabase(client, dbName).catch(() => undefined);
    }).catch(() => undefined);
  }, 30_000);

  describe('users.metadata and organizations.metadata', () => {
    it('start as an empty document on every row, including ones that predate the column', async () => {
      const user = await prisma.user.create({ data: { email: 'plain@example.test' } });
      const org = await prisma.organization.create({ data: { name: 'Plain', slug: 'plain' } });
      expect(user.metadata).toEqual({});
      expect(org.metadata).toEqual({});
    });

    it('round-trips a namespace through the platform service and leaves the others alone', async () => {
      const user = await prisma.user.create({ data: { email: 'coach@example.test' } });
      await prisma.$executeRaw`UPDATE "users" SET "metadata" = '{"someone.else": {"keep": true}}'::jsonb WHERE "id" = ${user.id}::uuid`;

      await expect(metadata.getUserMetadata(user.id, coachPreferences)).resolves.toBeUndefined();
      await metadata.setUserMetadata(user.id, coachPreferences, { reminderHour: 6, weeklyDigest: false, labels: ['u16'] });
      await expect(metadata.getUserMetadata(user.id, coachPreferences)).resolves.toEqual({ reminderHour: 6, weeklyDigest: false, labels: ['u16'] });
      const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(row.metadata).toEqual({ 'someone.else': { keep: true }, 'preferences.coach': { reminderHour: 6, weeklyDigest: false, labels: ['u16'] } });

      await metadata.deleteUserMetadata(user.id, coachPreferences);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).metadata).toEqual({ 'someone.else': { keep: true } });
    });

    it('serialises concurrent writers of different namespaces: no update is lost', async () => {
      const counter = (namespace: string) => ({ namespace, schema: z.object({ n: z.number().int() }) });
      await withTemporaryEntries(userMetadataRegistry, [counter('counter.a'), counter('counter.b')], async () => {
        const user = await prisma.user.create({ data: { email: 'racer@example.test' } });
        const bump = (namespace: string) => metadata.updateUserMetadata<{ n: number }>(user.id, namespace, (current) => ({ n: (current?.n ?? 0) + 1 }));
        await Promise.all(Array.from({ length: 20 }, (_, i) => bump(i % 2 === 0 ? 'counter.a' : 'counter.b')));
        const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
        expect(row.metadata).toEqual({ 'counter.a': { n: 10 }, 'counter.b': { n: 10 } });
      });
    });

    it('serves organizations from their own column', async () => {
      const org = await prisma.organization.create({ data: { name: 'Program', slug: 'program' } });
      await withTemporaryEntries(organizationMetadataRegistry, [{ namespace: 'program.coach', schema: z.object({ seats: z.number().int().positive() }) }], async () => {
        await metadata.setOrganizationMetadata(org.id, 'program.coach', { seats: 12 });
        await expect(metadata.getOrganizationMetadata(org.id, 'program.coach')).resolves.toEqual({ seats: 12 });
        await expect(metadata.setOrganizationMetadata(org.id, 'program.coach', { seats: -1 })).rejects.toBeInstanceOf(MetadataError);
      });
      expect((await prisma.organization.findUniqueOrThrow({ where: { id: org.id } })).metadata).toEqual({ 'program.coach': { seats: 12 } });
    });

    it('is backed by a CHECK in the database: a non-object or an oversized document is refused whoever writes it', async () => {
      const user = await prisma.user.create({ data: { email: 'big@example.test' } });
      const attempt = (sql: string) => prisma.$executeRawUnsafe(sql, user.id).then(() => 'ok', (e: { message: string }) => e.message);
      expect(await attempt(`UPDATE users SET metadata = '[]'::jsonb WHERE id = $1::uuid`)).toMatch(/users_metadata_size_check/);
      expect(await attempt(`UPDATE users SET metadata = jsonb_build_object('x', repeat('a', 40000)) WHERE id = $1::uuid`)).toMatch(/users_metadata_size_check/);
      expect(await attempt(`UPDATE users SET metadata = jsonb_build_object('x', repeat('a', 30000)) WHERE id = $1::uuid`)).toBe('ok');
      const org = await prisma.organization.create({ data: { name: 'Big', slug: 'big' } });
      const orgAttempt = await prisma.$executeRawUnsafe(`UPDATE organizations SET metadata = '"string"'::jsonb WHERE id = $1::uuid`, org.id).then(() => 'ok', (e: { message: string }) => e.message);
      expect(orgAttempt).toMatch(/organizations_metadata_size_check/);
    });
  });

  describe('an app table with keys to platform models and its own row-level security', () => {
    let orgA: string;
    let orgB: string;
    let grantInA: string;
    let notificationId: string;

    beforeAll(async () => {
      const client = new Client({ connectionString: url });
      await client.connect();
      await client.query(COACH_NOTES_SQL);
      await client.end();

      orgA = (await prisma.organization.create({ data: { name: 'A', slug: 'org-a' } })).id;
      orgB = (await prisma.organization.create({ data: { name: 'B', slug: 'org-b' } })).id;
      const user = await prisma.user.create({ data: { email: 'notified@example.test' } });
      notificationId = (await prisma.notification.create({ data: { userId: user.id, eventKey: 'test.event', title: 't', body: 'b' } })).id;
      grantInA = await inTransaction({ bypass: true }, async (client) => {
        const { rows } = await client.query(
          `INSERT INTO grants (id, org_id, resource_type, resource_id, grantee_kind, grantee_user_id, role, updated_at)
           VALUES (gen_random_uuid(), $1, 'doc', gen_random_uuid(), 'user', $2, 'viewer', now()) RETURNING id`,
          [orgA, user.id],
        );
        return String(rows[0].id);
      });
    }, 60_000);

    const insertNote = (orgId: string, columns: { notification?: string; grant?: string } = {}) =>
      inTransaction({ orgId }, (client) =>
        client.query(`INSERT INTO coach_notes (id, org_id, notification_id, grant_id, body) VALUES (gen_random_uuid(), $1, $2, $3, 'n')`, [orgId, columns.notification ?? null, columns.grant ?? null]),
      );

    it('links to a notification and to a grant of its own organization', async () => {
      await expect(insertNote(orgA, { notification: notificationId })).resolves.toBeDefined();
      await expect(insertNote(orgA, { grant: grantInA })).resolves.toBeDefined();
    });

    it('cannot link to a grant of another organization: the composite key (grant_id, org_id) refuses it', async () => {
      await expect(insertNote(orgB, { grant: grantInA })).rejects.toMatchObject({ code: '23503', constraint: 'coach_notes_grant_id_org_id_fkey' });
    });

    it('enforces its partial unique index: one plain note per notification', async () => {
      await expect(insertNote(orgA, { notification: notificationId })).rejects.toMatchObject({ code: '23505', constraint: 'coach_notes_notification_plain_uniq_idx' });
    });

    it('is invisible without a scope and to another organization, and refuses a write into another organization', async () => {
      await expect(inTransaction({}, (c) => c.query('SELECT 1 FROM coach_notes'))).resolves.toMatchObject({ rowCount: 0 });
      await expect(inTransaction({ orgId: orgB }, (c) => c.query('SELECT 1 FROM coach_notes'))).resolves.toMatchObject({ rowCount: 0 });
      await expect(inTransaction({ orgId: orgA }, (c) => c.query('SELECT 1 FROM coach_notes'))).resolves.toMatchObject({ rowCount: 2 });
      await expect(inTransaction({ orgId: orgB }, (c) => c.query(`INSERT INTO coach_notes (id, org_id, body) VALUES (gen_random_uuid(), $1, 'x')`, [orgA]))).rejects.toMatchObject({ code: '42501' });
    });

    it('matches the lock entries the offline check reads: the live twin of `platform db drift`', async () => {
      const lock = lockWithCoachNotes();
      const indexes = await readIndexRows(url, API_ROOT);
      const policies = await readPolicyRows(url, API_ROOT);
      const tables = await readTableRlsRows(url, API_ROOT);
      expect(checkRawSqlIndexes([...RAW_SQL_INDEXES, ...(lock.rawSqlIndexes ?? [])], indexes)).toEqual([]);
      expect(checkRlsPolicies([...RLS_POLICIES, ...(lock.rlsPolicies ?? [])], policies, tables)).toEqual([]);
    });
  });

  describe('an app seed step', () => {
    it('runs after the platform half, creates its row once and is idempotent', async () => {
      const lines: string[] = [];
      const run = () =>
        seedPlatform(prisma, platformSeedInputFrom(SEED_SNAPSHOT, {}), { log: { info: (m) => void lines.push(m) }, extras: [seedCoachDefaults] });
      const { first, second } = await assertSeedIdempotent(run);
      expect(first.extras).toEqual([{ id: 'coach.defaults', created: 1, updated: 0 }]);
      expect(second.extras).toEqual([{ id: 'coach.defaults', created: 0, updated: 0 }]);
      expect(await prisma.allowedEmail.count({ where: { email: COACH_PROGRAM_EMAIL } })).toBe(1);
      expect(lines).toEqual(expect.arrayContaining(['Seeding coach.defaults...', '✓ coach.defaults: 1 created, 0 updated', '✓ coach.defaults: 0 created, 0 updated']));
    }, 120_000);
  });
});
