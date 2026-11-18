// GroupsService (issue #728): create with the creator as admin atomically,
// list scopes, If-Match, and deletion refused while the group owns resources.
import { HttpException } from '@nestjs/common';

import { withTemporaryEntries } from '../../src/core/registry/testing';
import { GroupMembershipService, GroupsService, MemberLookupThrottle, groupOwnedResourceRegistry } from '../../src/sharing/index';
import { ALICE, BOB, GROUP, ORG, fakeData, fakeEffects, fakeTx, groupRow, memberRow, options, principal, type FakeTx } from './fakes';

function build(tx: FakeTx, opts = options()) {
  const fx = fakeEffects(tx);
  const data = fakeData(tx);
  const membership = new GroupMembershipService(data, opts, new MemberLookupThrottle(), fx.effects);
  return { service: new GroupsService(data, opts, membership, fx.effects), data, ...fx };
}

function asMember(tx: FakeTx, role: 'admin' | 'editor' | 'viewer' | null) {
  tx.group.findFirst.mockResolvedValue(groupRow());
  tx.groupMember.findUnique.mockResolvedValue(role ? memberRow(ALICE, role) : null);
}

const reason = (e: unknown) => ((e as HttpException).getResponse() as { details?: { reason?: string } }).details?.reason;

describe('GroupsService', () => {
  it('creates the group and the creator admin membership in ONE transaction, then audits and emits', async () => {
    const tx = fakeTx();
    tx.group.create.mockResolvedValue(groupRow({ version: 1 }));
    const { service, data, invalidated, emitted } = build(tx);

    const group = await service.create(principal(), { name: 'Family', description: 'Us' });
    expect(group).toMatchObject({ id: GROUP, orgId: ORG, myRole: 'admin', memberCount: 1, version: 1 });
    expect(data.scopes).toEqual([{ orgId: ORG, userId: ALICE }]);
    expect(tx.group.create.mock.calls[0][0].data).toEqual({ orgId: ORG, name: 'Family', description: 'Us', createdById: ALICE });
    expect(tx.groupMember.create.mock.calls[0][0].data).toEqual({ groupId: GROUP, orgId: ORG, userId: ALICE, role: 'admin', addedById: ALICE });
    expect(tx.auditEvent.create.mock.calls[0][0].data).toMatchObject({ action: 'group:created', orgId: ORG, actorUserId: ALICE, targetId: GROUP });
    expect(invalidated).toEqual([[ALICE]]);
    expect(emitted.map((e) => e.name)).toEqual(['sharing.group.created', 'sharing.group.member_added']);
  });

  it('emits nothing when the transaction fails', async () => {
    const tx = fakeTx();
    tx.group.create.mockResolvedValue(groupRow());
    tx.groupMember.create.mockRejectedValue(new Error('boom'));
    const { service, emitted, invalidated } = build(tx);
    await expect(service.create(principal(), { name: 'Family' })).rejects.toThrow('boom');
    expect(emitted).toEqual([]);
    expect(invalidated).toEqual([]);
  });

  it('409s GROUP_LIMIT_REACHED at maxGroupsPerCreator', async () => {
    const tx = fakeTx();
    tx.group.count.mockResolvedValue(2);
    const { service } = build(tx, options({ maxGroupsPerCreator: 2 }));
    expect(reason(await service.create(principal(), { name: 'x' }).catch((e) => e))).toBe('GROUP_LIMIT_REACHED');
  });

  it('lists my groups by default and every group only for groups:admin', async () => {
    const tx = fakeTx();
    tx.group.count.mockResolvedValue(1);
    tx.group.findMany.mockResolvedValue([{ ...groupRow(), _count: { members: 3 }, members: [{ role: 'editor' }] }]);
    const { service } = build(tx);

    const mine = await service.list(principal(), { scope: 'mine', page: 1, pageSize: 20 });
    expect(mine).toMatchObject({ total: 1, totalPages: 1, items: [{ id: GROUP, myRole: 'editor', memberCount: 3 }] });
    expect(tx.group.findMany.mock.calls[0][0].where).toEqual({ orgId: ORG, members: { some: { userId: ALICE } } });

    await expect(service.list(principal(), { scope: 'all', page: 1, pageSize: 20 })).rejects.toMatchObject({ status: 403 });
    await service.list(principal({ permissions: ['groups:read', 'groups:admin'] }), { scope: 'all', page: 2, pageSize: 10 });
    expect(tx.group.findMany.mock.calls[1][0]).toMatchObject({ where: { orgId: ORG }, skip: 10, take: 10 });
  });

  it('404s a non-member and 200s a groups:admin holder on GET', async () => {
    const tx = fakeTx();
    asMember(tx, null);
    const { service } = build(tx);
    await expect(service.get(principal(), GROUP)).rejects.toMatchObject({ status: 404 });
    tx.groupMember.count.mockResolvedValue(4);
    expect(await service.get(principal({ permissions: ['groups:read', 'groups:admin'] }), GROUP)).toMatchObject({ id: GROUP, myRole: null, memberCount: 4 });
  });

  describe('update', () => {
    it('applies If-Match: a stale version is 409 VERSION_CONFLICT', async () => {
      const tx = fakeTx();
      asMember(tx, 'admin');
      tx.group.updateMany.mockResolvedValue({ count: 0 });
      const { service } = build(tx);
      expect(reason(await service.update(principal(), GROUP, { name: 'New' }, 2).catch((e) => e))).toBe('VERSION_CONFLICT');
      expect(tx.group.updateMany.mock.calls[0][0]).toMatchObject({ where: { id: GROUP, orgId: ORG, version: 2 }, data: { name: 'New', version: { increment: 1 } } });
    });

    it('updates for a group admin, clears metadata with SQL NULL, and audits the field names', async () => {
      const tx = fakeTx();
      asMember(tx, 'admin');
      tx.group.findFirst.mockResolvedValueOnce(groupRow()).mockResolvedValueOnce(groupRow({ name: 'New', version: 4 }));
      const { service } = build(tx);
      const updated = await service.update(principal(), GROUP, { name: 'New', metadata: null });
      expect(updated).toMatchObject({ name: 'New', version: 4 });
      expect(tx.group.updateMany.mock.calls[0][0].where.version).toBe(3);
      expect(tx.$executeRaw).toHaveBeenCalled();
      expect(tx.auditEvent.create.mock.calls[0][0].data.meta).toMatchObject({ fields: 'metadata,name', version: 4 });
    });

    it('403s an editor and 404s a non-member', async () => {
      const tx = fakeTx();
      asMember(tx, 'editor');
      const { service } = build(tx);
      await expect(service.update(principal(), GROUP, { name: 'x' })).rejects.toMatchObject({ status: 403 });
      asMember(tx, null);
      await expect(service.update(principal(), GROUP, { name: 'x' })).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('delete', () => {
    it('refuses while a registered resource type still has rows (409 with per-type counts)', async () => {
      const tx = fakeTx();
      asMember(tx, 'admin');
      const { service, emitted } = build(tx);
      const seen: unknown[] = [];
      await withTemporaryEntries(
        groupOwnedResourceRegistry,
        [
          { type: 'album', countOwnedByGroup: async (groupId: string, client: unknown) => (seen.push([groupId, client]), 2) },
          { type: 'note', countOwnedByGroup: async () => 0 },
        ],
        async () => {
          const error = await service.delete(principal(), GROUP).catch((e: HttpException) => e);
          expect((error as HttpException).getStatus()).toBe(409);
          expect((error as HttpException).getResponse()).toMatchObject({ details: { reason: 'GROUP_OWNS_RESOURCES', counts: { album: 2 } } });
        },
      );
      expect(seen).toEqual([[GROUP, tx]]);
      expect(tx.group.delete).not.toHaveBeenCalled();
      expect(emitted).toEqual([]);
    });

    it('deletes a group that owns nothing and invalidates every former member', async () => {
      const tx = fakeTx();
      asMember(tx, 'admin');
      tx.groupMember.findMany.mockResolvedValue([{ userId: ALICE }, { userId: BOB }]);
      const { service, invalidated, emitted } = build(tx);
      await service.delete(principal(), GROUP);
      expect(tx.group.delete).toHaveBeenCalledWith({ where: { id: GROUP } });
      expect(tx.auditEvent.create.mock.calls[0][0].data).toMatchObject({ action: 'group:deleted', meta: { groupId: GROUP, members: 2 } });
      expect(invalidated).toEqual([[ALICE, BOB]]);
      expect(emitted).toEqual([{ name: 'sharing.group.deleted', payload: { orgId: ORG, groupId: GROUP, actorUserId: ALICE } }]);
    });
  });
});
