// The ownership contract (issue #728): ownedByMeOrMyGroups, role ranking and
// the group-owned-resource registry.
import { withTemporaryEntries } from '../../src/core/registry/testing';
import {
  activeGroupsOf,
  groupOwnedResourceRegistry,
  groupRoleAtLeast,
  groupRoleRank,
  ownedByMeOrMyGroups,
  ownerWhere,
  registerGroupOwnedResource,
} from '../../src/sharing/index';
import { ALICE, ORG, OTHER_ORG, principal } from './fakes';

const FIELDS = { ownerUserField: 'ownerUserId', ownerGroupField: 'ownerGroupId' };
const G1 = '11111111-0000-4000-8000-000000000001';
const G2 = '11111111-0000-4000-8000-000000000002';
const G3 = '11111111-0000-4000-8000-000000000003';

describe('group roles', () => {
  it('rank admin > editor > viewer, anything else 0', () => {
    expect([groupRoleRank('admin'), groupRoleRank('editor'), groupRoleRank('viewer'), groupRoleRank('owner'), groupRoleRank(null)]).toEqual([3, 2, 1, 0, 0]);
    expect(groupRoleAtLeast('admin', 'editor')).toBe(true);
    expect(groupRoleAtLeast('editor', 'editor')).toBe(true);
    expect(groupRoleAtLeast('viewer', 'editor')).toBe(false);
    expect(groupRoleAtLeast(undefined, 'viewer')).toBe(false);
  });
});

describe('ownedByMeOrMyGroups', () => {
  it('is only "owned by me" for a principal with no groups', () => {
    expect(ownedByMeOrMyGroups(principal(), FIELDS)).toEqual({ ownerUserId: ALICE });
  });

  it('adds the groups of the ACTIVE organization, deduplicated', () => {
    const me = principal({
      groups: [
        { groupId: G1, orgId: ORG, role: 'viewer' },
        { groupId: G2, orgId: ORG, role: 'admin' },
        { groupId: G3, orgId: OTHER_ORG, role: 'admin' },
        { groupId: G1, orgId: ORG, role: 'viewer' },
      ],
    });
    expect(ownedByMeOrMyGroups(me, FIELDS)).toEqual({ OR: [{ ownerUserId: ALICE }, { ownerGroupId: { in: [G1, G2] } }] });
  });

  it('narrows to a minimum role', () => {
    const me = principal({ groups: [{ groupId: G1, orgId: ORG, role: 'viewer' }, { groupId: G2, orgId: ORG, role: 'editor' }] });
    expect(ownedByMeOrMyGroups(me, FIELDS, { minGroupRole: 'editor' })).toEqual({ OR: [{ ownerUserId: ALICE }, { ownerGroupId: { in: [G2] } }] });
    expect(ownedByMeOrMyGroups(me, FIELDS, { minGroupRole: 'admin' })).toEqual({ ownerUserId: ALICE });
  });

  it('activeGroupsOf ignores other organizations', () => {
    const me = principal({ groups: [{ groupId: G3, orgId: OTHER_ORG, role: 'admin' }] });
    expect(activeGroupsOf(me)).toEqual([]);
  });

  it('ownerWhere selects exactly one owner', () => {
    expect(ownerWhere({ kind: 'user', userId: ALICE }, FIELDS)).toEqual({ ownerUserId: ALICE });
    expect(ownerWhere({ kind: 'group', groupId: G1 }, FIELDS)).toEqual({ ownerGroupId: G1 });
  });
});

describe('the group-owned-resource registry', () => {
  it('keeps registration order and refuses a duplicate type or a bad id', async () => {
    const a = { type: 'album', countOwnedByGroup: async () => 0 };
    const b = { type: 'media_item', countOwnedByGroup: async () => 0 };
    await withTemporaryEntries(groupOwnedResourceRegistry, [a, b], () => {
      expect(groupOwnedResourceRegistry.ids()).toEqual(['album', 'media_item']);
      expect(() => registerGroupOwnedResource({ type: 'album', countOwnedByGroup: async () => 0 })).toThrow(/album/);
      expect(() => registerGroupOwnedResource({ type: 'Bad Type', countOwnedByGroup: async () => 0 })).toThrow();
      expect(() => registerGroupOwnedResource({ type: 'note' } as never)).toThrow(/countOwnedByGroup/);
    });
    expect(groupOwnedResourceRegistry.ids()).toEqual([]);
  });
});
