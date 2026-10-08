// =============================================================================
// Real Postgres: grants, AccessPolicy and the "resources I can see" helpers
// (issue #729, PP-7.2)
// =============================================================================
//
// The sharing services exactly as the app wires them, on a throwaway database
// owned by an ordinary role (row-level security applies), against the
// TEST-ONLY table `sharing_test_docs` (./sharing-test-docs.helper.ts):
//
//   - the grantee CHECK constraint and both partial unique indexes, and
//     concurrent re-grants that leave ONE active grant (the index decides);
//   - RLS isolation of grants and the composite group key, and cross-org
//     grantees refused with 422;
//   - the decision matrix on real rows (expired and revoked grants included),
//     the same 404 for a denial and a missing record, revocation effective on
//     the next request, and `decideMany` for 100 records in at most 3 queries;
//   - `accessibleWhere` and `accessibleSql` returning exactly the visible rows
//     per scope, the EXISTS form above the threshold with the same results;
//   - `sharing.shared_with_you` on create and on a role change only.
// =============================================================================

import { randomUUID } from 'node:crypto';

import { Prisma } from '@prisma/client';
import type { Principal } from '@marinoscar/platform-api/core';
import { accessibleSql, accessibleWhere, sharedResourceIds, type SharingDataPort } from '@marinoscar/platform-api/sharing';
import type { AccessScope } from '@marinoscar/platform-contract/sharing';

import { resolveDbSuite } from '../jobs/db-test-support';
import { createRlsDatabase, ORG_A, ORG_B, type RlsDatabase } from '../helpers/rls-database.helper';
import { principalOf, seedOrgs, seedUser, sharingServices, type SharingDb } from './sharing-db.helper';
import { TEST_DOC_TYPE, asSystem, createTestDocsTable, inOrg, insertDoc, registerTestDocType } from './sharing-test-docs.helper';

const { describeWithDb } = resolveDbSuite('grants.db.spec');

/** Counts every statement a unit of work runs while `counting.on` (the scope statement included). */
const counting = { on: false, queries: 0 };
function countQueries(inner: SharingDataPort): SharingDataPort {
  const wrap = (tx: unknown): unknown =>
    new Proxy(tx as object, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver) as unknown;
        if (typeof prop !== 'string') return value;
        if (typeof value === 'function' && prop.startsWith('$')) {
          return (...args: unknown[]) => {
            counting.queries += 1;
            return (value as (...a: unknown[]) => unknown).apply(target, args);
          };
        }
        if (value && typeof value === 'object' && !prop.startsWith('$') && !prop.startsWith('_')) {
          return new Proxy(value, {
            get(delegate, method) {
              const fn = Reflect.get(delegate, method) as unknown;
              if (typeof fn !== 'function') return fn;
              return (...args: unknown[]) => {
                counting.queries += 1;
                return (fn as (...a: unknown[]) => unknown).apply(delegate, args);
              };
            },
          });
        }
        return value;
      },
    });
  return {
    runInOrg: (scope, fn) => {
      if (!counting.on) return inner.runInOrg(scope, fn);
      counting.queries += 1; // the transaction-local set_config(app.org_id)
      return inner.runInOrg(scope, (tx) => fn(wrap(tx)));
    },
    runAsSystem: (reason, fn) => inner.runAsSystem(reason, fn),
  };
}

/** The Prisma `where` semantics the helpers emit (AND, OR, equality, `in`), over plain rows. */
type DocRow = { id: string; orgId: string; ownerUserId: string | null; ownerGroupId: string | null };
function matches(where: Record<string, unknown>, row: DocRow): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (key === 'AND') return (value as Record<string, unknown>[]).every((w) => matches(w, row));
    if (key === 'OR') return (value as Record<string, unknown>[]).some((w) => matches(w, row));
    if (value !== null && typeof value === 'object' && 'in' in value) return ((value as { in: unknown[] }).in).includes(row[key as keyof DocRow]);
    return row[key as keyof DocRow] === value;
  });
}

async function status(promise: Promise<unknown>): Promise<{ status: number; body: unknown }> {
  try {
    await promise;
  } catch (error) {
    const http = error as { getStatus(): number; getResponse(): unknown };
    return { status: http.getStatus(), body: http.getResponse() };
  }
  throw new Error('expected a refusal');
}

describeWithDb('grants (real Postgres)', () => {
  let db: RlsDatabase;
  let sharing: SharingDb;
  const u: Record<'alice' | 'bob' | 'carol' | 'erin' | 'dave', string> = { alice: '', bob: '', carol: '', erin: '', dave: '' };
  const docs: Record<string, string> = {};
  const groups: Record<'g1' | 'g2' | 'g3' | 'foreign', string> = { g1: '', g2: '', g3: '', foreign: '' };

  // A NEW principal object per call: one call = one request.
  const as = (name: keyof typeof u, extra: string[] = []): Principal => {
    const base = principalOf(u[name], `${name}@example.test`, name === 'dave' ? ORG_B : ORG_A, 'contributor');
    return { ...base, permissions: [...base.permissions, ...extra] };
  };
  const doc = (key: string) => ({ type: TEST_DOC_TYPE, id: docs[key]! });

  beforeAll(async () => {
    db = await createRlsDatabase('grants');
    await seedOrgs(db, [
      [ORG_A, 'org-a'],
      [ORG_B, 'org-b'],
    ]);
    for (const name of ['alice', 'bob', 'carol', 'erin'] as const) u[name] = await seedUser(db, `${name}@example.test`, [ORG_A]);
    u.dave = await seedUser(db, 'dave@example.test', [ORG_B]);
    await createTestDocsTable(db);
    registerTestDocType();
    sharing = await sharingServices(db, 'single', { wrapData: countQueries });

    // Groups: Alice is a viewer of g1 and the admin of g2; g3 is Bob's alone; `foreign` lives in ORG_B.
    groups.g1 = (await sharing.groups.create(as('bob'), { name: 'g1' })).id;
    await sharing.members.add(as('bob'), groups.g1, { userId: u.alice, role: 'viewer' });
    groups.g2 = (await sharing.groups.create(as('alice'), { name: 'g2' })).id;
    groups.g3 = (await sharing.groups.create(as('bob'), { name: 'g3' })).id;
    groups.foreign = (await sharing.groups.create(as('dave'), { name: 'foreign' })).id;

    docs.d1 = await insertDoc(db, { orgId: ORG_A, ownerUserId: u.alice, title: 'mine' });
    docs.d2 = await insertDoc(db, { orgId: ORG_A, ownerUserId: u.bob, title: 'shared with me' });
    docs.d3 = await insertDoc(db, { orgId: ORG_A, ownerUserId: u.bob, title: 'shared with g1' });
    docs.d4 = await insertDoc(db, { orgId: ORG_A, ownerGroupId: groups.g2, title: 'owned by g2' });
    docs.d5 = await insertDoc(db, { orgId: ORG_A, ownerUserId: u.bob, title: 'private' });
    docs.d6 = await insertDoc(db, { orgId: ORG_A, ownerUserId: u.bob, title: 'revoked' });
    docs.d7 = await insertDoc(db, { orgId: ORG_A, ownerUserId: u.bob, title: 'expired' });
    docs.d8 = await insertDoc(db, { orgId: ORG_A, ownerGroupId: groups.g3, title: 'owned by g3' });
    docs.d9 = await insertDoc(db, { orgId: ORG_B, ownerUserId: u.dave, title: 'other org' });
    docs.d10 = await insertDoc(db, { orgId: ORG_A, ownerGroupId: groups.g1, title: 'owned by g1' });

    await sharing.grants.create(as('bob'), { resourceType: TEST_DOC_TYPE, resourceId: docs.d2, role: 'viewer', grantee: { kind: 'user', userId: u.alice } });
    await sharing.grants.create(as('bob'), { resourceType: TEST_DOC_TYPE, resourceId: docs.d3, role: 'editor', grantee: { kind: 'group', groupId: groups.g1 } });
    await sharing.grants.create(as('bob'), { resourceType: TEST_DOC_TYPE, resourceId: docs.d3, role: 'viewer', grantee: { kind: 'user', userId: u.alice } });
    const revoked = await sharing.grants.create(as('bob'), { resourceType: TEST_DOC_TYPE, resourceId: docs.d6, role: 'editor', grantee: { kind: 'user', userId: u.alice } });
    await sharing.grants.revoke(as('bob'), revoked.id);
    const expired = await sharing.grants.create(as('bob'), {
      resourceType: TEST_DOC_TYPE,
      resourceId: docs.d7,
      role: 'editor',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      grantee: { kind: 'user', userId: u.alice },
    });
    await asSystem(db, (tx) => tx.$executeRaw`UPDATE grants SET expires_at = now() - interval '1 minute' WHERE id = ${expired.id}::uuid`);
    // A grant of ORG_B naming Alice (only the bypass can write it): RLS must hide it from ORG_A.
    await asSystem(db, (tx) =>
      tx.$executeRaw`INSERT INTO grants (id, org_id, resource_type, resource_id, grantee_kind, grantee_user_id, role, created_at, updated_at)
                     VALUES (gen_random_uuid(), ${ORG_B}::uuid, ${TEST_DOC_TYPE}, ${docs.d9}::uuid, 'user', ${u.alice}::uuid, 'editor', now(), now())`,
    );
  }, 240_000);

  afterAll(async () => {
    await sharing?.close();
    await db?.destroy();
  }, 60_000);

  describe('the schema', () => {
    const insert = (kind: string, cols: { user?: string | null; group?: string | null; hash?: string | null }) =>
      asSystem(db, (tx) =>
        tx.$executeRaw`INSERT INTO grants (id, org_id, resource_type, resource_id, grantee_kind, grantee_user_id, grantee_group_id, link_token_hash, role, created_at, updated_at)
                       VALUES (gen_random_uuid(), ${ORG_A}::uuid, ${TEST_DOC_TYPE}, ${docs.d5}::uuid, ${kind}::"GrantGranteeKind", ${cols.user ?? null}::uuid,
                               ${cols.group ?? null}::uuid, ${cols.hash ?? null}, 'viewer', now(), now())`,
      );

    it('keeps the grantee columns consistent with grantee_kind (CHECK)', async () => {
      await expect(insert('user', { user: u.carol, group: groups.g1 })).rejects.toThrow(/grants_grantee_consistency_check/);
      await expect(insert('user', {})).rejects.toThrow(/grants_grantee_consistency_check/);
      await expect(insert('group', { user: u.carol })).rejects.toThrow(/grants_grantee_consistency_check/);
      await expect(insert('link', {})).rejects.toThrow(/grants_grantee_consistency_check/);
      await expect(insert('link', { user: u.carol, hash: `h-${randomUUID()}` })).rejects.toThrow(/grants_grantee_consistency_check/);
      await expect(insert('user', { user: u.carol, hash: `h-${randomUUID()}` })).rejects.toThrow(/grants_grantee_consistency_check/);
      await expect(insert('link', { hash: `h-${randomUUID()}` })).resolves.toBe(1);
    });

    it('allows one ACTIVE grant per resource and user or group (partial unique indexes); a revoked one does not block', async () => {
      const dup = docs.d5;
      await expect(insert('user', { user: u.erin })).resolves.toBe(1);
      await expect(insert('user', { user: u.erin })).rejects.toThrow(/grants_active_user_uniq_idx/);
      await asSystem(db, (tx) => tx.$executeRaw`UPDATE grants SET revoked_at = now() WHERE resource_id = ${dup}::uuid AND grantee_user_id = ${u.erin}::uuid`);
      await expect(insert('user', { user: u.erin })).resolves.toBe(1);
      await expect(insert('group', { group: groups.g3 })).resolves.toBe(1);
      await expect(insert('group', { group: groups.g3 })).rejects.toThrow(/grants_active_group_uniq_idx/);
      await asSystem(db, (tx) => tx.$executeRaw`DELETE FROM grants WHERE resource_id = ${dup}::uuid`);
    });

    it('cannot point a grant at another organization\'s group (composite key, beneath RLS)', async () => {
      await expect(
        asSystem(db, (tx) =>
          tx.$executeRaw`INSERT INTO grants (id, org_id, resource_type, resource_id, grantee_kind, grantee_group_id, role, created_at, updated_at)
                         VALUES (gen_random_uuid(), ${ORG_A}::uuid, ${TEST_DOC_TYPE}, ${docs.d5}::uuid, 'group', ${groups.foreign}::uuid, 'viewer', now(), now())`,
        ),
      ).rejects.toThrow(/grants_grantee_group_id_org_id_fkey/);
    });
  });

  describe('the grants API', () => {
    it('re-granting upserts: concurrent grants of one user leave exactly one active row', async () => {
      const target = await insertDoc(db, { orgId: ORG_A, ownerUserId: u.bob, title: 'race' });
      const roles = ['viewer', 'editor', 'viewer', 'editor', 'viewer', 'editor', 'viewer', 'editor'];
      const results = await Promise.allSettled(
        roles.map((role) => sharing.grants.create(as('bob'), { resourceType: TEST_DOC_TYPE, resourceId: target, role, grantee: { kind: 'user', userId: u.carol } })),
      );
      expect(results.filter((r) => r.status === 'rejected')).toEqual([]);
      const active = await asSystem(db, (tx) => tx.grant.findMany({ where: { resourceId: target, revokedAt: null } }));
      expect(active).toHaveLength(1);
      expect(new Set(results.map((r) => (r as PromiseFulfilledResult<{ id: string }>).value.id))).toEqual(new Set([active[0]!.id]));
    });

    it('notifies the user once on create and once on a role change, never on an unchanged re-grant', async () => {
      const target = await insertDoc(db, { orgId: ORG_A, ownerUserId: u.bob, title: 'Quarterly <notes>' });
      const mine = () => sharing.notifications.filter((n) => n.key === 'sharing.shared_with_you' && (n.data as { resourceId: string }).resourceId === target);
      const share = (role: string) => sharing.grants.create(as('bob'), { resourceType: TEST_DOC_TYPE, resourceId: target, role, grantee: { kind: 'user', userId: u.carol } });

      const first = await share('viewer');
      expect(mine()).toHaveLength(1);
      expect(mine()[0]).toMatchObject({ to: u.carol, data: { role: 'viewer', title: 'Quarterly <notes>', path: `/docs/${target}`, sharedBy: 'bob@example.test' } });
      expect(await share('viewer')).toMatchObject({ id: first.id, role: 'viewer' });
      expect(mine()).toHaveLength(1);
      await share('editor');
      expect(mine()).toHaveLength(2);
      expect(mine()[1]!.data).toMatchObject({ role: 'editor', previousRole: 'viewer' });
      // A group grant notifies nobody.
      const before = sharing.notifications.length;
      await sharing.grants.create(as('bob'), { resourceType: TEST_DOC_TYPE, resourceId: target, role: 'viewer', grantee: { kind: 'group', groupId: groups.g3 } });
      expect(sharing.notifications).toHaveLength(before);
      const events = sharing.events.filter((e) => (e.payload as { resourceId?: string }).resourceId === target).map((e) => e.name);
      expect(events).toEqual(['sharing.grant.created', 'sharing.grant.updated', 'sharing.grant.created']);
    });

    it('refuses a grantee of another organization with 422 (user and group)', async () => {
      const user = await status(sharing.grants.create(as('bob'), { resourceType: TEST_DOC_TYPE, resourceId: docs.d5, role: 'viewer', grantee: { kind: 'user', userId: u.dave } }));
      expect(user).toMatchObject({ status: 422, body: { details: { reason: 'NOT_AN_ORG_MEMBER' } } });
      const group = await status(sharing.grants.create(as('bob'), { resourceType: TEST_DOC_TYPE, resourceId: docs.d5, role: 'viewer', grantee: { kind: 'group', groupId: groups.foreign } }));
      expect(group).toMatchObject({ status: 422, body: { details: { reason: 'GROUP_NOT_IN_ORG' } } });
    });

    it("hides another organization's grants (RLS), and lists what is shared with me with describe() labels", async () => {
      const seenFromA = await inOrg(db, ORG_A, (tx) => tx.grant.count({ where: { orgId: ORG_B } }));
      const ground = await asSystem(db, (tx) => tx.grant.count({ where: { orgId: ORG_B } }));
      expect([seenFromA, ground]).toEqual([0, 1]);
      const unscoped = await db.tenant.grant.count();
      expect(unscoped).toBe(0);

      const list = await sharing.grants.sharedWithMe(as('alice'), { page: 1, pageSize: 100, resourceType: TEST_DOC_TYPE });
      const shared = list.items.map((item) => [item.resourceId, item.via, item.title]);
      expect(shared).toEqual(
        expect.arrayContaining([
          [docs.d2, 'user_grant', 'shared with me'],
          [docs.d3, 'group_grant', 'shared with g1'],
          [docs.d3, 'user_grant', 'shared with g1'],
        ]),
      );
      const ids = list.items.map((item) => item.resourceId);
      for (const hidden of [docs.d6, docs.d7, docs.d9]) expect(ids).not.toContain(hidden);
    });

    it('lists a record\'s grants for its sharer only (others get the same 404 as a missing record)', async () => {
      const page = await sharing.grants.list(as('bob'), { resourceType: TEST_DOC_TYPE, resourceId: docs.d3, page: 1, pageSize: 20 });
      expect(page.items.map((g) => [g.grantee.kind, g.role])).toEqual(expect.arrayContaining([['group', 'editor'], ['user', 'viewer']]));
      const denied = await status(sharing.grants.list(as('alice'), { resourceType: TEST_DOC_TYPE, resourceId: docs.d3, page: 1, pageSize: 20 }));
      const missing = await status(sharing.grants.list(as('alice'), { resourceType: TEST_DOC_TYPE, resourceId: randomUUID(), page: 1, pageSize: 20 }));
      expect(denied.status).toBe(404);
      expect(denied).toEqual(missing);
    });
  });

  describe('AccessPolicy on real rows', () => {
    const W = ['test_docs:write'];
    const cases: Array<[string, string, string, boolean, string | null]> = [
      ['owner', 'd1', 'share', true, 'owner'],
      ['user grant viewer: read', 'd2', 'read', true, 'user_grant'],
      ['user grant viewer: no write', 'd2', 'write', false, null],
      ['group grant editor beats my user grant viewer (max)', 'd3', 'write', true, 'group_grant'],
      ['group owner as group admin', 'd4', 'share', true, 'group_owner'],
      ['group owner as group viewer: read', 'd10', 'read', true, 'group_owner'],
      ['group owner as group viewer: no write', 'd10', 'write', false, null],
      ['not shared', 'd5', 'read', false, null],
      ['revoked grant', 'd6', 'read', false, null],
      ['expired grant', 'd7', 'read', false, null],
      ["a group I am not in", 'd8', 'read', false, null],
      ['another organization (even with a grant there)', 'd9', 'read', false, null],
    ];
    for (const [name, key, action, allowed, via] of cases) {
      it(name, async () => {
        const decision = await sharing.access.decide(as('alice', W), action, doc(key));
        expect([decision.allowed, decision.via]).toEqual([allowed, via]);
      });
    }

    it('answers 403 naming the permission when the action needs one, even for the owner', async () => {
      expect(await status(sharing.access.require(as('alice'), 'write', doc('d1')))).toMatchObject({ status: 403, body: { details: { permission: 'test_docs:write' } } });
    });

    it('answers every denial with the same 404 as a missing record', async () => {
      const bodies = await Promise.all(['d5', 'd6', 'd7', 'd8', 'd9'].map((key) => status(sharing.access.require(as('alice'), 'read', doc(key)))));
      const missing = await status(sharing.access.require(as('alice'), 'read', { type: TEST_DOC_TYPE, id: randomUUID() }));
      for (const body of bodies) expect(body).toEqual(missing);
      expect(missing.status).toBe(404);
    });

    it('a revocation takes effect on the very next request, with no cache to invalidate', async () => {
      const target = await insertDoc(db, { orgId: ORG_A, ownerUserId: u.bob, title: 'revoke me' });
      const grant = await sharing.grants.create(as('bob'), { resourceType: TEST_DOC_TYPE, resourceId: target, role: 'viewer', grantee: { kind: 'user', userId: u.erin } });
      expect(await sharing.access.can(as('erin'), 'read', { type: TEST_DOC_TYPE, id: target })).toBe(true);
      await sharing.grants.revoke(as('bob'), grant.id);
      expect(await sharing.access.can(as('erin'), 'read', { type: TEST_DOC_TYPE, id: target })).toBe(false);
      const row = await asSystem(db, (tx) => tx.grant.findUnique({ where: { id: grant.id } }));
      expect(row).toMatchObject({ revokedById: u.bob });
      expect(row!.revokedAt).toBeInstanceOf(Date);
    });

    it('decideMany for 100 records issues at most 3 queries', async () => {
      const ids = await asSystem(db, (tx) =>
        tx.$queryRaw<Array<{ id: string }>>`INSERT INTO sharing_test_docs (id, org_id, owner_user_id, title)
                                            SELECT gen_random_uuid(), ${ORG_A}::uuid, ${u.bob}::uuid, 'batch' FROM generate_series(1, 100) RETURNING id::text`,
      );
      const me = await sharing.principalGroups.enrich(as('alice'));
      counting.queries = 0;
      counting.on = true;
      try {
        const decisions = await sharing.access.decideMany(me, 'read', ids.map((row) => ({ type: TEST_DOC_TYPE, id: row.id })));
        expect(decisions.size).toBe(100);
      } finally {
        counting.on = false;
      }
      expect(counting.queries).toBeLessThanOrEqual(3);
    });
  });

  describe('accessibleWhere and accessibleSql', () => {
    const expected: Record<AccessScope, string[]> = { owned: ['d1'], groups: ['d4', 'd10'], shared: ['d2', 'd3'], all: ['d1', 'd2', 'd3', 'd4', 'd10'] };
    const fixture = () => ['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'd8', 'd10'].map((key) => docs[key]!);
    const nameOf = (id: string) => Object.entries(docs).find(([, v]) => v === id)?.[0];

    async function rowsInOrgA(): Promise<DocRow[]> {
      const rows = await inOrg(db, ORG_A, (tx) =>
        tx.$queryRaw<Array<{ id: string; org_id: string; owner_user_id: string | null; owner_group_id: string | null }>>`
          SELECT id::text, org_id::text, owner_user_id::text, owner_group_id::text FROM sharing_test_docs`,
      );
      return rows.map((r) => ({ id: r.id, orgId: r.org_id, ownerUserId: r.owner_user_id, ownerGroupId: r.owner_group_id }));
    }

    async function viaSql(me: Principal, scope: AccessScope, minRole?: string): Promise<string[]> {
      const condition = accessibleSql(me, TEST_DOC_TYPE, 'r', { sqlKit: Prisma, scope, ...(minRole ? { minRole } : {}) });
      const rows = await inOrg(db, ORG_A, (tx) => tx.$queryRaw<Array<{ id: string }>>`SELECT r.id::text AS id FROM sharing_test_docs r WHERE ${condition}`);
      return rows.map((row) => row.id);
    }

    for (const scope of ['owned', 'groups', 'shared', 'all'] as const) {
      it(`${scope}: both forms return exactly the visible rows`, async () => {
        const me = await sharing.principalGroups.enrich(as('alice'));
        const rows = (await rowsInOrgA()).filter((row) => fixture().includes(row.id));
        const access = await inOrg(db, ORG_A, (tx) => accessibleWhere(me, TEST_DOC_TYPE, { tx, sqlKit: Prisma, scope }));
        expect(access.form).toBe('where');
        const byWhere = rows.filter((row) => access.form === 'where' && matches(access.where, row)).map((row) => nameOf(row.id)).sort();
        const bySql = (await viaSql(me, scope)).filter((id) => fixture().includes(id)).map(nameOf).sort();
        expect(byWhere).toEqual([...expected[scope]].sort());
        expect(bySql).toEqual(byWhere);
      });
    }

    it('minRole editor keeps only what reaches editor (owner, group admin, the g1 editor grant)', async () => {
      const me = await sharing.principalGroups.enrich(as('alice'));
      const bySql = (await viaSql(me, 'all', 'editor')).filter((id) => fixture().includes(id)).map(nameOf).sort();
      expect(bySql).toEqual(['d1', 'd3', 'd4']);
    });

    it('switches to the EXISTS form above the threshold, with the same rows', async () => {
      const me = await sharing.principalGroups.enrich(as('alice'));
      const inline = await inOrg(db, ORG_A, (tx) => accessibleWhere(me, TEST_DOC_TYPE, { tx, sqlKit: Prisma, scope: 'shared' }));
      const switched = await inOrg(db, ORG_A, (tx) => accessibleWhere(me, TEST_DOC_TYPE, { tx, sqlKit: Prisma, scope: 'shared', inlineLimit: 1 }));
      expect([inline.form, switched.form]).toEqual(['where', 'exists']);
      if (switched.form !== 'exists' || inline.form !== 'where') return;
      const rows = await inOrg(db, ORG_A, (tx) => tx.$queryRaw<Array<{ id: string }>>`SELECT r.id::text AS id FROM sharing_test_docs r WHERE ${switched.sql}`);
      const byWhere = (await rowsInOrgA()).filter((row) => matches(inline.where, row)).map((row) => row.id);
      expect(rows.map((row) => row.id).sort()).toEqual(byWhere.sort());
    });

    it('at the real threshold: 1,001 shared records come back in the EXISTS form, all of them', async () => {
      await asSystem(db, (tx) =>
        tx.$executeRaw`WITH d AS (
                         INSERT INTO sharing_test_docs (id, org_id, owner_user_id, title)
                         SELECT gen_random_uuid(), ${ORG_A}::uuid, ${u.bob}::uuid, 'bulk' FROM generate_series(1, 1001) RETURNING id)
                       INSERT INTO grants (id, org_id, resource_type, resource_id, grantee_kind, grantee_user_id, role, created_at, updated_at)
                       SELECT gen_random_uuid(), ${ORG_A}::uuid, ${TEST_DOC_TYPE}, d.id, 'user', ${u.carol}::uuid, 'viewer', now(), now() FROM d`,
      );
      const me = await sharing.principalGroups.enrich(as('carol'));
      const access = await inOrg(db, ORG_A, (tx) => accessibleWhere(me, TEST_DOC_TYPE, { tx, sqlKit: Prisma, scope: 'shared' }));
      expect(access.form).toBe('exists');
      if (access.form !== 'exists') return;
      const rows = await inOrg(db, ORG_A, (tx) =>
        tx.$queryRaw<Array<{ n: number }>>`SELECT count(*)::int AS n FROM sharing_test_docs r WHERE ${access.sql} AND r.title = 'bulk'`,
      );
      expect(rows[0]!.n).toBe(1001);
      const bounded = await inOrg(db, ORG_A, (tx) => sharedResourceIds(me, TEST_DOC_TYPE, { tx, limit: 10 }));
      expect(bounded).toHaveLength(10);
    });
  });
});
