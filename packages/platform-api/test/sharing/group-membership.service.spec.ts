// GroupMembershipService (issue #728): access decisions (404 non-disclosure,
// the groups:admin override), role ranking, the last-admin rule, the lookup
// throttle and the after-commit effects.
import { ForbiddenException, HttpException, NotFoundException } from '@nestjs/common';

import { GroupMembershipService, MemberLookupThrottle } from '../../src/sharing/index';
import {
  ALICE,
  BOB,
  CAROL,
  GROUP,
  ORG,
  fakeData,
  fakeEffects,
  fakeTx,
  groupRow,
  memberRow,
  options,
  principal,
  stringsIn,
  type FakeTx,
} from './fakes';

function build(tx: FakeTx, opts = options(), throttle = new MemberLookupThrottle()) {
  const fx = fakeEffects(tx);
  const service = new GroupMembershipService(fakeData(tx), opts, throttle, fx.effects);
  return { service, ...fx, throttle };
}

/** The caller's own membership lookup answers `role`; another user's answers from `others`. */
function withMembers(tx: FakeTx, me: 'admin' | 'editor' | 'viewer' | null, others: Record<string, 'admin' | 'editor' | 'viewer'> = {}) {
  tx.group.findFirst.mockResolvedValue(groupRow());
  tx.groupMember.findUnique.mockImplementation(async ({ where }: { where: { groupId_userId: { userId: string } } }) => {
    const userId = where.groupId_userId.userId;
    if (userId === ALICE) return me ? memberRow(ALICE, me) : null;
    return others[userId] ? memberRow(userId, others[userId]) : null;
  });
}

async function status(promise: Promise<unknown>): Promise<number> {
  try {
    await promise;
    return 200;
  } catch (error) {
    return error instanceof HttpException ? error.getStatus() : 500;
  }
}

describe('GroupMembershipService.access', () => {
  it('404s a group of another organization or a missing one, whoever asks', async () => {
    const tx = fakeTx();
    const { service } = build(tx);
    await expect(service.access(tx as never, principal({ permissions: ['groups:admin'] }), ORG, GROUP, 'member')).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.group.findFirst.mock.calls[0][0].where).toEqual({ id: GROUP, orgId: ORG });
  });

  it('404s (never 403s) a non-member, and lets a groups:admin holder through', async () => {
    const tx = fakeTx();
    withMembers(tx, null);
    const { service } = build(tx);
    await expect(service.access(tx as never, principal(), ORG, GROUP, 'member')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.access(tx as never, principal(), ORG, GROUP, 'admin')).rejects.toBeInstanceOf(NotFoundException);
    const admin = await service.access(tx as never, principal({ permissions: ['groups:read', 'groups:admin'] }), ORG, GROUP, 'admin');
    expect(admin.myRole).toBeNull();
  });

  it('403s a member below admin for an admin action', async () => {
    const tx = fakeTx();
    withMembers(tx, 'editor');
    const { service } = build(tx);
    expect((await service.access(tx as never, principal(), ORG, GROUP, 'member')).myRole).toBe('editor');
    await expect(service.access(tx as never, principal(), ORG, GROUP, 'admin')).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('GroupMembershipService members', () => {
  it('refuses a caller with no active organization (403)', async () => {
    const { service } = build(fakeTx());
    expect(await status(service.list(principal({ activeOrgId: undefined }), GROUP, { page: 1, pageSize: 20 }))).toBe(403);
  });

  it('lists members admins first, paged', async () => {
    const tx = fakeTx();
    withMembers(tx, 'viewer');
    tx.groupMember.count.mockResolvedValue(2);
    tx.groupMember.findMany.mockResolvedValue([memberRow(BOB, 'admin'), memberRow(ALICE, 'viewer')]);
    const { service } = build(tx);
    const page = await service.list(principal(), GROUP, { page: 1, pageSize: 20 });
    expect(page).toMatchObject({ total: 2, page: 1, pageSize: 20, totalPages: 1 });
    expect(page.items.map((m) => [m.userId, m.role])).toEqual([[BOB, 'admin'], [ALICE, 'viewer']]);
    expect(tx.groupMember.findMany.mock.calls[0][0].orderBy).toEqual([{ role: 'asc' }, { createdAt: 'asc' }]);
  });

  describe('add', () => {
    function orgMember(tx: FakeTx, present: boolean) {
      tx.user.findFirst.mockResolvedValue(present ? { id: CAROL, email: 'carol@example.com', displayName: null, providerDisplayName: null, isActive: true } : null);
      tx.user.findUnique.mockResolvedValue(present ? { id: CAROL, email: 'carol@example.com', displayName: null, providerDisplayName: null, isActive: true } : null);
      tx.membership.findFirst.mockResolvedValue(present ? { userId: CAROL } : null);
    }

    it('adds an org member by e-mail, audited without the address, then invalidates and emits', async () => {
      const tx = fakeTx();
      withMembers(tx, 'admin');
      orgMember(tx, true);
      tx.groupMember.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => memberRow(CAROL, data.role as 'editor', data));
      const { service, invalidated, emitted, metrics } = build(tx);

      const member = await service.add(principal(), GROUP, { email: 'carol@example.com', role: 'editor' });
      expect(member).toMatchObject({ userId: CAROL, role: 'editor' });
      expect(tx.groupMember.create.mock.calls[0][0].data).toEqual({ groupId: GROUP, orgId: ORG, userId: CAROL, role: 'editor', addedById: ALICE });
      expect(tx.membership.findFirst.mock.calls[0][0].where).toEqual({ orgId: ORG, userId: CAROL, status: 'active' });
      expect(tx.$queryRaw).toHaveBeenCalled(); // the group row lock
      const audit = tx.auditEvent.create.mock.calls[0][0].data;
      expect(audit).toMatchObject({ action: 'group:member_added', orgId: ORG, targetType: 'group', targetId: GROUP });
      expect(stringsIn(audit).some((s) => s.includes('@'))).toBe(false);
      expect(invalidated).toEqual([[CAROL]]);
      expect(emitted).toEqual([
        { name: 'sharing.group.member_added', payload: { orgId: ORG, groupId: GROUP, actorUserId: ALICE, userId: CAROL, role: 'editor', previousRole: null } },
      ]);
      expect(stringsIn(emitted).some((s) => s.includes('@'))).toBe(false);
      expect(metrics.add).toHaveBeenCalledWith('sharingGroupMutations', 1, { op: 'member_add' });
    });

    it('422s a person outside the organization, and counts e-mail misses until 429', async () => {
      const tx = fakeTx();
      withMembers(tx, 'admin');
      orgMember(tx, false);
      const throttle = new MemberLookupThrottle({ maxMisses: 2 });
      const { service, emitted } = build(tx, options(), throttle);
      expect(await status(service.add(principal(), GROUP, { email: 'nobody@example.com', role: 'viewer' }))).toBe(422);
      expect(await status(service.add(principal(), GROUP, { email: 'nobody2@example.com', role: 'viewer' }))).toBe(422);
      const error = await service.add(principal(), GROUP, { email: 'x@example.com', role: 'viewer' }).catch((e: HttpException) => e);
      expect((error as HttpException).getStatus()).toBe(429);
      expect((error as HttpException).getResponse()).toMatchObject({ details: { reason: 'LOOKUP_THROTTLED', retryAfterMs: expect.any(Number) } });
      // A lookup by user id is not throttled.
      expect(await status(service.add(principal(), GROUP, { userId: CAROL, role: 'viewer' }))).toBe(422);
      expect(emitted).toEqual([]);
    });

    it('does not count a miss for a non-admin (403) or an existing member (409)', async () => {
      const tx = fakeTx();
      withMembers(tx, 'viewer');
      const throttle = new MemberLookupThrottle({ maxMisses: 1 });
      const { service } = build(tx, options(), throttle);
      expect(await status(service.add(principal(), GROUP, { email: 'carol@example.com', role: 'viewer' }))).toBe(403);
      expect(throttle.size()).toBe(0);

      withMembers(tx, 'admin', { [CAROL]: 'viewer' });
      orgMember(tx, true);
      const conflict = await service.add(principal(), GROUP, { email: 'carol@example.com', role: 'viewer' }).catch((e: HttpException) => e);
      expect((conflict as HttpException).getResponse()).toMatchObject({ details: { reason: 'ALREADY_A_MEMBER' } });
    });

    it('409s GROUP_FULL at maxMembersPerGroup', async () => {
      const tx = fakeTx();
      withMembers(tx, 'admin');
      orgMember(tx, true);
      tx.groupMember.count.mockResolvedValue(2);
      const { service } = build(tx, options({ maxMembersPerGroup: 2 }));
      const error = await service.add(principal(), GROUP, { userId: CAROL, role: 'viewer' }).catch((e: HttpException) => e);
      expect((error as HttpException).getResponse()).toMatchObject({ details: { reason: 'GROUP_FULL' } });
    });
  });

  describe('the last-admin rule', () => {
    it('refuses to demote the last admin (409 LAST_GROUP_ADMIN)', async () => {
      const tx = fakeTx();
      withMembers(tx, 'admin');
      tx.groupMember.count.mockResolvedValue(1);
      const { service, emitted } = build(tx);
      const error = await service.changeRole(principal(), GROUP, ALICE, 'editor').catch((e: HttpException) => e);
      expect((error as HttpException).getStatus()).toBe(409);
      expect((error as HttpException).getResponse()).toMatchObject({ details: { reason: 'LAST_GROUP_ADMIN' } });
      expect(tx.groupMember.update).not.toHaveBeenCalled();
      expect(emitted).toEqual([]);
    });

    it('lets the last admin promote another member, after which demotion works', async () => {
      const tx = fakeTx();
      withMembers(tx, 'admin', { [BOB]: 'editor' });
      tx.groupMember.update.mockImplementation(async ({ data }: { data: { role: 'admin' } }) => memberRow(BOB, data.role));
      const { service, invalidated, emitted } = build(tx);
      expect(await service.changeRole(principal(), GROUP, BOB, 'admin')).toMatchObject({ userId: BOB, role: 'admin' });
      expect(invalidated).toEqual([[BOB]]);
      expect(emitted[0]).toEqual({
        name: 'sharing.group.member_role_changed',
        payload: { orgId: ORG, groupId: GROUP, actorUserId: ALICE, userId: BOB, role: 'admin', previousRole: 'editor' },
      });

      tx.groupMember.count.mockResolvedValue(2); // two admins now
      tx.groupMember.update.mockImplementation(async () => memberRow(ALICE, 'editor'));
      expect(await service.changeRole(principal(), GROUP, ALICE, 'editor')).toMatchObject({ userId: ALICE, role: 'editor' });
      expect(tx.auditEvent.create.mock.calls.map(([a]: [{ data: { action: string } }]) => a.data.action)).toEqual([
        'group:member_role_changed',
        'group:member_role_changed',
      ]);
    });

    it('treats an unchanged role as a no-op (no audit, no event)', async () => {
      const tx = fakeTx();
      withMembers(tx, 'admin', { [BOB]: 'viewer' });
      const { service, emitted } = build(tx);
      await service.changeRole(principal(), GROUP, BOB, 'viewer');
      expect(tx.auditEvent.create).not.toHaveBeenCalled();
      expect(emitted).toEqual([]);
    });

    it('refuses to let the last admin leave', async () => {
      const tx = fakeTx();
      withMembers(tx, 'admin');
      tx.groupMember.count.mockResolvedValue(1);
      const { service } = build(tx);
      expect(await status(service.remove(principal(), GROUP, ALICE))).toBe(409);
      expect(tx.groupMember.delete).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('lets a viewer leave with groups:read only', async () => {
      const tx = fakeTx();
      withMembers(tx, 'viewer');
      const { service, invalidated, emitted } = build(tx);
      await service.remove(principal({ permissions: ['groups:read'] }), GROUP, ALICE);
      expect(tx.groupMember.delete).toHaveBeenCalled();
      expect(tx.auditEvent.create.mock.calls[0][0].data.meta).toMatchObject({ userId: ALICE, self: true });
      expect(invalidated).toEqual([[ALICE]]);
      expect(emitted[0]?.name).toBe('sharing.group.member_removed');
    });

    it('needs groups:write to remove someone else (403), and the admin role', async () => {
      const tx = fakeTx();
      withMembers(tx, 'admin', { [BOB]: 'viewer' });
      const { service } = build(tx);
      expect(await status(service.remove(principal({ permissions: ['groups:read'] }), GROUP, BOB))).toBe(403);
      withMembers(tx, 'editor', { [BOB]: 'viewer' });
      expect(await status(service.remove(principal(), GROUP, BOB))).toBe(403);
      withMembers(tx, 'admin', { [BOB]: 'viewer' });
      expect(await status(service.remove(principal(), GROUP, BOB))).toBe(200);
      expect(await status(service.remove(principal(), GROUP, CAROL))).toBe(404);
    });
  });
});
