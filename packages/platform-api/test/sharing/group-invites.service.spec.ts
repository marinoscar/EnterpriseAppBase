// GroupInvitesService (issue #728): read-time expiry, one pending invite per
// address, re-invite after decline or revoke, the invitee's own address only,
// 410 for an expired invite, and the notification only after commit.
import { HttpException } from '@nestjs/common';

import { GroupInvitesService, GroupMembershipService, MemberLookupThrottle, inviteStatus } from '../../src/sharing/index';
import { ALICE, BOB, GROUP, INVITE, ORG, OTHER_ORG, fakeData, fakeEffects, fakeTx, groupRow, memberRow, options, principal, stringsIn, type FakeTx } from './fakes';

const NOW = Date.parse('2026-03-01T00:00:00Z');
const DAY = 86_400_000;

function build(tx: FakeTx, mode: 'single' | 'multi' = 'single', opts = options()) {
  const fx = fakeEffects(tx);
  const data = fakeData(tx);
  const membership = new GroupMembershipService(data, opts, new MemberLookupThrottle(), fx.effects);
  const service = new GroupInvitesService(data, opts, membership, fx.effects, { mode: () => mode }, () => NOW);
  return { service, data, ...fx };
}

function asAdmin(tx: FakeTx) {
  tx.group.findFirst.mockResolvedValue(groupRow());
  tx.groupMember.findUnique.mockImplementation(async ({ where }: { where: { groupId_userId: { userId: string } } }) =>
    where.groupId_userId.userId === ALICE ? memberRow(ALICE, 'admin') : null,
  );
}

function inviteRow(extra: Record<string, unknown> = {}) {
  return {
    id: INVITE,
    groupId: GROUP,
    orgId: ORG,
    email: 'bob@example.com',
    role: 'editor',
    invitedById: ALICE,
    expiresAt: new Date(NOW + DAY),
    acceptedAt: null,
    acceptedById: null,
    declinedAt: null,
    revokedAt: null,
    createdAt: new Date(NOW - DAY),
    ...extra,
  };
}

const bob = (extra = {}) => principal({ userId: BOB, email: 'Bob@Example.com', permissions: ['groups:read'], ...extra });
const reason = (e: unknown) => ((e as HttpException).getResponse() as { details?: { reason?: string } }).details?.reason;

describe('inviteStatus', () => {
  it('derives the status from the timestamps at read time', () => {
    const now = new Date(NOW);
    expect(inviteStatus(inviteRow(), now)).toBe('pending');
    expect(inviteStatus(inviteRow({ expiresAt: null }), now)).toBe('pending');
    expect(inviteStatus(inviteRow({ expiresAt: new Date(NOW) }), now)).toBe('expired');
    expect(inviteStatus(inviteRow({ acceptedAt: now }), now)).toBe('accepted');
    expect(inviteStatus(inviteRow({ declinedAt: now }), now)).toBe('declined');
    expect(inviteStatus(inviteRow({ revokedAt: now }), now)).toBe('revoked');
  });
});

describe('GroupInvitesService.create', () => {
  it('creates a 14-day invite, audits it without the address, and notifies AFTER the commit', async () => {
    const tx = fakeTx();
    asAdmin(tx);
    tx.user.findFirst.mockResolvedValue({ id: BOB, isActive: true });
    tx.membership.findFirst.mockResolvedValue({ userId: BOB });
    let committed = false;
    const { service, data, notifier, emitted } = build(tx);
    const runInOrg = data.runInOrg;
    data.runInOrg = async (scope, fn) => {
      const result = await runInOrg(scope, fn);
      committed = true;
      return result;
    };
    notifier.notify.mockImplementation(async () => {
      expect(committed).toBe(true);
    });

    const invite = await service.create(principal(), GROUP, { email: 'bob@example.com', role: 'editor' });
    expect(invite).toMatchObject({ email: 'bob@example.com', role: 'editor', status: 'pending', expiresAt: new Date(NOW + 14 * DAY).toISOString() });
    expect(tx.groupInvite.create.mock.calls[0][0].data).toMatchObject({ groupId: GROUP, orgId: ORG, email: 'bob@example.com', invitedById: ALICE });
    // Expired pending rows of the address are closed first, so the partial index admits the new one.
    expect(tx.groupInvite.updateMany.mock.calls[0][0]).toEqual({
      where: { groupId: GROUP, email: 'bob@example.com', acceptedAt: null, declinedAt: null, revokedAt: null, expiresAt: { lte: new Date(NOW) } },
      data: { revokedAt: new Date(NOW) },
    });
    const audit = tx.auditEvent.create.mock.calls[0][0].data;
    expect(audit.action).toBe('group:invite_created');
    expect(stringsIn(audit).some((s) => s.includes('@'))).toBe(false);
    expect(notifier.notify).toHaveBeenCalledWith('groups.invitation', BOB, expect.objectContaining({ groupName: 'Family', role: 'editor', recipientEmail: 'bob@example.com' }));
    expect(notifier.notifyAddress).not.toHaveBeenCalled();
    expect(stringsIn(emitted).some((s) => s.includes('@'))).toBe(false);
  });

  it('e-mails an address without an account (notifyAddress), with no expiry when inviteTtlDays is null', async () => {
    const tx = fakeTx();
    asAdmin(tx);
    const { service, notifier } = build(tx, 'single', options({ inviteTtlDays: null }));
    const invite = await service.create(principal(), GROUP, { email: 'new@example.com', role: 'viewer' });
    expect(invite.expiresAt).toBeNull();
    expect(notifier.notifyAddress).toHaveBeenCalledWith('groups.invitation', 'new@example.com', expect.objectContaining({ role: 'viewer' }));
  });

  it('sends no notification when the transaction fails', async () => {
    const tx = fakeTx();
    asAdmin(tx);
    tx.auditEvent.create.mockRejectedValue(new Error('audit down'));
    const { service, notifier, emitted } = build(tx);
    await expect(service.create(principal(), GROUP, { email: 'new@example.com', role: 'viewer' })).rejects.toThrow('audit down');
    expect(notifier.notify).not.toHaveBeenCalled();
    expect(notifier.notifyAddress).not.toHaveBeenCalled();
    expect(emitted).toEqual([]);
  });

  it('409s INVITE_PENDING when the partial unique index refuses a second pending invite', async () => {
    const tx = fakeTx();
    asAdmin(tx);
    tx.groupInvite.create.mockRejectedValue(Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }));
    const { service, notifier } = build(tx);
    expect(reason(await service.create(principal(), GROUP, { email: 'new@example.com', role: 'viewer' }).catch((e) => e))).toBe('INVITE_PENDING');
    expect(notifier.notifyAddress).not.toHaveBeenCalled();
  });

  it('in multi mode refuses an address with neither a membership nor a pending org invite (422)', async () => {
    const tx = fakeTx();
    asAdmin(tx);
    const { service } = build(tx, 'multi');
    expect(reason(await service.create(principal(), GROUP, { email: 'stranger@example.com', role: 'viewer' }).catch((e) => e))).toBe('NOT_AN_ORG_MEMBER');
    tx.invite.findFirst.mockResolvedValue({ orgId: ORG });
    await expect(service.create(principal(), GROUP, { email: 'stranger@example.com', role: 'viewer' })).resolves.toMatchObject({ status: 'pending' });
  });

  it('409s ALREADY_A_MEMBER for an address that is already in the group', async () => {
    const tx = fakeTx();
    asAdmin(tx);
    tx.user.findFirst.mockResolvedValue({ id: BOB, isActive: true });
    tx.membership.findFirst.mockResolvedValue({ userId: BOB });
    tx.groupMember.findUnique.mockImplementation(async () => memberRow(ALICE, 'admin'));
    const { service } = build(tx);
    expect(reason(await service.create(principal(), GROUP, { email: 'bob@example.com', role: 'viewer' }).catch((e) => e))).toBe('ALREADY_A_MEMBER');
  });
});

describe('GroupInvitesService revoke and list', () => {
  it('revokes a pending invite and 409s an answered one', async () => {
    const tx = fakeTx();
    asAdmin(tx);
    tx.groupInvite.findFirst.mockResolvedValue(inviteRow());
    const { service } = build(tx);
    await service.revoke(principal(), GROUP, INVITE);
    expect(tx.groupInvite.update).toHaveBeenCalledWith({ where: { id: INVITE }, data: { revokedAt: new Date(NOW) } });
    tx.groupInvite.findFirst.mockResolvedValue(inviteRow({ declinedAt: new Date(NOW) }));
    expect(reason(await service.revoke(principal(), GROUP, INVITE).catch((e) => e))).toBe('INVITE_NOT_PENDING');
    tx.groupInvite.findFirst.mockResolvedValue(null);
    await expect(service.revoke(principal(), GROUP, INVITE)).rejects.toMatchObject({ status: 404 });
  });

  it('lists pending, unexpired invites by default', async () => {
    const tx = fakeTx();
    asAdmin(tx);
    tx.groupInvite.findMany.mockResolvedValue([inviteRow()]);
    tx.groupInvite.count.mockResolvedValue(1);
    const { service } = build(tx);
    const page = await service.list(principal(), GROUP, { status: 'pending', page: 1, pageSize: 20 });
    expect(page.items[0]).toMatchObject({ status: 'pending' });
    expect(tx.groupInvite.findMany.mock.calls[0][0].where).toEqual({
      groupId: GROUP,
      acceptedAt: null,
      declinedAt: null,
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date(NOW) } }],
    });
  });
});

describe("the invitee's answers", () => {
  it('lists my pending invites in every organization I belong to, by my lower-cased address', async () => {
    const tx = fakeTx();
    tx.groupInvite.findMany
      .mockResolvedValueOnce([{ ...inviteRow(), group: { name: 'Family' } }])
      .mockResolvedValueOnce([{ ...inviteRow({ id: 'x', orgId: OTHER_ORG, createdAt: new Date(NOW) }), group: { name: 'Work' } }]);
    const { service, data } = build(tx);
    const mine = await service.mine(bob({ memberships: [{ orgId: ORG, role: 'viewer' }, { orgId: OTHER_ORG, role: 'viewer' }, { orgId: 'suspended-org', role: 'viewer', status: 'suspended' }] }));
    expect(data.scopes.map((s) => s.orgId)).toEqual([ORG, OTHER_ORG]);
    expect(tx.groupInvite.findMany.mock.calls[0][0].where).toMatchObject({ orgId: ORG, email: 'bob@example.com' });
    expect(mine.items.map((i) => i.groupName)).toEqual(['Work', 'Family']);
    expect(stringsIn(mine).some((s) => s.includes('@'))).toBe(false);
  });

  it('accepting creates the membership with the invite role, audits and invalidates', async () => {
    const tx = fakeTx();
    tx.groupInvite.findFirst.mockResolvedValue(inviteRow());
    tx.groupMember.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => memberRow(BOB, 'editor', data));
    const { service, invalidated, emitted } = build(tx);
    expect(await service.accept(bob(), INVITE)).toEqual({ groupId: GROUP, orgId: ORG, role: 'editor' });
    expect(tx.groupMember.create.mock.calls[0][0].data).toEqual({ groupId: GROUP, orgId: ORG, userId: BOB, role: 'editor', addedById: ALICE });
    expect(tx.groupInvite.update).toHaveBeenCalledWith({ where: { id: INVITE }, data: { acceptedAt: new Date(NOW), acceptedById: BOB } });
    expect(tx.auditEvent.create.mock.calls[0][0].data.action).toBe('group:invite_accepted');
    expect(invalidated).toEqual([[BOB]]);
    expect(emitted.map((e) => e.name)).toEqual(['sharing.group.invite_accepted', 'sharing.group.member_added']);
  });

  it('404s an invite to another address, 410s an expired one, 404s an answered one', async () => {
    const tx = fakeTx();
    const { service } = build(tx);
    tx.groupInvite.findFirst.mockResolvedValue(inviteRow({ email: 'carol@example.com' }));
    await expect(service.accept(bob(), INVITE)).rejects.toMatchObject({ status: 404 });
    tx.groupInvite.findFirst.mockResolvedValue(inviteRow({ expiresAt: new Date(NOW - 1) }));
    const expired = await service.accept(bob(), INVITE).catch((e: HttpException) => e);
    expect((expired as HttpException).getStatus()).toBe(410);
    expect(reason(expired)).toBe('INVITE_EXPIRED');
    tx.groupInvite.findFirst.mockResolvedValue(inviteRow({ revokedAt: new Date(NOW - 1) }));
    await expect(service.decline(bob(), INVITE)).rejects.toMatchObject({ status: 404 });
    tx.groupInvite.findFirst.mockResolvedValue(null);
    await expect(service.accept(bob(), INVITE)).rejects.toMatchObject({ status: 404 });
  });

  it('declining marks the invite declined so the address can be invited again', async () => {
    const tx = fakeTx();
    tx.groupInvite.findFirst.mockResolvedValue(inviteRow());
    const { service } = build(tx);
    await service.decline(bob(), INVITE);
    expect(tx.groupInvite.updateMany).toHaveBeenCalledWith({
      where: { id: INVITE, orgId: ORG, acceptedAt: null, declinedAt: null, revokedAt: null },
      data: { declinedAt: new Date(NOW) },
    });
    expect(tx.auditEvent.create.mock.calls[0][0].data.action).toBe('group:invite_declined');
  });
});
