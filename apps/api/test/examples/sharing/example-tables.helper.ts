// =============================================================================
// The TEST-ONLY tables of the sharing examples (issue #732)
// =============================================================================
//
// The template ships no product table (every fork would inherit it), so the
// examples share records of two tables each spec creates in `beforeAll` on its
// throwaway database, with the standard `<table>_org_isolation` policy:
//
//   sharing_test_docs    (#729's table, ../../sharing/sharing-test-docs.helper.ts):
//                        user-owned "notes", kvox-style
//   sharing_test_albums  group-owned albums, MemoriaHub-style, link-shareable;
//                        `cover_key` is the object-storage key of the cover
//
// A real app's table follows the same column convention (README "Data"):
// `owner_user_id`, `owner_group_id ... ON DELETE RESTRICT`, `org_id`, RLS.
//
// NOT A `*.spec.ts` FILE, so Jest never runs it as a suite.
// =============================================================================

import { randomUUID } from 'node:crypto';

import type { RlsDatabase } from '../../helpers/rls-database.helper';

export { createTestDocsTable as createNotesTable } from '../../sharing/sharing-test-docs.helper';

/** Inserts one note (a `sharing_test_docs` row) through the bypass (setup only). */
export async function insertNote(db: RlsDatabase, note: { orgId: string; ownerUserId?: string; ownerGroupId?: string; title?: string }): Promise<string> {
  const id = randomUUID();
  await db.system.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.rls_bypass', 'on', true)`;
    await tx.$executeRaw`
      INSERT INTO sharing_test_docs (id, org_id, owner_user_id, owner_group_id, title)
      VALUES (${id}::uuid, ${note.orgId}::uuid, ${note.ownerUserId ?? null}::uuid, ${note.ownerGroupId ?? null}::uuid, ${note.title ?? 'Note'})`;
  });
  return id;
}

/** Creates `sharing_test_albums`: owned by a group (MemoriaHub's circle), with RLS. */
export async function createAlbumsTable(db: RlsDatabase): Promise<void> {
  await db.tenant.$executeRawUnsafe(`
    CREATE TABLE sharing_test_albums (
      id uuid PRIMARY KEY,
      org_id uuid NOT NULL REFERENCES organizations(id),
      owner_user_id uuid NULL REFERENCES users(id),
      owner_group_id uuid NULL REFERENCES groups(id) ON DELETE RESTRICT,
      title text NOT NULL DEFAULT '',
      cover_key text NOT NULL DEFAULT '',
      CHECK (num_nonnulls(owner_user_id, owner_group_id) = 1)
    )`);
  await db.tenant.$executeRawUnsafe('ALTER TABLE sharing_test_albums ENABLE ROW LEVEL SECURITY');
  await db.tenant.$executeRawUnsafe('ALTER TABLE sharing_test_albums FORCE ROW LEVEL SECURITY');
  await db.tenant.$executeRawUnsafe(`
    CREATE POLICY "sharing_test_albums_org_isolation" ON "sharing_test_albums"
      USING      ("org_id" = NULLIF(current_setting('app.org_id', true), '')::uuid
                  OR current_setting('app.rls_bypass', true) = 'on')
      WITH CHECK ("org_id" = NULLIF(current_setting('app.org_id', true), '')::uuid
                  OR current_setting('app.rls_bypass', true) = 'on')`);
}

/** Inserts one album through the bypass (setup only). */
export async function insertAlbum(db: RlsDatabase, album: { orgId: string; ownerGroupId: string; title?: string; coverKey?: string }): Promise<string> {
  const id = randomUUID();
  await db.system.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.rls_bypass', 'on', true)`;
    await tx.$executeRaw`
      INSERT INTO sharing_test_albums (id, org_id, owner_group_id, title, cover_key)
      VALUES (${id}::uuid, ${album.orgId}::uuid, ${album.ownerGroupId}::uuid, ${album.title ?? 'Album'}, ${album.coverKey ?? `covers/${id}.jpg`})`;
  });
  return id;
}

/** A row of either table, with Prisma-style field names. */
export interface ExampleRow {
  id: string;
  orgId: string;
  ownerUserId: string | null;
  ownerGroupId: string | null;
  title: string;
}

/** The Prisma `where` semantics the sharing helpers emit (AND, OR, equality, `in`), over plain rows. */
function matches(where: Record<string, unknown>, row: ExampleRow): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (key === 'AND') return (value as Array<Record<string, unknown>>).every((w) => matches(w, row));
    if (key === 'OR') return (value as Array<Record<string, unknown>>).some((w) => matches(w, row));
    if (value !== null && typeof value === 'object' && 'in' in value) return (value as { in: unknown[] }).in.includes(row[key as keyof ExampleRow]);
    return row[key as keyof ExampleRow] === value;
  });
}

/**
 * A stand-in for a Prisma model delegate (`tx.note`) over a test-only table,
 * which has no model: `findMany({ where })` reads the rows the transaction can
 * see (row-level security applies) and applies the `where` the sharing helpers
 * built. A real app passes `tx.note` itself.
 */
export function exampleDelegate(tx: unknown, table: 'sharing_test_docs' | 'sharing_test_albums') {
  const client = tx as { $queryRawUnsafe<T>(sql: string): Promise<T> };
  return {
    async findMany(args: { where: Record<string, unknown> }): Promise<ExampleRow[]> {
      const rows = await client.$queryRawUnsafe<ExampleRow[]>(
        `SELECT id::text AS "id", org_id::text AS "orgId", owner_user_id::text AS "ownerUserId", owner_group_id::text AS "ownerGroupId", title FROM ${table} ORDER BY title`,
      );
      return rows.filter((row) => matches(args.where, row));
    },
  };
}

/**
 * Creates `sharing_test_project_docs` (user-owned records that belong to a
 * project and can be frozen, with RLS) and `sharing_test_project_members` (no RLS), the
 * tables the access-rule examples read (PP-14.16).
 */
export async function createProjectTables(db: RlsDatabase): Promise<void> {
  for (const table of ['sharing_test_project_docs', 'sharing_test_project_members']) {
    if (table === 'sharing_test_project_docs') {
      await db.tenant.$executeRawUnsafe(`
        CREATE TABLE sharing_test_project_docs (
          id uuid PRIMARY KEY,
          org_id uuid NOT NULL REFERENCES organizations(id),
          owner_user_id uuid NOT NULL REFERENCES users(id),
          project_id uuid NULL,
          frozen_at timestamptz NULL,
          title text NOT NULL DEFAULT ''
        )`);
    } else {
      await db.tenant.$executeRawUnsafe(`
        CREATE TABLE sharing_test_project_members (
          org_id uuid NOT NULL REFERENCES organizations(id),
          project_id uuid NOT NULL,
          user_id uuid NOT NULL REFERENCES users(id),
          PRIMARY KEY (org_id, project_id, user_id)
        )`);
    }
    // The records table has row-level security. The MEMBERS table deliberately has NONE, like
    // most app tables: only the organization predicate in the rule's SQL keeps a membership of
    // another organization (the same project id) from counting, which is what the kit's
    // cross-organization fixtures and "broken rule" tests prove.
    if (table === 'sharing_test_project_members') continue;
    await db.tenant.$executeRawUnsafe(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
    await db.tenant.$executeRawUnsafe(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
    await db.tenant.$executeRawUnsafe(`
      CREATE POLICY "${table}_org_isolation" ON "${table}"
        USING      ("org_id" = NULLIF(current_setting('app.org_id', true), '')::uuid
                    OR current_setting('app.rls_bypass', true) = 'on')
        WITH CHECK ("org_id" = NULLIF(current_setting('app.org_id', true), '')::uuid
                    OR current_setting('app.rls_bypass', true) = 'on')`);
  }
}

/** Inserts one project document through the bypass (setup only). */
export async function insertProjectDoc(
  db: RlsDatabase,
  doc: { orgId: string; ownerUserId: string; projectId?: string | null; frozen?: boolean; title?: string },
): Promise<string> {
  const id = randomUUID();
  await db.system.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.rls_bypass', 'on', true)`;
    await tx.$executeRaw`
      INSERT INTO sharing_test_project_docs (id, org_id, owner_user_id, project_id, frozen_at, title)
      VALUES (${id}::uuid, ${doc.orgId}::uuid, ${doc.ownerUserId}::uuid, ${doc.projectId ?? null}::uuid,
              ${doc.frozen ? new Date('2026-01-01T00:00:00Z') : null}::timestamptz, ${doc.title ?? 'Doc'})`;
  });
  return id;
}

/** Adds a project membership through the bypass (setup only). */
export async function addProjectMember(db: RlsDatabase, member: { orgId: string; projectId: string; userId: string }): Promise<void> {
  await db.system.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.rls_bypass', 'on', true)`;
    await tx.$executeRaw`
      INSERT INTO sharing_test_project_members (org_id, project_id, user_id)
      VALUES (${member.orgId}::uuid, ${member.projectId}::uuid, ${member.userId}::uuid)`;
  });
}
