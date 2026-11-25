// The "resources I can see" helpers (issue #729): the Prisma fragment per
// AccessScope, the switch to the EXISTS form above the threshold, the SQL
// shape, and the bounded id list. The same scopes against real rows (and the
// parity of the two forms) are apps/api/test/sharing/grants.db.spec.ts.

import type { Principal } from '../../src/core/index';
import { SHARED_IDS_INLINE_LIMIT, accessibleSql, accessibleWhere, sharedResourceIds } from '../../src/sharing/index';
import { ALICE, GROUP, ORG, fakeTx, principal } from './fakes';
import { DOC_A, DOC_B, GROUP_2, docType, withTypes } from './grants-fakes';
import { fakeSqlKit as sqlKit } from './sql-kit';

function me(groups: Array<[string, 'admin' | 'editor' | 'viewer']> = []): Principal {
  return principal({ groups: groups.map(([groupId, role]) => ({ groupId, orgId: ORG, role })) });
}

const def = () => docType(new Map());

describe('accessibleWhere', () => {
  it('owned: my rows of my organization, with no query', async () => {
    const tx = fakeTx();
    await withTypes([def()], async () => {
      expect(await accessibleWhere(me(), 'test_doc', { tx, sqlKit, scope: 'owned' })).toEqual({
        form: 'where',
        where: { AND: [{ orgId: ORG }, { ownerUserId: ALICE }] },
      });
      expect(tx.grant.groupBy).not.toHaveBeenCalled();
    });
  });

  it('groups: rows owned by my groups whose role reaches minRole', async () => {
    const tx = fakeTx();
    await withTypes([def()], async () => {
      const who = me([[GROUP, 'viewer'], [GROUP_2, 'admin']]);
      expect((await accessibleWhere(who, 'test_doc', { tx, sqlKit, scope: 'groups' })).form).toBe('where');
      expect(await accessibleWhere(who, 'test_doc', { tx, sqlKit, scope: 'groups' })).toMatchObject({
        where: { AND: [{ orgId: ORG }, { ownerGroupId: { in: [GROUP, GROUP_2] } }] },
      });
      expect(await accessibleWhere(who, 'test_doc', { tx, sqlKit, scope: 'groups', minRole: 'editor' })).toMatchObject({
        where: { AND: [{ orgId: ORG }, { ownerGroupId: { in: [GROUP_2] } }] },
      });
      // No group at all: nothing.
      expect(await accessibleWhere(me(), 'test_doc', { tx, sqlKit, scope: 'groups' })).toEqual({ form: 'where', where: { id: { in: [] } } });
    });
  });

  it('shared: ONE bounded GROUP BY on active, unexpired grants with the roles at or above minRole', async () => {
    const tx = fakeTx();
    tx.grant.groupBy.mockResolvedValue([{ resourceId: DOC_A }, { resourceId: DOC_B }]);
    await withTypes([def()], async () => {
      expect(await accessibleWhere(me([[GROUP, 'viewer']]), 'test_doc', { tx, sqlKit, scope: 'shared', minRole: 'editor' })).toEqual({
        form: 'where',
        where: { AND: [{ orgId: ORG }, { id: { in: [DOC_A, DOC_B] } }] },
      });
      const args = tx.grant.groupBy.mock.calls[0]![0];
      expect(args).toMatchObject({ by: ['resourceId'], take: SHARED_IDS_INLINE_LIMIT + 1, orderBy: { resourceId: 'asc' } });
      expect(args.where).toMatchObject({ orgId: ORG, resourceType: 'test_doc', revokedAt: null, role: { in: ['editor'] } });
      expect(args.where.AND[1]).toEqual({
        OR: [{ granteeKind: 'user', granteeUserId: ALICE }, { granteeKind: 'group', granteeGroupId: { in: [GROUP] } }],
      });
    });
  });

  it('all: the union of owned, groups and shared, inside my organization', async () => {
    const tx = fakeTx();
    tx.grant.groupBy.mockResolvedValue([{ resourceId: DOC_A }]);
    await withTypes([def()], async () => {
      expect(await accessibleWhere(me([[GROUP, 'viewer']]), 'test_doc', { tx, sqlKit })).toEqual({
        form: 'where',
        where: { AND: [{ orgId: ORG }, { OR: [{ ownerUserId: ALICE }, { ownerGroupId: { in: [GROUP] } }, { id: { in: [DOC_A] } }] }] },
      });
    });
  });

  it("shared with an 'org' default: every record of my organization, with no grant query", async () => {
    const tx = fakeTx();
    await withTypes([docType(new Map(), { defaultVisibility: 'org', orgRole: 'viewer' })], async () => {
      expect(await accessibleWhere(me(), 'test_doc', { tx, sqlKit, scope: 'shared' })).toEqual({ form: 'where', where: { orgId: ORG } });
      expect(tx.grant.groupBy).not.toHaveBeenCalled();
      // The default does not reach editor: back to grants.
      await accessibleWhere(me(), 'test_doc', { tx, sqlKit, scope: 'shared', minRole: 'editor' });
      expect(tx.grant.groupBy).toHaveBeenCalledTimes(1);
    });
  });

  it('switches to the EXISTS form above the threshold instead of inlining the ids', async () => {
    const tx = fakeTx();
    tx.grant.groupBy.mockResolvedValue([{ resourceId: DOC_A }, { resourceId: DOC_B }, { resourceId: GROUP }]);
    await withTypes([def()], async () => {
      const result = await accessibleWhere(me(), 'test_doc', { tx, sqlKit, scope: 'shared', inlineLimit: 2, sql: { alias: 'd' } });
      expect(result.form).toBe('exists');
      if (result.form !== 'exists') return;
      expect(result.sql.text).toContain('EXISTS (');
      expect(result.sql.text).toContain('"d"."id"');
    });
  });

  it('uses the given fields, can leave the organization to RLS, and refuses a non-identifier field', async () => {
    const tx = fakeTx();
    await withTypes([def()], async () => {
      expect(await accessibleWhere(me(), 'test_doc', { tx, sqlKit, scope: 'owned', ownerUserField: 'authorId', orgField: null })).toEqual({
        form: 'where',
        where: { authorId: ALICE },
      });
      await expect(accessibleWhere(me(), 'test_doc', { tx, sqlKit, ownerUserField: 'a.b' })).rejects.toThrow(/plain identifier/);
      await expect(accessibleWhere(me(), 'test_doc', { tx, sqlKit, minRole: 'boss' })).rejects.toThrow(/no role "boss"/);
      await expect(accessibleWhere(me(), 'nope', { tx, sqlKit })).rejects.toThrow(/Unknown resource type/);
    });
  });

  it('matches nothing without an active organization', async () => {
    const tx = fakeTx();
    await withTypes([def()], async () => {
      expect(await accessibleWhere(principal({ activeOrgId: undefined }), 'test_doc', { tx, sqlKit })).toEqual({ form: 'where', where: { id: { in: [] } } });
    });
  });
});

describe('accessibleSql', () => {
  it('builds one parameterised condition with an EXISTS on grants', async () => {
    await withTypes([def()], () => {
      const sql = accessibleSql(me([[GROUP, 'editor']]), 'test_doc', 'r', { sqlKit, minRole: 'viewer' });
      expect(sql.text).toMatch(/^\("r"\."org_id" = \$1::uuid AND \(/);
      expect(sql.text).toContain('"r"."owner_user_id" = $2::uuid');
      expect(sql.text).toContain('"r"."owner_group_id" IN ($3::uuid)');
      expect(sql.text).toContain('EXISTS (');
      expect(sql.text).toContain('g.resource_id = "r"."id"');
      expect(sql.text).toContain('g.revoked_at IS NULL');
      expect(sql.text).toContain('(g.expires_at IS NULL OR g.expires_at > now())');
      expect(sql.values).toEqual([ORG, ALICE, GROUP, ORG, 'test_doc', 'viewer', 'editor', ALICE, GROUP]);
      // No value is ever spliced into the text.
      expect(sql.text).not.toContain(ALICE);
    });
  });

  it('per scope, and only the owner columns the ownership has', async () => {
    await withTypes([def(), docType(new Map(), { type: 'note', ownership: 'user', countOwnedByGroup: undefined })], () => {
      expect(accessibleSql(me(), 'test_doc', 'r', { sqlKit, scope: 'owned', orgColumn: null }).text).toBe('("r"."owner_user_id" = $1::uuid)');
      expect(accessibleSql(me(), 'test_doc', 'r', { sqlKit, scope: 'groups', orgColumn: null }).text).toBe('FALSE');
      expect(accessibleSql(me([[GROUP, 'admin']]), 'note', 'r', { sqlKit, scope: 'groups', orgColumn: null }).text).toBe('FALSE');
      expect(accessibleSql(me(), 'test_doc', 'r', { sqlKit, scope: 'shared', minRole: 'owner', orgColumn: null }).text).toBe('FALSE');
    });
  });

  it("needs the app's Prisma namespace as its SQL kit (the package never loads Prisma)", async () => {
    await withTypes([def()], () => {
      expect(() => accessibleSql(me(), 'test_doc', 'r', {} as never)).toThrow(/sqlKit: Prisma/);
    });
  });

  it('refuses an alias or a column that is not a plain identifier', async () => {
    await withTypes([def()], () => {
      expect(() => accessibleSql(me(), 'test_doc', 'r; drop table x', { sqlKit })).toThrow(/plain identifier/);
      expect(() => accessibleSql(me(), 'test_doc', 'r', { sqlKit, idColumn: 'id"--' })).toThrow(/plain identifier/);
    });
  });
});

describe('sharedResourceIds', () => {
  it('returns the grouped ids, bounded by limit (at most 10,000)', async () => {
    const tx = fakeTx();
    tx.grant.groupBy.mockResolvedValue([{ resourceId: DOC_A }]);
    await withTypes([def()], async () => {
      expect(await sharedResourceIds(me(), 'test_doc', { tx, limit: 5 })).toEqual([DOC_A]);
      expect(tx.grant.groupBy.mock.calls[0]![0].take).toBe(5);
      await sharedResourceIds(me(), 'test_doc', { tx, limit: 1_000_000 });
      expect(tx.grant.groupBy.mock.calls[1]![0].take).toBe(10_000);
      expect(await sharedResourceIds(me(), 'test_doc', { tx, minRole: 'owner' })).toEqual([]);
    });
  });
});
