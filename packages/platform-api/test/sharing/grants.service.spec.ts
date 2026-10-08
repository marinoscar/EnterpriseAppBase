// GrantsService (issue #729): the upsert (one role per grantee, on the partial
// unique index), self-grant, grantable roles, the cap, cross-org grantees,
// the throttle, revoke rules, "shared with me", deleteForResources, and the
// notification rule (create or role change only, after commit). The real
// database versions are apps/api/test/sharing/grants.db.spec.ts.

import { HttpException } from '@nestjs/common';

import type { Principal } from '../../src/core/index';
import { AccessPolicy, GrantsService, MemberLookupThrottle, SHARING_EVENTS, deleteGrantsForResources } from '../../src/sharing/index';
import { PrincipalGroupsProvider } from '../../src/sharing/principal-groups.provider';
import { ALICE, BOB, CAROL, GROUP, ORG, fakeData, fakeEffects, fakeTx, options, principal, stringsIn, type FakeTx } from './fakes';
import { DOC_A, byUser, docType, withTypes } from './grants-fakes';

const NOW = Date.parse('2026-06-01T00:00:00Z');
const GRANT = '99999999-0000-4000-8000-000000000001';

function grantRow(extra: Record<string, unknown> = {}) {
  return {
    id: GRANT,
    orgId: ORG,
    resourceType: 'test_doc',
    resourceId: DOC_A,
    granteeKind: 'user',
    granteeUserId: BOB,
    granteeGroupId: null,
    role: 'viewer',
    linkTokenHash: null,
    linkTokenCiphertext: null,
    linkLabel: null,
    expiresAt: null,
    revokedAt: null,
    revokedById: null,
    grantedById: ALICE,
    metadata: null,
    createdAt: new Date('2026-05-01T00:00:00Z'),
    updatedAt: new Date('2026-05-01T00:00:00Z'),
    granteeUser: { email: 'bob@example.com', displayName: 'Bob', providerDisplayName: null },
    granteeGroup: null,
    ...extra,
  };
}

function build(tx: FakeTx, throttle = new MemberLookupThrottle()) {
  const data = fakeData(tx);
  const principalGroups = new PrincipalGroupsProvider(data, options(), undefined, () => 0);
  jest.spyOn(principalGroups, 'groupsFor').mockResolvedValue([{ groupId: GROUP, orgId: ORG, role: 'viewer' }]);
  const policy = new AccessPolicy(data, principalGroups, undefined, () => NOW);
  const fx = fakeEffects(tx);
  const service = new GrantsService(data, policy, principalGroups, throttle, fx.effects, () => NOW);
  return { service, data, ...fx };
}

/** The table: DOC_A owned by Alice. Bob and Carol are active members of ORG. */
function seed(tx: FakeTx) {
  tx.user.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
    [ALICE, BOB, CAROL].includes(where.id) ? { id: where.id, isActive: true, email: `${where.id.slice(0, 1)}@example.com`, displayName: 'Alice', providerDisplayName: null } : null,
  );
  tx.user.findFirst.mockImplementation(async ({ where }: { where: { email: { equals: string } } }) =>
    where.email.equals === 'bob@example.com' ? { id: BOB, isActive: true } : null,
  );
  tx.membership.findFirst.mockImplementation(async ({ where }: { where: { userId: string } }) => ([ALICE, BOB].includes(where.userId) ? { userId: where.userId } : null));
  tx.grant.findUnique.mockResolvedValue(grantRow());
}

const owner = (permissions: string[] = ['sharing:read', 'sharing:write']): Principal => principal({ permissions, groups: [] });
const upserted = (inserted: boolean, previousRole: string | null = null, previousExpiry: Date | null = null) => [
  { id: GRANT, inserted, previous_role: previousRole, previous_expires_at: previousExpiry },
];
const table = () => new Map([[DOC_A, byUser(ALICE)]]);
const base = { resourceType: 'test_doc', resourceId: DOC_A, role: 'viewer' } as const;

async function status(promise: Promise<unknown>): Promise<[number, unknown]> {
  try {
    await promise;
  } catch (error) {
    return [(error as HttpException).getStatus(), (error as HttpException).getResponse()];
  }
  throw new Error('expected a refusal');
}

describe('GrantsService.create', () => {
  it('creates a user grant: audit, created event and the shared_with_you notification AFTER commit', async () => {
    const tx = fakeTx();
    seed(tx);
    const { service, emitted, notifier } = build(tx);
    tx.$queryRaw.mockImplementation(async () => {
      expect(notifier.notify).not.toHaveBeenCalled(); // inside the transaction: nothing dispatched yet
      expect(emitted).toEqual([]);
      return upserted(true);
    });
    await withTypes([docType(table(), { describe: async (ids) => new Map(ids.map((id) => [id, { title: '<Q3> notes', path: `/docs/${id}` }])) })], async () => {
      const dto = await service.create(owner(), { ...base, grantee: { kind: 'user', userId: BOB } });
      expect(dto).toMatchObject({ id: GRANT, role: 'viewer', grantee: { kind: 'user', userId: BOB, email: 'bob@example.com', displayName: 'Bob' } });
    });
    expect(tx.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'grant:create',
        targetType: 'grant',
        targetId: GRANT,
        orgId: ORG,
        meta: { resourceType: 'test_doc', resourceId: DOC_A, granteeKind: 'user', granteeId: BOB, role: 'viewer', previousRole: null },
      }),
    });
    expect(emitted.map((e) => e.name)).toEqual([SHARING_EVENTS.GRANT_CREATED]);
    expect(stringsIn(emitted).some((s) => s.includes('@'))).toBe(false);
    expect(notifier.notify).toHaveBeenCalledWith('sharing.shared_with_you', BOB, {
      resourceType: 'test_doc',
      resourceId: DOC_A,
      role: 'viewer',
      title: '<Q3> notes',
      path: `/docs/${DOC_A}`,
      sharedBy: 'Alice',
    });
  });

  it('upserts on the partial unique index of the grantee kind, never a findFirst pre-check', async () => {
    const tx = fakeTx();
    seed(tx);
    tx.$queryRaw.mockResolvedValue(upserted(true));
    const { service } = build(tx);
    await withTypes([docType(table())], () => service.create(owner(), { ...base, grantee: { kind: 'user', userId: BOB } }));
    const sql = (tx.$queryRaw.mock.calls[0]![0] as string[]).join('?');
    expect(sql).toContain("ON CONFLICT (resource_type, resource_id, grantee_user_id) WHERE grantee_kind = 'user' AND revoked_at IS NULL");
    expect(sql).toContain('DO UPDATE SET role = EXCLUDED.role');
    expect(tx.grant.findFirst).not.toHaveBeenCalled();
  });

  it('an unchanged re-grant writes no audit row, emits nothing and notifies nobody', async () => {
    const tx = fakeTx();
    seed(tx);
    tx.$queryRaw.mockResolvedValue(upserted(false, 'viewer', null));
    const { service, emitted, notifier } = build(tx);
    await withTypes([docType(table())], () => service.create(owner(), { ...base, grantee: { kind: 'user', userId: BOB } }));
    expect(tx.auditEvent.create).not.toHaveBeenCalled();
    expect(emitted).toEqual([]);
    expect(notifier.notify).not.toHaveBeenCalled();
  });

  it('a re-grant with another role is an update: audit with previousRole, updated event, one notification', async () => {
    const tx = fakeTx();
    seed(tx);
    tx.grant.findUnique.mockResolvedValue(grantRow({ role: 'editor' }));
    tx.$queryRaw.mockResolvedValue(upserted(false, 'viewer'));
    const { service, emitted, notifier } = build(tx);
    await withTypes([docType(table())], () => service.create(owner(), { ...base, role: 'editor', grantee: { kind: 'user', userId: BOB } }));
    expect(tx.auditEvent.create.mock.calls[0]![0].data).toMatchObject({ action: 'grant:update', meta: { role: 'editor', previousRole: 'viewer' } });
    expect(emitted.map((e) => [e.name, (e.payload as { previousRole: string }).previousRole])).toEqual([[SHARING_EVENTS.GRANT_UPDATED, 'viewer']]);
    expect(notifier.notify).toHaveBeenCalledTimes(1);
    expect(notifier.notify.mock.calls[0]![2]).toMatchObject({ role: 'editor', previousRole: 'viewer' });
  });

  it('a re-grant that only moves the expiry is an update without a notification', async () => {
    const tx = fakeTx();
    seed(tx);
    tx.$queryRaw.mockResolvedValue(upserted(false, 'viewer', null));
    const { service, emitted, notifier } = build(tx);
    await withTypes([docType(table())], () =>
      service.create(owner(), { ...base, expiresAt: '2026-07-01T00:00:00Z', grantee: { kind: 'user', userId: BOB } }),
    );
    expect(emitted.map((e) => e.name)).toEqual([SHARING_EVENTS.GRANT_UPDATED]);
    expect(notifier.notify).not.toHaveBeenCalled();
  });

  it('a group grant of the organization notifies nobody', async () => {
    const tx = fakeTx();
    seed(tx);
    tx.group.findFirst.mockResolvedValue({ id: GROUP });
    tx.grant.findUnique.mockResolvedValue(grantRow({ granteeKind: 'group', granteeUserId: null, granteeGroupId: GROUP, granteeUser: null, granteeGroup: { name: 'Family' } }));
    tx.$queryRaw.mockResolvedValue(upserted(true));
    const { service, emitted, notifier } = build(tx);
    const dto = await withTypes([docType(table())], () => service.create(owner(), { ...base, grantee: { kind: 'group', groupId: GROUP } }));
    expect(dto.grantee).toEqual({ kind: 'group', userId: null, email: null, displayName: null, groupId: GROUP, groupName: 'Family' });
    expect((tx.$queryRaw.mock.calls[0]![0] as string[]).join('?')).toContain("WHERE grantee_kind = 'group' AND revoked_at IS NULL");
    expect(tx.group.findFirst).toHaveBeenCalledWith({ where: { id: GROUP, orgId: ORG }, select: { id: true } });
    expect(emitted.map((e) => e.name)).toEqual([SHARING_EVENTS.GRANT_CREATED]);
    expect(notifier.notify).not.toHaveBeenCalled();
  });

  it.each([
    ['sharing with yourself', { grantee: { kind: 'user', userId: ALICE } }, 400, 'SELF_GRANT'],
    ['a person outside the organization', { grantee: { kind: 'user', userId: CAROL } }, 422, 'NOT_AN_ORG_MEMBER'],
    ['an unknown user', { grantee: { kind: 'user', userId: GRANT } }, 422, 'NOT_AN_ORG_MEMBER'],
    ["a group of another organization (RLS hides it)", { grantee: { kind: 'group', groupId: GROUP } }, 422, 'GROUP_NOT_IN_ORG'],
    ['a role the type does not grant to users', { role: 'editor', grantee: { kind: 'user', userId: BOB } }, 422, 'ROLE_NOT_GRANTABLE'],
    ['an expiry in the past', { expiresAt: '2026-01-01T00:00:00Z', grantee: { kind: 'user', userId: BOB } }, 400, 'EXPIRY_IN_PAST'],
  ])('refuses %s', async (_name, input, code, reason) => {
    const tx = fakeTx();
    seed(tx);
    const { service } = build(tx);
    await withTypes([docType(table(), { grantable: { user: ['viewer'] } })], async () => {
      const [got, body] = await status(service.create(owner(), { ...base, ...input } as never));
      expect(got).toBe(code);
      expect(body).toMatchObject({ details: { reason } });
    });
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it('answers 404 for a record the caller may not share, and for an unknown type, before any write', async () => {
    const tx = fakeTx();
    seed(tx);
    const { service } = build(tx);
    await withTypes([docType(new Map([[DOC_A, byUser(BOB)]]))], async () => {
      const [denied, deniedBody] = await status(service.create(owner(), { ...base, grantee: { kind: 'user', userId: CAROL } }));
      const [unknown, unknownBody] = await status(service.create(owner(), { ...base, resourceType: 'nope', grantee: { kind: 'user', userId: BOB } }));
      expect([denied, unknown]).toEqual([404, 404]);
      expect(deniedBody).toEqual(unknownBody);
    });
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it('caps the active grants of a record, but never blocks changing an existing grantee', async () => {
    const tx = fakeTx();
    seed(tx);
    tx.$queryRaw.mockResolvedValue(upserted(false, 'viewer'));
    const { service } = build(tx);
    await withTypes([docType(table(), { maxGrantsPerResource: 2 })], async () => {
      tx.grant.count.mockResolvedValueOnce(2).mockResolvedValueOnce(0);
      const [code, body] = await status(service.create(owner(), { ...base, grantee: { kind: 'user', userId: BOB } }));
      expect([code, body]).toEqual([409, expect.objectContaining({ details: { reason: 'GRANT_LIMIT_REACHED' } })]);
      tx.grant.count.mockResolvedValueOnce(2).mockResolvedValueOnce(1);
      await expect(service.create(owner(), { ...base, grantee: { kind: 'user', userId: BOB } })).resolves.toMatchObject({ id: GRANT });
    });
  });

  it('throttles failed lookups by e-mail per account (429 with retryAfterMs)', async () => {
    const tx = fakeTx();
    seed(tx);
    const { service } = build(tx, new MemberLookupThrottle({ maxMisses: 2, now: () => NOW }));
    await withTypes([docType(table())], async () => {
      for (let i = 0; i < 2; i += 1) {
        expect((await status(service.create(owner(), { ...base, grantee: { kind: 'user', email: `nobody${i}@example.com` } })))[0]).toBe(422);
      }
      const [code, body] = await status(service.create(owner(), { ...base, grantee: { kind: 'user', email: 'bob@example.com' } }));
      expect(code).toBe(429);
      expect(body).toMatchObject({ details: { reason: 'LOOKUP_THROTTLED', retryAfterMs: expect.any(Number) } });
    });
  });
});

describe('GrantsService.update and revoke', () => {
  it('changes the role and notifies the user once', async () => {
    const tx = fakeTx();
    seed(tx);
    tx.grant.findFirst.mockResolvedValue(grantRow());
    tx.grant.update.mockResolvedValue(grantRow({ role: 'editor' }));
    const { service, emitted, notifier } = build(tx);
    await withTypes([docType(table())], () => service.update(owner(), GRANT, { role: 'editor' }));
    expect(tx.grant.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: GRANT }, data: { role: 'editor' } }));
    expect(emitted.map((e) => e.name)).toEqual([SHARING_EVENTS.GRANT_UPDATED]);
    expect(notifier.notify).toHaveBeenCalledTimes(1);
  });

  it("answers 'Grant not found' to a caller who may not share the record", async () => {
    const tx = fakeTx();
    seed(tx);
    tx.grant.findFirst.mockResolvedValue(grantRow());
    const { service } = build(tx);
    await withTypes([docType(new Map([[DOC_A, byUser(CAROL)]]))], async () => {
      expect(await status(service.update(owner(), GRANT, { role: 'editor' }))).toEqual([404, expect.objectContaining({ message: 'Grant not found' })]);
    });
    expect(tx.grant.update).not.toHaveBeenCalled();
  });

  it('lets the grantee remove their own access with sharing:read only (soft revoke)', async () => {
    const tx = fakeTx();
    seed(tx);
    tx.grant.findFirst.mockResolvedValue(grantRow({ granteeUserId: BOB }));
    tx.grant.update.mockResolvedValue(grantRow({ revokedAt: new Date(NOW), revokedById: BOB }));
    const { service, emitted } = build(tx);
    const bob = principal({ userId: BOB, permissions: ['sharing:read'], groups: [] });
    await withTypes([docType(new Map([[DOC_A, byUser(CAROL)]]))], () => service.revoke(bob, GRANT));
    expect(tx.grant.update).toHaveBeenCalledWith(expect.objectContaining({ data: { revokedAt: new Date(NOW), revokedById: BOB } }));
    expect(tx.grant.delete).not.toHaveBeenCalled();
    expect(tx.auditEvent.create.mock.calls[0]![0].data).toMatchObject({ action: 'grant:revoke' });
    expect(emitted.map((e) => e.name)).toEqual([SHARING_EVENTS.GRANT_REVOKED]);
  });

  it("refuses someone else's grant without sharing:write, with the same 404", async () => {
    const tx = fakeTx();
    seed(tx);
    tx.grant.findFirst.mockResolvedValue(grantRow({ granteeUserId: BOB }));
    const { service } = build(tx);
    await withTypes([docType(table())], async () => {
      expect((await status(service.revoke(owner(['sharing:read']), GRANT)))[0]).toBe(404);
      // With sharing:write, the owner revokes it.
      tx.grant.update.mockResolvedValue(grantRow({ revokedAt: new Date(NOW) }));
      await expect(service.revoke(owner(), GRANT)).resolves.toBeUndefined();
    });
  });
});

describe('GrantsService.sharedWithMe and deleteForResources', () => {
  it('lists active grants to me or my groups, newest first, with describe() labels', async () => {
    const tx = fakeTx();
    tx.grant.count.mockResolvedValue(1);
    tx.grant.findMany.mockResolvedValue([grantRow({ granteeKind: 'group', granteeUserId: null, granteeGroupId: GROUP })]);
    const { service } = build(tx);
    const list = await withTypes([docType(table(), { describe: async (ids) => new Map(ids.map((id) => [id, { title: 'Notes' }])) })], () =>
      service.sharedWithMe(principal({ userId: BOB }), { page: 1, pageSize: 20 }),
    );
    expect(list).toMatchObject({ total: 1, items: [{ grantId: GRANT, via: 'group_grant', groupId: GROUP, title: 'Notes', path: null }] });
    const where = tx.grant.findMany.mock.calls[0]![0].where;
    expect(where).toMatchObject({ orgId: ORG, resourceType: { in: ['test_doc'] }, revokedAt: null });
    expect(where.AND[1].OR).toEqual([{ granteeKind: 'user', granteeUserId: BOB }, { granteeKind: 'group', granteeGroupId: { in: [GROUP] } }]);
    expect(tx.grant.findMany.mock.calls[0]![0].orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
  });

  it('answers an empty page for an unregistered type filter, with no query', async () => {
    const tx = fakeTx();
    const { service } = build(tx);
    expect(await service.sharedWithMe(principal(), { resourceType: 'nope', page: 1, pageSize: 20 })).toEqual({ items: [], total: 0, page: 1, pageSize: 20, totalPages: 0 });
    expect(tx.grant.findMany).not.toHaveBeenCalled();
  });

  it('deletes the grants of deleted records in chunks of 1000', async () => {
    const tx = fakeTx();
    tx.grant.deleteMany.mockResolvedValue({ count: 3 });
    const ids = Array.from({ length: 2500 }, (_, i) => `id-${i}`);
    expect(await deleteGrantsForResources(tx, 'test_doc', [...ids, ids[0]!])).toBe(9);
    expect(tx.grant.deleteMany.mock.calls.map((c) => c[0].where.resourceId.in.length)).toEqual([1000, 1000, 500]);
    expect(tx.grant.deleteMany.mock.calls[0]![0].where.resourceType).toBe('test_doc');
  });
});
