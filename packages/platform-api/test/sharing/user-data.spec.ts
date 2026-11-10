// The user-owned declarations and the last-admin purge rule (issue #728).
import { withTemporaryEntries } from '../../src/core/registry/testing';
import {
  GroupMembershipPurge,
  PrincipalGroupsProvider,
  SHARING_MODEL_OWNERSHIP,
  SHARING_USER_OWNED_MODELS,
  groupOwnedResourceRegistry,
} from '../../src/sharing/index';
import { ALICE, BOB, CAROL, GROUP, fakeData, fakeTx, options, type FakeTx } from './fakes';

function build(tx: FakeTx) {
  const data = fakeData(tx);
  const principalGroups = new PrincipalGroupsProvider(data, options(), undefined, () => 0);
  const invalidate = jest.spyOn(principalGroups, 'invalidateUsers').mockImplementation(() => undefined);
  return { purge: new GroupMembershipPurge(data, principalGroups), data, invalidate };
}

describe('the sharing declarations', () => {
  it('register GroupMember and Grant as owned (delete, export) and the actor columns as detach', () => {
    expect(SHARING_USER_OWNED_MODELS.map((d) => [d.model, d.ownerField ?? null, [...(d.actorFields ?? [])], d.purge, d.export])).toEqual([
      ['GroupMember', 'userId', ['addedById'], 'delete', 'include'],
      ['GroupInvite', null, ['invitedById', 'acceptedById'], 'detach', 'exclude'],
      ['Group', null, ['createdById'], 'detach', 'exclude'],
      ['Grant', 'granteeUserId', ['grantedById', 'revokedById'], 'delete', 'include'],
    ]);
    expect(SHARING_MODEL_OWNERSHIP.map((d) => [d.model, d.kind])).toEqual([
      ['Group', 'org'],
      ['GroupMember', 'org'],
      ['GroupInvite', 'org'],
      ['Grant', 'org'],
    ]);
  });
});

describe('GroupMembershipPurge.purgeUser', () => {
  const G2 = '55555555-5555-4555-8555-555555555555';
  const G3 = '66666666-6666-4666-8666-666666666666';

  it('promotes the longest-standing member when the purged user was the last admin', async () => {
    const tx = fakeTx();
    tx.groupMember.findMany
      .mockResolvedValueOnce([{ groupId: GROUP, userId: ALICE, role: 'admin' }])
      .mockResolvedValueOnce([{ userId: BOB, role: 'viewer' }, { userId: CAROL, role: 'editor' }]);
    const { purge, data, invalidate } = build(tx);
    expect(await purge.purgeUser(ALICE)).toEqual({ membershipsRemoved: 1, adminsPromoted: 1, groupsDeleted: 0, groupsOrphaned: 0 });
    expect(data.systemReasons).toEqual(['purge']);
    expect(tx.groupMember.update).toHaveBeenCalledWith({ where: { groupId_userId: { groupId: GROUP, userId: BOB } }, data: { role: 'admin' } });
    expect(tx.groupMember.delete).toHaveBeenCalledWith({ where: { groupId_userId: { groupId: GROUP, userId: ALICE } } });
    expect(tx.groupInvite.updateMany).toHaveBeenCalledWith({ where: { invitedById: ALICE }, data: { invitedById: null } });
    expect(tx.group.updateMany).toHaveBeenCalledWith({ where: { createdById: ALICE }, data: { createdById: null } });
    expect(invalidate).toHaveBeenCalledWith(expect.arrayContaining([ALICE, BOB, CAROL]));
  });

  it('promotes nobody when another admin remains', async () => {
    const tx = fakeTx();
    tx.groupMember.findMany.mockResolvedValueOnce([{ groupId: GROUP, userId: ALICE, role: 'admin' }]).mockResolvedValueOnce([{ userId: BOB, role: 'admin' }]);
    const { purge } = build(tx);
    expect((await purge.purgeUser(ALICE)).adminsPromoted).toBe(0);
    expect(tx.groupMember.update).not.toHaveBeenCalled();
  });

  it('deletes an emptied group that owns nothing and keeps one that owns resources', async () => {
    const tx = fakeTx();
    tx.groupMember.findMany
      .mockResolvedValueOnce([
        { groupId: G2, userId: ALICE, role: 'admin' },
        { groupId: G3, userId: ALICE, role: 'admin' },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const { purge } = build(tx);
    await withTemporaryEntries(groupOwnedResourceRegistry, [{ type: 'album', countOwnedByGroup: async (groupId: string) => (groupId === G3 ? 1 : 0) }], async () => {
      expect(await purge.purgeUser(ALICE)).toEqual({ membershipsRemoved: 2, adminsPromoted: 0, groupsDeleted: 1, groupsOrphaned: 1 });
    });
    expect(tx.group.delete).toHaveBeenCalledWith({ where: { id: G2 } });
    expect(tx.groupMember.delete).toHaveBeenCalledWith({ where: { groupId_userId: { groupId: G3, userId: ALICE } } });
  });
});
