// =============================================================================
// The TEST-ONLY shareable resource of the grants db specs (issue #729)
// =============================================================================
//
// `sharing_test_docs (id, org_id, owner_user_id, owner_group_id, title)` is
// created by each spec's `beforeAll` on its throwaway database, owned by the
// application role, with ENABLE + FORCE ROW LEVEL SECURITY and the standard
// `<table>_org_isolation` policy copied from 0025/#725, and the resource type
// `sharing_test_doc` is registered against it. No production migration and
// no production code path knows either.
//
// NOT A `*.spec.ts` FILE, so Jest never runs it as a suite.
// =============================================================================

import { randomUUID } from 'node:crypto';

import { Prisma } from '@prisma/client';
import {
  registerResourceType,
  resourceTypeRegistry,
  type ResourceOwnerInfo,
  type ResourceTypeDef,
} from '@marinoscar/platform-api/sharing';

import type { RlsDatabase } from '../helpers/rls-database.helper';

export const TEST_DOC_TYPE = 'sharing_test_doc';

type Tx = RlsDatabase['tenant'];

/** Creates the table with its RLS policy (the 0025 template). */
export async function createTestDocsTable(db: RlsDatabase): Promise<void> {
  await db.tenant.$executeRawUnsafe(`
    CREATE TABLE sharing_test_docs (
      id uuid PRIMARY KEY,
      org_id uuid NOT NULL REFERENCES organizations(id),
      owner_user_id uuid NULL REFERENCES users(id),
      owner_group_id uuid NULL REFERENCES groups(id) ON DELETE RESTRICT,
      title text NOT NULL DEFAULT '',
      CHECK (num_nonnulls(owner_user_id, owner_group_id) = 1)
    )`);
  await db.tenant.$executeRawUnsafe('ALTER TABLE sharing_test_docs ENABLE ROW LEVEL SECURITY');
  await db.tenant.$executeRawUnsafe('ALTER TABLE sharing_test_docs FORCE ROW LEVEL SECURITY');
  await db.tenant.$executeRawUnsafe(`
    CREATE POLICY "sharing_test_docs_org_isolation" ON "sharing_test_docs"
      USING      ("org_id" = NULLIF(current_setting('app.org_id', true), '')::uuid
                  OR current_setting('app.rls_bypass', true) = 'on')
      WITH CHECK ("org_id" = NULLIF(current_setting('app.org_id', true), '')::uuid
                  OR current_setting('app.rls_bypass', true) = 'on')`);
}

/** The resource type over the table (kvox-shaped, group-ownable). */
export function testDocType(overrides: Partial<ResourceTypeDef<'viewer' | 'editor'>> = {}): ResourceTypeDef<'viewer' | 'editor'> {
  return {
    type: TEST_DOC_TYPE,
    roles: ['viewer', 'editor'],
    actions: { read: 'viewer', write: 'editor', share: 'owner', delete: 'owner' },
    actionPermissions: { write: 'test_docs:write' },
    ownership: 'user_or_group',
    async loadOwners(ids, tx) {
      if (ids.length === 0) return new Map();
      const rows = await (tx as Tx).$queryRaw<Array<{ id: string; org_id: string; owner_user_id: string | null; owner_group_id: string | null }>>`
        SELECT id::text, org_id::text, owner_user_id::text, owner_group_id::text
        FROM sharing_test_docs WHERE id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})`;
      return new Map<string, ResourceOwnerInfo>(
        rows.map((row) => [
          row.id,
          {
            orgId: row.org_id,
            owner: row.owner_group_id ? { kind: 'group', groupId: row.owner_group_id } : { kind: 'user', userId: row.owner_user_id! },
          },
        ]),
      );
    },
    async countOwnedByGroup(groupId, tx) {
      const rows = await (tx as Tx).$queryRaw<Array<{ n: number }>>`SELECT count(*)::int AS n FROM sharing_test_docs WHERE owner_group_id = ${groupId}::uuid`;
      return rows[0]?.n ?? 0;
    },
    async describe(ids, tx) {
      const rows = await (tx as Tx).$queryRaw<Array<{ id: string; title: string }>>`
        SELECT id::text, title FROM sharing_test_docs WHERE id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})`;
      return new Map(rows.map((row) => [row.id, { title: row.title, path: `/docs/${row.id}` }]));
    },
    ...overrides,
  };
}

/** Registers the type once per test file (each Jest file has its own module registry). */
export function registerTestDocType(def: ResourceTypeDef<'viewer' | 'editor'> = testDocType()): void {
  if (!resourceTypeRegistry.has(def.type)) registerResourceType(def);
}

/** Inserts one record through the bypass (setup only). */
export async function insertDoc(db: RlsDatabase, doc: { orgId: string; ownerUserId?: string; ownerGroupId?: string; title?: string }): Promise<string> {
  const id = randomUUID();
  await db.system.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.rls_bypass', 'on', true)`;
    await tx.$executeRaw`
      INSERT INTO sharing_test_docs (id, org_id, owner_user_id, owner_group_id, title)
      VALUES (${id}::uuid, ${doc.orgId}::uuid, ${doc.ownerUserId ?? null}::uuid, ${doc.ownerGroupId ?? null}::uuid, ${doc.title ?? 'Doc'})`;
  });
  return id;
}

/** Runs `fn` on the bypass client (setup and ground-truth reads). */
export async function asSystem<T>(db: RlsDatabase, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return db.system.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.rls_bypass', 'on', true)`;
    return fn(tx);
  });
}

/** Runs `fn` scoped to one organization (what `runInOrg` does). */
export async function inOrg<T>(db: RlsDatabase, orgId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return db.tenant.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.org_id', ${orgId}, true)`;
    return fn(tx);
  });
}
