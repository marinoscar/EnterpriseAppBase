// AccessPolicy (issue #729): the decision order as a matrix, the maximum of
// every role source, denyAs, the 403 for a missing action permission,
// per-request memoisation and the batched query count. The same rules on a
// real database (expiry and revocation included) are
// apps/api/test/sharing/grants.db.spec.ts.

import { HttpException, NotFoundException } from '@nestjs/common';

import type { Principal } from '../../src/core/index';
import { AccessPolicy, resourceKey, type ResourceTypeDef } from '../../src/sharing/index';
import { PrincipalGroupsProvider } from '../../src/sharing/principal-groups.provider';
import { ALICE, BOB, GROUP, ORG, OTHER_ORG, fakeData, fakeTx, options, principal, type FakeTx } from './fakes';
import { DOC_A, DOC_B, DOC_C, GROUP_2, byGroup, byUser, docType, grantRow, withTypes, type OwnerTable } from './grants-fakes';

function build(tx: FakeTx) {
  const data = fakeData(tx);
  const principalGroups = new PrincipalGroupsProvider(data, options(), undefined, () => 0);
  const metrics = { add: jest.fn() };
  const policy = new AccessPolicy(data, principalGroups, metrics as never, () => Date.parse('2026-06-01T00:00:00Z'));
  return { policy, data, metrics, principalGroups };
}

/** An enriched caller: its groups in ORG with their roles. */
function caller(permissions: string[] = ['docs:write'], groups: Array<[string, 'admin' | 'editor' | 'viewer']> = []): Principal {
  return principal({ permissions, groups: groups.map(([groupId, role]) => ({ groupId, orgId: ORG, role })) });
}

async function scenario(
  table: OwnerTable,
  grants: ReturnType<typeof grantRow>[],
  run: (policy: AccessPolicy, tx: FakeTx) => Promise<void>,
  overrides: Partial<ResourceTypeDef<'viewer' | 'editor'>> = {},
) {
  const tx = fakeTx();
  tx.grant.findMany.mockResolvedValue(grants);
  const { policy } = build(tx);
  await withTypes([docType(table, overrides)], () => run(policy, tx));
}

const A = { type: 'test_doc', id: DOC_A };

describe('AccessPolicy decision matrix', () => {
  type Row = {
    name: string;
    table: OwnerTable;
    grants?: ReturnType<typeof grantRow>[];
    who?: Principal;
    def?: Partial<ResourceTypeDef<'viewer' | 'editor'>>;
    expect: Record<'read' | 'write' | 'share', boolean>;
    role: string | null;
    via: Record<'read' | 'write' | 'share', string | null>;
  };
  const rows: Row[] = [
    {
      name: 'owner',
      table: new Map([[DOC_A, byUser(ALICE)]]),
      expect: { read: true, write: true, share: true },
      role: 'owner',
      via: { read: 'owner', write: 'owner', share: 'owner' },
    },
    {
      name: 'user grant viewer',
      table: new Map([[DOC_A, byUser(BOB)]]),
      grants: [grantRow({ resourceId: DOC_A, role: 'viewer', userId: ALICE })],
      expect: { read: true, write: false, share: false },
      role: 'viewer',
      via: { read: 'user_grant', write: null, share: null },
    },
    {
      name: 'user grant editor',
      table: new Map([[DOC_A, byUser(BOB)]]),
      grants: [grantRow({ resourceId: DOC_A, role: 'editor', userId: ALICE })],
      expect: { read: true, write: true, share: false },
      role: 'editor',
      via: { read: 'user_grant', write: 'user_grant', share: null },
    },
    {
      name: 'group grant to one of my groups',
      table: new Map([[DOC_A, byUser(BOB)]]),
      grants: [grantRow({ resourceId: DOC_A, role: 'editor', groupId: GROUP })],
      who: caller(['docs:write'], [[GROUP, 'viewer']]),
      expect: { read: true, write: true, share: false },
      role: 'editor',
      via: { read: 'group_grant', write: 'group_grant', share: null },
    },
    {
      name: 'group owner, as group admin',
      table: new Map([[DOC_A, byGroup(GROUP)]]),
      who: caller(['docs:write'], [[GROUP, 'admin']]),
      expect: { read: true, write: true, share: true },
      role: 'owner',
      via: { read: 'group_owner', write: 'group_owner', share: 'group_owner' },
    },
    {
      name: 'group owner, as group editor',
      table: new Map([[DOC_A, byGroup(GROUP)]]),
      who: caller(['docs:write'], [[GROUP, 'editor']]),
      expect: { read: true, write: true, share: false },
      role: 'editor',
      via: { read: 'group_owner', write: 'group_owner', share: null },
    },
    {
      name: 'group owner, as group viewer',
      table: new Map([[DOC_A, byGroup(GROUP)]]),
      who: caller(['docs:write'], [[GROUP, 'viewer']]),
      expect: { read: true, write: false, share: false },
      role: 'viewer',
      via: { read: 'group_owner', write: null, share: null },
    },
    {
      name: 'owned by a group I am not in',
      table: new Map([[DOC_A, byGroup(GROUP_2)]]),
      who: caller(['docs:write'], [[GROUP, 'admin']]),
      expect: { read: false, write: false, share: false },
      role: null,
      via: { read: null, write: null, share: null },
    },
    {
      name: "the org default ('org', orgRole viewer)",
      table: new Map([[DOC_A, byUser(BOB)]]),
      def: { defaultVisibility: 'org', orgRole: 'viewer' },
      expect: { read: true, write: false, share: false },
      role: 'viewer',
      via: { read: 'org_default', write: null, share: null },
    },
    {
      name: 'the bypass permission for read',
      table: new Map([[DOC_A, byUser(BOB)]]),
      who: caller(['docs:write', 'docs:read_any']),
      expect: { read: true, write: false, share: false },
      role: null,
      via: { read: 'bypass', write: null, share: null },
    },
    {
      name: 'sharing:admin, a bypass for share on every type',
      table: new Map([[DOC_A, byUser(BOB)]]),
      who: caller(['docs:write', 'sharing:admin']),
      expect: { read: false, write: false, share: true },
      role: null,
      via: { read: null, write: null, share: 'bypass' },
    },
    {
      name: 'the owner WITHOUT the write permission',
      table: new Map([[DOC_A, byUser(ALICE)]]),
      who: caller([]),
      expect: { read: true, write: false, share: true },
      role: 'owner',
      via: { read: 'owner', write: null, share: 'owner' },
    },
    {
      name: 'my record in another organization',
      table: new Map([[DOC_A, byUser(ALICE, OTHER_ORG)]]),
      grants: [grantRow({ resourceId: DOC_A, role: 'editor', userId: ALICE })],
      expect: { read: false, write: false, share: false },
      role: null,
      via: { read: null, write: null, share: null },
    },
    {
      name: 'a missing record',
      table: new Map(),
      expect: { read: false, write: false, share: false },
      role: null,
      via: { read: null, write: null, share: null },
    },
    {
      name: 'a grant to someone else',
      table: new Map([[DOC_A, byUser(BOB)]]),
      grants: [grantRow({ resourceId: DOC_A, role: 'editor', userId: BOB })],
      expect: { read: false, write: false, share: false },
      role: null,
      via: { read: null, write: null, share: null },
    },
  ];

  for (const row of rows) {
    it(row.name, async () => {
      await scenario(
        row.table,
        row.grants ?? [],
        async (policy) => {
          const who = row.who ?? caller();
          for (const action of ['read', 'write', 'share'] as const) {
            const decision = await policy.decide(who, action, A);
            expect([action, decision.allowed, decision.via]).toEqual([action, row.expect[action], row.via[action]]);
          }
          expect(await policy.roleFor(row.who ?? caller(), A)).toBe(row.role);
        },
        row.def,
      );
    });
  }

  it('takes the MAXIMUM of every source (group viewer, org default, a user grant editor)', async () => {
    await scenario(
      new Map([[DOC_A, byGroup(GROUP)]]),
      [grantRow({ resourceId: DOC_A, role: 'editor', userId: ALICE }), grantRow({ resourceId: DOC_A, role: 'viewer', groupId: GROUP })],
      async (policy) => {
        expect(await policy.decide(caller(['docs:write'], [[GROUP, 'viewer']]), 'write', A)).toEqual({ allowed: true, role: 'editor', via: 'user_grant' });
        // The group admin's 'owner' beats every grant.
        expect(await policy.decide(caller(['docs:write'], [[GROUP, 'admin']]), 'write', A)).toEqual({ allowed: true, role: 'owner', via: 'group_owner' });
      },
      { defaultVisibility: 'org', orgRole: 'viewer' },
    );
  });

  it('ignores a grant role the type no longer lists', async () => {
    await scenario(new Map([[DOC_A, byUser(BOB)]]), [grantRow({ resourceId: DOC_A, role: 'commenter', userId: ALICE })], async (policy) => {
      expect(await policy.decide(caller(), 'read', A)).toEqual({ allowed: false, role: null, via: null });
    });
  });

  it('asks only for active, unexpired grants of me and my groups in my organization', async () => {
    await scenario(new Map([[DOC_A, byUser(BOB)]]), [], async (policy, tx) => {
      await policy.decide(caller([], [[GROUP, 'viewer']]), 'read', A);
      const where = tx.grant.findMany.mock.calls[0]![0].where;
      expect(where).toMatchObject({ orgId: ORG, revokedAt: null });
      expect(where.AND).toEqual([
        { OR: [{ resourceType: 'test_doc', resourceId: { in: [DOC_A] } }] },
        { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date('2026-06-01T00:00:00Z') } }] },
        { OR: [{ granteeKind: 'user', granteeUserId: ALICE }, { granteeKind: 'group', granteeGroupId: { in: [GROUP] } }] },
      ]);
    });
  });
});

describe('AccessPolicy.require', () => {
  async function bodyOf(promise: Promise<unknown>): Promise<{ status: number; body: unknown }> {
    try {
      await promise;
    } catch (error) {
      const http = error as HttpException;
      return { status: http.getStatus(), body: http.getResponse() };
    }
    throw new Error('expected a refusal');
  }

  it("answers every denial of a 'not_found' type with the SAME 404 as a missing record", async () => {
    await scenario(new Map([[DOC_A, byUser(BOB)]]), [], async (policy) => {
      const denied = await bodyOf(policy.require(caller(), 'read', A));
      const missing = await bodyOf(policy.require(caller(), 'read', { type: 'test_doc', id: DOC_C }));
      expect(denied.status).toBe(404);
      expect(denied).toEqual(missing);
      await expect(policy.require(caller(), 'read', A)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  it("answers 403 for a 'forbidden' type, and the same 404 for a missing record", async () => {
    await scenario(
      new Map([[DOC_A, byUser(BOB)]]),
      [],
      async (policy) => {
        expect((await bodyOf(policy.require(caller(), 'read', A))).status).toBe(403);
      },
      { denyAs: 'forbidden' },
    );
  });

  it('answers 403 naming the permission when the action needs one, even for the owner', async () => {
    await scenario(new Map([[DOC_A, byUser(ALICE)]]), [], async (policy) => {
      const { status, body } = await bodyOf(policy.require(caller([]), 'write', A));
      expect(status).toBe(403);
      expect(body).toMatchObject({ message: 'Missing permission: docs:write', details: { reason: 'MISSING_PERMISSION', permission: 'docs:write' } });
    });
  });

  it('returns the decision when allowed', async () => {
    await scenario(new Map([[DOC_A, byUser(ALICE)]]), [], async (policy) => {
      expect(await policy.require(caller(), 'share', A)).toEqual({ allowed: true, role: 'owner', via: 'owner' });
    });
  });

  it('calls an unknown type or action a programming error (500), not a 404', async () => {
    await scenario(new Map([[DOC_A, byUser(ALICE)]]), [], async (policy, tx) => {
      const unknownType = policy.decide(caller(), 'read', { type: 'nope', id: DOC_A });
      await expect(unknownType).rejects.toThrow(/Unknown resource type "nope"/);
      await expect(unknownType).rejects.not.toBeInstanceOf(HttpException);
      await expect(policy.decide(caller(), 'publish', A)).rejects.toThrow(/declares no action "publish"/);
      expect(tx.grant.findMany).not.toHaveBeenCalled();
    });
  });
});

describe('AccessPolicy batching and memoisation', () => {
  it('decides 100 records with one transaction, one owner query and one grant query', async () => {
    const ids = Array.from({ length: 100 }, (_, i) => `d0000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    const table: OwnerTable = new Map(ids.map((id, i) => [id, i % 2 === 0 ? byUser(ALICE) : byUser(BOB)]));
    const tx = fakeTx();
    tx.grant.findMany.mockResolvedValue([grantRow({ resourceId: ids[1]!, role: 'viewer', userId: ALICE })]);
    const { policy, data } = build(tx);
    const def = docType(table);
    await withTypes([def], async () => {
      const decisions = await policy.decideMany(caller(), 'read', ids.map((id) => ({ type: 'test_doc', id })));
      expect(decisions.size).toBe(100);
      expect(decisions.get(resourceKey({ type: 'test_doc', id: ids[0]! }))!.via).toBe('owner');
      expect(decisions.get(`test_doc:${ids[1]}`)!.via).toBe('user_grant');
      expect(decisions.get(`test_doc:${ids[3]}`)!.allowed).toBe(false);
      expect(data.scopes).toEqual([{ orgId: ORG, userId: ALICE }]);
      expect(def.loadOwners).toHaveBeenCalledTimes(1);
      expect(tx.grant.findMany).toHaveBeenCalledTimes(1);
    });
  });

  it('memoises per principal object (one request) and never across requests', async () => {
    const tx = fakeTx();
    const { policy } = build(tx);
    const def = docType(new Map([[DOC_A, byUser(ALICE)]]));
    await withTypes([def], async () => {
      const request1 = caller();
      await policy.can(request1, 'read', A);
      await policy.can(request1, 'read', A);
      await policy.decideMany(request1, 'read', [A, A]);
      expect(def.loadOwners).toHaveBeenCalledTimes(1);
      await policy.can(caller(), 'read', A); // the next request: a new principal object
      expect(def.loadOwners).toHaveBeenCalledTimes(2);
    });
  });

  it('forgets a failed batch so the next call retries it', async () => {
    const tx = fakeTx();
    const { policy } = build(tx);
    const def = docType(new Map([[DOC_A, byUser(ALICE)]]));
    def.loadOwners.mockRejectedValueOnce(new Error('db down'));
    await withTypes([def], async () => {
      const who = caller();
      await expect(policy.can(who, 'read', A)).rejects.toThrow('db down');
      expect(await policy.can(who, 'read', A)).toBe(true);
    });
  });

  it('denies without a query when the caller has no active organization', async () => {
    const tx = fakeTx();
    const { policy, data } = build(tx);
    const def = docType(new Map([[DOC_A, byUser(ALICE)]]));
    await withTypes([def], async () => {
      expect(await policy.decide(principal({ activeOrgId: undefined }), 'read', A)).toEqual({ allowed: false, role: null, via: null });
      expect(data.scopes).toEqual([]);
      expect(def.loadOwners).not.toHaveBeenCalled();
    });
  });

  it('counts each decision with bounded labels only', async () => {
    const tx = fakeTx();
    const { policy, metrics } = build(tx);
    await withTypes([docType(new Map([[DOC_A, byUser(ALICE)], [DOC_B, byUser(BOB)]]))], async () => {
      await policy.decideMany(caller(), 'read', [A, { type: 'test_doc', id: DOC_B }]);
      expect(metrics.add.mock.calls).toEqual([
        ['sharingAccessDecisions', 1, { resource_type: 'test_doc', outcome: 'allowed', via: 'owner' }],
        ['sharingAccessDecisions', 1, { resource_type: 'test_doc', outcome: 'denied', via: 'none' }],
      ]);
    });
  });

  it('loads the groups of an unenriched principal from the provider, for its active organization only', async () => {
    const tx = fakeTx();
    const { policy, principalGroups } = build(tx);
    jest.spyOn(principalGroups, 'groupsFor').mockResolvedValue([
      { groupId: GROUP, orgId: ORG, role: 'admin' },
      { groupId: GROUP_2, orgId: OTHER_ORG, role: 'admin' },
    ]);
    await withTypes([docType(new Map([[DOC_A, byGroup(GROUP)], [DOC_B, byGroup(GROUP_2)]]))], async () => {
      const who = principal({ permissions: [] });
      expect(await policy.can(who, 'share', A)).toBe(true);
      expect(await policy.can(who, 'share', { type: 'test_doc', id: DOC_B })).toBe(false);
    });
  });
});
