// Auto-claiming pending group invites (seam #1078): the claim service
// (join, upgrade-only merge, expiry, revocation, per-invite isolation, org
// scope, verified address) and the identity listener (options gate it).
import { Test } from '@nestjs/testing';
import { EventEmitter2, EventEmitterModule } from '@nestjs/event-emitter';

import { IDENTITY_EVENTS } from '../../src/identity/identity.events';
import { SHARING_EVENTS, GroupInvitesService, GroupMembershipService, MemberLookupThrottle, SHARING_OPTIONS, SharingModule } from '../../src/sharing/index';
import { mergeInviteRole } from '../../src/sharing/groups/group-invites.service';
import {
  IDENTITY_LOGIN_SUCCEEDED_EVENT,
  IDENTITY_USER_CREATED_EVENT,
  InviteAutoAcceptListener,
} from '../../src/sharing/groups/invite-auto-accept.listener';
import { ALICE, BOB, GROUP, INVITE, ORG, OTHER_ORG, fakeData, fakeEffects, fakeTx, memberRow, options, type FakeTx } from './fakes';

const NOW = Date.parse('2026-03-01T00:00:00Z');
const DAY = 86_400_000;
const GROUP_2 = '55555555-5555-4555-8555-555555555555';
const INVITE_2 = '66666666-6666-4666-8666-666666666666';

function invite(extra: Record<string, unknown> = {}) {
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

function build(tx: FakeTx, mode: 'single' | 'multi' = 'single', groups: Parameters<typeof options>[0] = {}) {
  const opts = options(groups);
  const fx = fakeEffects(tx);
  const data = fakeData(tx);
  const membership = new GroupMembershipService(data, opts, new MemberLookupThrottle(), fx.effects);
  const service = new GroupInvitesService(data, opts, membership, fx.effects, { mode: () => mode }, () => NOW);
  return { service, data, opts, ...fx };
}

/** Bob exists and has one open invite (found by the system lookup, then re-read per claim). */
function withBobInvite(tx: FakeTx, row = invite(), user: Record<string, unknown> = {}) {
  tx.user.findFirst.mockResolvedValue({ id: BOB, email: 'Bob@Example.com', isActive: true, ...user });
  tx.groupInvite.findMany.mockResolvedValue([{ id: row.id, orgId: row.orgId }]);
  tx.groupInvite.findFirst.mockResolvedValue(row);
}

describe('mergeInviteRole', () => {
  it('upgrade-only never lowers, replace always sets, keep never changes', () => {
    expect(mergeInviteRole('upgrade-only', 'viewer', 'editor')).toBe('editor');
    expect(mergeInviteRole('upgrade-only', 'admin', 'viewer')).toBe('admin');
    expect(mergeInviteRole('upgrade-only', 'editor', 'editor')).toBe('editor');
    expect(mergeInviteRole('replace', 'admin', 'viewer')).toBe('viewer');
    expect(mergeInviteRole('keep', 'viewer', 'admin')).toBe('viewer');
  });
});

describe('GroupInvitesService.claimPendingForEmail', () => {
  it('joins the group with the invite role, accepts the invite, and emits after the commits', async () => {
    const tx = fakeTx();
    withBobInvite(tx);
    const { service, data, emitted, invalidated, metrics } = build(tx);

    const result = await service.claimPendingForEmail(BOB, 'BOB@example.com');

    expect(result).toEqual({ joined: [GROUP], upgraded: [], skipped: [] });
    expect(data.systemReasons).toEqual(['invite-claim']);
    expect(data.scopes).toEqual([{ orgId: ORG, userId: BOB }]);
    // Discovery matches the lower-cased address, open and unexpired, only.
    expect(tx.groupInvite.findMany.mock.calls[0][0].where).toMatchObject({
      email: 'bob@example.com',
      acceptedAt: null,
      declinedAt: null,
      revokedAt: null,
    });
    expect(tx.groupMember.create.mock.calls[0][0].data).toMatchObject({ groupId: GROUP, orgId: ORG, userId: BOB, role: 'editor', addedById: ALICE });
    expect(tx.groupInvite.update.mock.calls[0][0]).toEqual({ where: { id: INVITE }, data: { acceptedAt: new Date(NOW), acceptedById: BOB } });
    expect(tx.auditEvent.create.mock.calls[0][0].data).toMatchObject({ action: 'group:invite_auto_accepted', orgId: ORG, actorUserId: BOB });
    expect(JSON.stringify(tx.auditEvent.create.mock.calls[0][0].data.meta)).not.toContain('@');
    expect(emitted.map((e) => e.name)).toEqual([SHARING_EVENTS.INVITE_ACCEPTED, SHARING_EVENTS.MEMBER_ADDED, SHARING_EVENTS.INVITE_AUTO_ACCEPTED]);
    expect(emitted[2]!.payload).toMatchObject({ orgId: ORG, groupId: GROUP, inviteId: INVITE, userId: BOB, outcome: 'joined', previousRole: null, memberRole: 'editor' });
    expect(JSON.stringify(emitted)).not.toContain('@');
    expect(invalidated).toEqual([[BOB]]);
    expect(metrics.add).toHaveBeenCalledWith('sharingGroupMutations', 1, { op: 'invite_auto_accept' });
  });

  it('upgrades an existing member and never downgrades one', async () => {
    const up = fakeTx();
    withBobInvite(up, invite({ role: 'admin' }));
    up.groupMember.findUnique.mockResolvedValue(memberRow(BOB, 'viewer'));
    const upgraded = build(up);
    expect(await upgraded.service.claimPendingForEmail(BOB, 'bob@example.com')).toEqual({ joined: [], upgraded: [GROUP], skipped: [] });
    expect(up.groupMember.update.mock.calls[0][0].data).toEqual({ role: 'admin' });
    expect(upgraded.emitted.map((e) => e.name)).toEqual([
      SHARING_EVENTS.INVITE_ACCEPTED,
      SHARING_EVENTS.MEMBER_ROLE_CHANGED,
      SHARING_EVENTS.INVITE_AUTO_ACCEPTED,
    ]);
    expect(upgraded.emitted[1]!.payload).toMatchObject({ role: 'admin', previousRole: 'viewer' });

    const down = fakeTx();
    withBobInvite(down, invite({ role: 'viewer' }));
    down.groupMember.findUnique.mockResolvedValue(memberRow(BOB, 'admin'));
    const kept = build(down);
    // The invite is consumed, the role stays, and it is reported as skipped.
    expect(await kept.service.claimPendingForEmail(BOB, 'bob@example.com')).toEqual({ joined: [], upgraded: [], skipped: [INVITE] });
    expect(down.groupMember.update).not.toHaveBeenCalled();
    expect(down.groupInvite.update).toHaveBeenCalled();
    expect(kept.emitted.map((e) => e.name)).toEqual([SHARING_EVENTS.INVITE_ACCEPTED, SHARING_EVENTS.INVITE_AUTO_ACCEPTED]);
  });

  it('honours inviteRoleMerge replace and keep', async () => {
    const replace = fakeTx();
    withBobInvite(replace, invite({ role: 'viewer' }));
    replace.groupMember.findUnique.mockResolvedValue(memberRow(BOB, 'admin'));
    expect((await build(replace, 'single', { inviteRoleMerge: 'replace' }).service.claimPendingForEmail(BOB, 'bob@example.com')).upgraded).toEqual([GROUP]);
    expect(replace.groupMember.update.mock.calls[0][0].data).toEqual({ role: 'viewer' });

    const keep = fakeTx();
    withBobInvite(keep, invite({ role: 'admin' }));
    keep.groupMember.findUnique.mockResolvedValue(memberRow(BOB, 'viewer'));
    expect((await build(keep, 'single', { inviteRoleMerge: 'keep' }).service.claimPendingForEmail(BOB, 'bob@example.com')).skipped).toEqual([INVITE]);
    expect(keep.groupMember.update).not.toHaveBeenCalled();
  });

  it('skips expired and revoked invites (the lookup excludes them; a race under the lock claims nothing)', async () => {
    const tx = fakeTx();
    withBobInvite(tx);
    const { service, emitted } = build(tx);
    await service.claimPendingForEmail(BOB, 'bob@example.com');
    const where = tx.groupInvite.findMany.mock.calls[0][0].where;
    expect(where.OR).toEqual([{ expiresAt: null }, { expiresAt: { gt: new Date(NOW) } }]);

    // Revoked between the lookup and the claim: the re-read under the lock finds nothing.
    const raced = fakeTx();
    withBobInvite(raced);
    raced.groupInvite.findFirst.mockResolvedValue(null);
    const r = build(raced);
    expect(await r.service.claimPendingForEmail(BOB, 'bob@example.com')).toEqual({ joined: [], upgraded: [], skipped: [] });
    expect(raced.groupMember.create).not.toHaveBeenCalled();
    expect(r.emitted).toEqual([]);
    expect(emitted.length).toBeGreaterThan(0);
  });

  it('claims nothing for an inactive user, an unknown user, or an address that is not the user\'s', async () => {
    for (const setup of [
      (tx: FakeTx) => withBobInvite(tx, invite(), { isActive: false }),
      (tx: FakeTx) => {
        withBobInvite(tx);
        tx.user.findFirst.mockResolvedValue(null);
      },
      (tx: FakeTx) => withBobInvite(tx, invite(), { email: 'someone-else@example.com' }),
    ]) {
      const tx = fakeTx();
      setup(tx);
      const { service } = build(tx);
      expect(await service.claimPendingForEmail(BOB, 'bob@example.com')).toEqual({ joined: [], upgraded: [], skipped: [] });
      expect(tx.groupInvite.findMany).not.toHaveBeenCalled();
      expect(tx.groupMember.create).not.toHaveBeenCalled();
    }
  });

  it('one failing invite does not block the others; each runs in its own organization', async () => {
    const tx = fakeTx();
    tx.user.findFirst.mockResolvedValue({ id: BOB, email: 'bob@example.com', isActive: true });
    const rows = [invite(), invite({ id: INVITE_2, groupId: GROUP_2, orgId: OTHER_ORG })];
    tx.groupInvite.findMany.mockResolvedValue(rows.map((r) => ({ id: r.id, orgId: r.orgId })));
    tx.groupInvite.findFirst.mockImplementation(async ({ where }: { where: { id: string } }) => rows.find((r) => r.id === where.id) ?? null);
    tx.groupMember.create.mockRejectedValueOnce(new Error('boom'));
    const { service, data, emitted } = build(tx);

    const result = await service.claimPendingForEmail(BOB, 'bob@example.com');

    expect(result).toEqual({ joined: [GROUP_2], upgraded: [], skipped: [INVITE] });
    expect(data.scopes).toEqual([
      { orgId: ORG, userId: BOB },
      { orgId: OTHER_ORG, userId: BOB },
    ]);
    expect(emitted.filter((e) => e.name === SHARING_EVENTS.INVITE_AUTO_ACCEPTED)).toHaveLength(1);
    expect(emitted.every((e) => (e.payload as { orgId: string }).orgId === OTHER_ORG)).toBe(true);
  });

  it('leaves an invite pending when the group is full, and (multi mode) when the org is not joined yet', async () => {
    const full = fakeTx();
    withBobInvite(full);
    full.groupMember.count.mockResolvedValue(1000);
    expect(await build(full).service.claimPendingForEmail(BOB, 'bob@example.com')).toEqual({ joined: [], upgraded: [], skipped: [INVITE] });
    expect(full.groupInvite.update).not.toHaveBeenCalled();

    const multi = fakeTx();
    withBobInvite(multi);
    multi.membership.findFirst.mockResolvedValue(null);
    expect(await build(multi, 'multi').service.claimPendingForEmail(BOB, 'bob@example.com')).toEqual({ joined: [], upgraded: [], skipped: [INVITE] });
    expect(multi.groupMember.create).not.toHaveBeenCalled();

    multi.membership.findFirst.mockResolvedValue({ userId: BOB });
    expect((await build(multi, 'multi').service.claimPendingForEmail(BOB, 'bob@example.com')).joined).toEqual([GROUP]);
  });

  it('limits the claim to one organization on request', async () => {
    const tx = fakeTx();
    withBobInvite(tx);
    await build(tx).service.claimPendingForEmail(BOB, 'bob@example.com', { orgId: ORG });
    expect(tx.groupInvite.findMany.mock.calls[0][0].where.orgId).toBe(ORG);
  });

  it('claimPendingForUser reads the address from the user record', async () => {
    const tx = fakeTx();
    withBobInvite(tx);
    expect(await build(tx).service.claimPendingForUser(BOB)).toEqual({ joined: [GROUP], upgraded: [], skipped: [] });
  });
});

describe('InviteAutoAcceptListener', () => {
  function listener(groups: Parameters<typeof options>[0]) {
    const invites = {
      claimPendingForEmail: jest.fn().mockResolvedValue({ joined: [GROUP], upgraded: [], skipped: [] }),
      claimPendingForUser: jest.fn().mockResolvedValue({ joined: [], upgraded: [], skipped: [] }),
    };
    return { invites, listener: new InviteAutoAcceptListener(invites as never, options(groups)) };
  }

  it('listens to identity\'s event names', () => {
    expect(IDENTITY_USER_CREATED_EVENT).toBe(IDENTITY_EVENTS.USER_CREATED);
    expect(IDENTITY_LOGIN_SUCCEEDED_EVENT).toBe(IDENTITY_EVENTS.LOGIN_SUCCEEDED);
  });

  it('does nothing with the options off', async () => {
    const { invites, listener: l } = listener({});
    await l.onUserCreated({ userId: BOB, email: 'bob@example.com' });
    await l.onLoginSucceeded({ userId: BOB });
    expect(invites.claimPendingForEmail).not.toHaveBeenCalled();
    expect(invites.claimPendingForUser).not.toHaveBeenCalled();
  });

  it('claims at sign-up with the signup option and at sign-in with the sign-in option', async () => {
    const up = listener({ autoAcceptInvitesOnSignup: true });
    await up.listener.onUserCreated({ userId: BOB, email: 'bob@example.com' });
    await up.listener.onLoginSucceeded({ userId: BOB });
    expect(up.invites.claimPendingForEmail).toHaveBeenCalledWith(BOB, 'bob@example.com');
    expect(up.invites.claimPendingForUser).not.toHaveBeenCalled();

    const inn = listener({ autoAcceptInvitesOnSignIn: true });
    await inn.listener.onUserCreated({ userId: BOB, email: 'bob@example.com' });
    await inn.listener.onLoginSucceeded({ userId: BOB });
    expect(inn.invites.claimPendingForUser).toHaveBeenCalledWith(BOB);
    expect(inn.invites.claimPendingForEmail).not.toHaveBeenCalled();
  });

  it('never throws, so a sign-in cannot fail because of a claim', async () => {
    const { invites, listener: l } = listener({ autoAcceptInvitesOnSignup: true, autoAcceptInvitesOnSignIn: true });
    invites.claimPendingForEmail.mockRejectedValue(new Error('db down'));
    invites.claimPendingForUser.mockRejectedValue(new Error('db down'));
    await expect(l.onUserCreated({ userId: BOB, email: 'bob@example.com' })).resolves.toBeUndefined();
    await expect(l.onLoginSucceeded({ userId: BOB })).resolves.toBeUndefined();
  });

  it('is registered by the module only when an option is on', () => {
    const providers = (groups: Parameters<typeof options>[0]) =>
      ((SharingModule.forRoot({ host: options().host, groups }).providers ?? []) as unknown[]).includes(InviteAutoAcceptListener);
    expect(providers({})).toBe(false);
    expect(providers({ autoAcceptInvitesOnSignup: true })).toBe(true);
    expect(providers({ autoAcceptInvitesOnSignIn: true })).toBe(true);
  });

  it('is wired to identity\'s real events through @nestjs/event-emitter: first sign-in claims, option off does not', async () => {
    async function app(groups: Parameters<typeof options>[0]) {
      const invites = {
        claimPendingForEmail: jest.fn().mockResolvedValue({ joined: [], upgraded: [], skipped: [] }),
        claimPendingForUser: jest.fn().mockResolvedValue({ joined: [], upgraded: [], skipped: [] }),
      };
      const ref = await Test.createTestingModule({
        imports: [EventEmitterModule.forRoot()],
        providers: [
          InviteAutoAcceptListener,
          { provide: GroupInvitesService, useValue: invites },
          { provide: SHARING_OPTIONS, useValue: options(groups) },
        ],
      }).compile();
      await ref.init();
      return { invites, emitter: ref.get(EventEmitter2) };
    }
    const on = await app({ autoAcceptInvitesOnSignup: true, autoAcceptInvitesOnSignIn: true });
    await on.emitter.emitAsync(IDENTITY_EVENTS.USER_CREATED, { userId: BOB, email: 'bob@example.com', source: 'google', orgId: ORG });
    await on.emitter.emitAsync(IDENTITY_EVENTS.LOGIN_SUCCEEDED, { userId: BOB, provider: 'google', isNewUser: true });
    expect(on.invites.claimPendingForEmail).toHaveBeenCalledWith(BOB, 'bob@example.com');
    expect(on.invites.claimPendingForUser).toHaveBeenCalledWith(BOB);

    const off = await app({});
    await off.emitter.emitAsync(IDENTITY_EVENTS.USER_CREATED, { userId: BOB, email: 'bob@example.com', source: 'google', orgId: ORG });
    await off.emitter.emitAsync(IDENTITY_EVENTS.LOGIN_SUCCEEDED, { userId: BOB, provider: 'google', isNewUser: true });
    expect(off.invites.claimPendingForEmail).not.toHaveBeenCalled();
    expect(off.invites.claimPendingForUser).not.toHaveBeenCalled();
  });
});
