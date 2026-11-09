// The sharing listings for administrators and background sweeps:
//   #1136  LinkGrantsService.listForOrg (GET /api/grants/links?scope=org,
//          sharing:admin) and LinkGrantsService.listExpiring;
//   #1137  GroupsService.listForSystem and GroupMembershipService.membersForSystem,
//          each behind a registered SystemAccessReason.
// Unit level, over the fake data port; the scope each query runs in is
// asserted (an org listing never bypasses row-level security).

import { HttpException } from '@nestjs/common';
import { linkGrantListQuerySchema } from '@marinoscar/platform-contract/sharing';

import { ScopedAccessError, type Principal } from '../../src/core/index';
import {
  AccessPolicy,
  GroupMembershipService,
  GroupsService,
  LinkGrantsService,
  resolveSharingModuleOptions,
} from '../../src/sharing/index';
import { MemberLookupThrottle } from '../../src/sharing/groups/member-lookup-throttle';
import { PrincipalGroupsProvider } from '../../src/sharing/principal-groups.provider';
import { ALICE, BOB, GROUP, ORG, fakeData, fakeEffects, fakeTx, groupRow, memberRow, options, principal, testHost, type FakeTx } from './fakes';

const NOW = Date.parse('2026-06-01T00:00:00Z');
const DAY = 86_400_000;
const GRANT_1 = '55555555-5555-4555-8555-555555555551';
const GRANT_2 = '55555555-5555-4555-8555-555555555552';

function links(tx: FakeTx) {
  const data = fakeData(tx);
  const principalGroups = new PrincipalGroupsProvider(data, options(), undefined, () => 0);
  const policy = new AccessPolicy(data, principalGroups, undefined, () => NOW);
  const resolved = resolveSharingModuleOptions({ host: testHost, links: { appUrl: () => 'https://app.example.com/' } });
  return { service: new LinkGrantsService(data, policy, fakeEffects(tx).effects, resolved, () => NOW), data };
}

function groups(tx: FakeTx) {
  const data = fakeData(tx);
  const fx = fakeEffects(tx);
  const membership = new GroupMembershipService(data, options(), new MemberLookupThrottle(), fx.effects);
  return { groupsService: new GroupsService(data, options(), membership, fx.effects), membership, data };
}

const linkRow = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  orgId: ORG,
  resourceType: 'test_doc',
  resourceId: '66666666-6666-4666-8666-666666666666',
  granteeKind: 'link',
  granteeUserId: null,
  granteeGroupId: null,
  granteeRef: null,
  role: 'viewer',
  linkTokenHash: 'h',
  linkTokenCiphertext: null,
  linkLabel: 'printer',
  expiresAt: new Date(NOW + DAY),
  revokedAt: null,
  revokedById: null,
  grantedById: BOB,
  createdAt: new Date(NOW - DAY),
  updatedAt: new Date(NOW - DAY),
  ...extra,
});

const admin = (): Principal => principal({ permissions: ['sharing:read', 'sharing:admin'] });

async function refusal(promise: Promise<unknown>): Promise<[number, unknown]> {
  try {
    await promise;
  } catch (error) {
    return [(error as HttpException).getStatus(), (error as HttpException).getResponse()];
  }
  throw new Error('expected a refusal');
}

describe('GET /api/grants/links query (#1136)', () => {
  it('defaults to scope=resource and then requires the record', () => {
    expect(linkGrantListQuerySchema.safeParse({}).success).toBe(false);
    expect(linkGrantListQuerySchema.parse({ resourceType: 'test_doc', resourceId: GRANT_1 })).toMatchObject({ scope: 'resource', page: 1 });
  });

  it('accepts scope=org with no record, and its filters', () => {
    expect(linkGrantListQuerySchema.parse({ scope: 'org', status: 'expired', grantedById: BOB, pageSize: '10' })).toMatchObject({
      scope: 'org',
      status: 'expired',
      grantedById: BOB,
      pageSize: 10,
    });
    expect(linkGrantListQuerySchema.safeParse({ scope: 'org', status: 'gone' }).success).toBe(false);
  });
});

describe('LinkGrantsService.listForOrg (#1136)', () => {
  it('refuses a caller without sharing:admin with 403 MISSING_PERMISSION, before any query', async () => {
    const tx = fakeTx();
    const { service, data } = links(tx);
    const [code, body] = await refusal(service.list(principal({ permissions: ['sharing:read', 'sharing:write'] }), { scope: 'org', page: 1, pageSize: 20 }));
    expect(code).toBe(403);
    expect(body).toMatchObject({ details: { reason: 'MISSING_PERMISSION', permission: 'sharing:admin' } });
    expect(data.scopes).toEqual([]);
  });

  it('lists every link of the active organization in its scope, newest first, with filters', async () => {
    const tx = fakeTx();
    tx.grant.count.mockResolvedValue(2);
    tx.grant.findMany.mockResolvedValue([linkRow(GRANT_2), linkRow(GRANT_1, { revokedAt: new Date(NOW - 1) })]);
    const { service, data } = links(tx);

    const page = await service.list(admin(), { scope: 'org', page: 2, pageSize: 1, resourceType: 'test_doc', grantedById: BOB });

    expect(data.scopes).toEqual([{ orgId: ORG, userId: ALICE }]);
    expect(data.systemReasons).toEqual([]);
    const args = tx.grant.findMany.mock.calls[0][0];
    expect(args).toMatchObject({
      where: { orgId: ORG, granteeKind: 'link', resourceType: 'test_doc', grantedById: BOB },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: 1,
      take: 1,
    });
    // No status: revoked and expired links included.
    expect(args.where).not.toHaveProperty('revokedAt');
    expect(page).toMatchObject({ total: 2, page: 2, pageSize: 1, totalPages: 2 });
    expect(page.items.map((item) => item.id)).toEqual([GRANT_2, GRANT_1]);
    expect(page.items[1]).toMatchObject({ url: null, label: 'printer' });
  });

  it.each([
    ['active', { revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date(NOW) } }] }],
    ['expired', { revokedAt: null, expiresAt: { lte: new Date(NOW) } }],
    ['revoked', { revokedAt: { not: null } }],
  ] as const)('filters status=%s', async (status, expected) => {
    const tx = fakeTx();
    const { service } = links(tx);
    await service.listForOrg(admin(), { page: 1, pageSize: 20, status });
    expect(tx.grant.findMany.mock.calls[0][0].where).toMatchObject(expected);
    expect(tx.grant.count.mock.calls[0][0].where).toMatchObject(expected);
  });
});

describe('LinkGrantsService.listExpiring (#1136)', () => {
  it('returns the active links expiring within the window, in the org scope with no user, without tokens', async () => {
    const tx = fakeTx();
    tx.grant.findMany.mockResolvedValue([linkRow(GRANT_1)]);
    const { service, data } = links(tx);

    const page = await service.listExpiring({ orgId: ORG, within: 7 * DAY, resourceType: 'test_doc' });

    expect(data.scopes).toEqual([{ orgId: ORG }]);
    expect(data.systemReasons).toEqual([]);
    const args = tx.grant.findMany.mock.calls[0][0];
    expect(args.where).toEqual({
      orgId: ORG,
      granteeKind: 'link',
      revokedAt: null,
      expiresAt: { gt: new Date(NOW), lte: new Date(NOW + 7 * DAY) },
      resourceType: 'test_doc',
    });
    expect(args.select).not.toHaveProperty('linkTokenHash');
    expect(args.select).not.toHaveProperty('linkTokenCiphertext');
    expect(args).toMatchObject({ orderBy: [{ id: 'asc' }], take: 200 });
    expect(page.items).toEqual([
      {
        grantId: GRANT_1,
        orgId: ORG,
        resourceType: 'test_doc',
        resourceId: '66666666-6666-4666-8666-666666666666',
        role: 'viewer',
        label: 'printer',
        expiresAt: new Date(NOW + DAY),
        grantedById: BOB,
        createdAt: new Date(NOW - DAY),
      },
    ]);
    expect(page.nextCursor).toBeNull();
  });

  it('pages by grant id', async () => {
    const tx = fakeTx();
    tx.grant.findMany.mockResolvedValue([linkRow(GRANT_1), linkRow(GRANT_2)]);
    const { service } = links(tx);
    const first = await service.listExpiring({ orgId: ORG, within: DAY, limit: 2 });
    expect(first.nextCursor).toBe(GRANT_2);
    await service.listExpiring({ orgId: ORG, within: DAY, limit: 2, cursor: GRANT_2 });
    expect(tx.grant.findMany.mock.calls[1][0].where).toMatchObject({ id: { gt: GRANT_2 } });
  });

  it('refuses a bad window or limit', async () => {
    const { service } = links(fakeTx());
    await expect(service.listExpiring({ orgId: ORG, within: 0 })).rejects.toBeInstanceOf(RangeError);
    await expect(service.listExpiring({ orgId: ORG, within: 1.5 })).rejects.toBeInstanceOf(RangeError);
    await expect(service.listExpiring({ orgId: ORG, within: DAY, limit: 1001 })).rejects.toBeInstanceOf(RangeError);
  });
});

describe('GroupsService.listForSystem (#1137)', () => {
  it('refuses an unregistered reason before any query (fail closed)', async () => {
    const tx = fakeTx();
    const { groupsService, data } = groups(tx);
    await expect(groupsService.listForSystem({ reason: 'not-a-registered-reason', orgId: ORG })).rejects.toBeInstanceOf(ScopedAccessError);
    expect(data.scopes).toEqual([]);
    expect(data.systemReasons).toEqual([]);
    expect(tx.group.findMany).not.toHaveBeenCalled();
  });

  it('with orgId: runs in that organization scope (no bypass, no user) and pages by id', async () => {
    const tx = fakeTx();
    tx.group.findMany.mockResolvedValue([{ ...groupRow(), _count: { members: 4 } }]);
    const { groupsService, data } = groups(tx);

    const page = await groupsService.listForSystem({ reason: 'retention', orgId: ORG, limit: 1 });

    expect(data.scopes).toEqual([{ orgId: ORG }]);
    expect(data.systemReasons).toEqual([]);
    expect(tx.group.findMany.mock.calls[0][0]).toMatchObject({ where: { orgId: ORG }, orderBy: [{ id: 'asc' }], take: 1 });
    expect(page.items).toEqual([
      {
        id: GROUP,
        orgId: ORG,
        name: 'Family',
        description: null,
        metadata: null,
        createdById: ALICE,
        memberCount: 4,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-02T00:00:00Z'),
      },
    ]);
    expect(page.nextCursor).toBe(GROUP);
  });

  it('without orgId: runs on the system client under the caller reason, across organizations', async () => {
    const tx = fakeTx();
    const { groupsService, data } = groups(tx);
    const page = await groupsService.listForSystem({ reason: 'retention', cursor: GROUP });
    expect(data.systemReasons).toEqual(['retention']);
    expect(data.scopes).toEqual([]);
    expect(tx.group.findMany.mock.calls[0][0]).toMatchObject({ where: { id: { gt: GROUP } }, take: 100 });
    expect(tx.group.findMany.mock.calls[0][0].where).not.toHaveProperty('orgId');
    expect(page).toEqual({ items: [], nextCursor: null });
  });

  it('refuses a limit outside 1..500', async () => {
    const { groupsService } = groups(fakeTx());
    await expect(groupsService.listForSystem({ reason: 'retention', limit: 501 })).rejects.toBeInstanceOf(RangeError);
    await expect(groupsService.listForSystem({ reason: 'retention', limit: 0 })).rejects.toBeInstanceOf(RangeError);
  });
});

describe('GroupMembershipService.membersForSystem (#1137)', () => {
  it('refuses an unregistered reason before any query', async () => {
    const tx = fakeTx();
    const { membership } = groups(tx);
    await expect(membership.membersForSystem(GROUP, { reason: 'Bad Reason' })).rejects.toBeInstanceOf(ScopedAccessError);
    expect(tx.groupMember.findMany).not.toHaveBeenCalled();
  });

  it('lists ids and roles only, filtered by role, in the org scope', async () => {
    const tx = fakeTx();
    tx.groupMember.findMany.mockResolvedValue([memberRow(ALICE, 'admin')]);
    const { membership, data } = groups(tx);

    const members = await membership.membersForSystem(GROUP, { reason: 'retention', orgId: ORG, roles: ['admin'] });

    expect(data.scopes).toEqual([{ orgId: ORG }]);
    const args = tx.groupMember.findMany.mock.calls[0][0];
    expect(args.where).toEqual({ groupId: GROUP, orgId: ORG, role: { in: ['admin'] } });
    expect(args.select).not.toHaveProperty('user');
    expect(members).toEqual([{ groupId: GROUP, orgId: ORG, userId: ALICE, role: 'admin', addedById: null, createdAt: new Date('2026-01-01T00:00:00Z') }]);
    // No e-mail or display name leaks into a sweep's result.
    expect(JSON.stringify(members)).not.toContain('@example.com');
  });

  it('without orgId or roles: every member, on the system client', async () => {
    const tx = fakeTx();
    const { membership, data } = groups(tx);
    await membership.membersForSystem(GROUP, { reason: 'retention', roles: [] });
    expect(data.systemReasons).toEqual(['retention']);
    expect(tx.groupMember.findMany.mock.calls[0][0].where).toEqual({ groupId: GROUP });
  });
});
