// =============================================================================
// The sharing slice's user-owned data and model ownership (issue #728)
// =============================================================================
//
// Pure data for the app's two registries (the reference app registers them in
// `prisma/ownership/*.manifest.ts`, with the platform's entries), plus the
// purge rule for a user's group memberships.
//
//   GroupMember.userId                      OWNER: purge deletes the row (Cascade); export includes it
//   GroupMember.addedById                   ACTOR: SetNull
//   GroupInvite.invitedById / acceptedById  ACTOR: purge sets null (SetNull)
//   Group.createdById                       ACTOR: purge sets null (SetNull)
//
// THE LAST-ADMIN RULE ON PURGE (`GroupMembershipPurge.purgeUser`): before the
// user's memberships go, every group where they were the only `admin` gets a
// new one, the longest-standing remaining member. A group left with no member
// at all is deleted when it owns nothing (the group-owned-resource registry),
// otherwise kept for the organization's `groups:admin` holders, and the Doctor
// check `sharing.groups.orphaned` lists it.
// =============================================================================

import { Inject, Injectable } from '@nestjs/common';

import type { ModelOwnershipDef, UserOwnedModelDef } from '../core/index';
import { asSharingTx, type GroupMemberRow } from './data/sharing-tx';
import { groupOwnedResourceRegistry } from './ownership';
import { SHARING_DATA, type SharingDataPort } from './ports';
import { PrincipalGroupsProvider } from './principal-groups.provider';

/**
 * The slice's models with a foreign key to `User`, for the app's
 * user-owned-data registry (`registerUserOwnedModels`).
 *
 * @extensionPoint registry
 * @stability experimental
 */
export const SHARING_USER_OWNED_MODELS: readonly UserOwnedModelDef<'Group' | 'GroupMember' | 'GroupInvite'>[] = [
  {
    model: 'GroupMember',
    ownerField: 'userId',
    actorFields: ['addedById'],
    purge: 'delete',
    export: 'include',
    rationale:
      "The user's membership of a group and their role in it. It means nothing without the user; the export lists the groups they belong to. Who added them is only recorded.",
  },
  {
    model: 'GroupInvite',
    actorFields: ['invitedById', 'acceptedById'],
    purge: 'detach',
    export: 'exclude',
    rationale: 'An invitation of an address to a group; it records who sent it and who accepted it, neither of whom owns it.',
  },
  {
    model: 'Group',
    actorFields: ['createdById'],
    purge: 'detach',
    export: 'exclude',
    rationale: 'A group belongs to its members and its organization, not to the user who created it; the creator is only recorded.',
  },
];

/**
 * The slice's models in the model ownership registry
 * (`registerModelOwnership`): all three are `org` tables.
 *
 * @extensionPoint registry
 * @stability experimental
 */
export const SHARING_MODEL_OWNERSHIP: readonly ModelOwnershipDef<'Group' | 'GroupMember' | 'GroupInvite'>[] = [
  {
    model: 'Group',
    kind: 'org',
    rationale: 'A sharing group lives inside one organization (spec decision D6: a group is never a tenant).',
  },
  {
    model: 'GroupMember',
    kind: 'org',
    rationale:
      "A group membership. Carries the group's org_id (a policy cannot join through its parent) and a composite foreign key (group_id, org_id) to the group.",
  },
  {
    model: 'GroupInvite',
    kind: 'org',
    rationale: "An invitation to a group, holding the invitee's address; composite foreign key (group_id, org_id) to the group.",
  },
];

/**
 * What {@link GroupMembershipPurge.purgeUser} did.
 *
 * @stability experimental
 */
export interface GroupPurgeSummary {
  /** Memberships removed. */
  membershipsRemoved: number;
  /** Groups whose admin role passed to the longest-standing remaining member. */
  adminsPromoted: number;
  /** Groups deleted because no member remained and they owned nothing. */
  groupsDeleted: number;
  /** Groups kept with no member because they still own resources. */
  groupsOrphaned: number;
}

/**
 * Removes one user from every group, keeping each group administrable.
 * System work (reason `purge`): it crosses organizations.
 *
 * @stability experimental
 */
@Injectable()
export class GroupMembershipPurge {
  constructor(
    @Inject(SHARING_DATA) private readonly data: SharingDataPort,
    private readonly principalGroups: PrincipalGroupsProvider,
  ) {}

  /**
   * Purges `userId`'s group data: promotes a successor admin where needed,
   * deletes the memberships, deletes emptied groups that own nothing, and
   * nulls the actor columns. Call it from the app's user purge BEFORE the
   * user row is deleted (the cascade would skip the last-admin rule).
   *
   * @param userId - the user being purged.
   * @returns what changed.
   */
  async purgeUser(userId: string): Promise<GroupPurgeSummary> {
    const summary: GroupPurgeSummary = { membershipsRemoved: 0, adminsPromoted: 0, groupsDeleted: 0, groupsOrphaned: 0 };
    const affected = new Set<string>([userId]);

    await this.data.runAsSystem('purge', async (raw) => {
      const tx = asSharingTx(raw);
      const memberships = await tx.groupMember.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });

      for (const membership of memberships) {
        const { groupId } = membership;
        await tx.$queryRaw`SELECT id FROM groups WHERE id = ${groupId}::uuid FOR UPDATE`;
        const others = await tx.groupMember.findMany<Pick<GroupMemberRow, 'userId' | 'role'>>({
          where: { groupId, userId: { not: userId } },
          select: { userId: true, role: true },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        });
        for (const other of others) affected.add(other.userId);

        if (others.length === 0) {
          let owned = 0;
          for (const def of groupOwnedResourceRegistry.list()) owned += await def.countOwnedByGroup(groupId, raw);
          if (owned === 0) {
            await tx.group.delete({ where: { id: groupId } });
            summary.groupsDeleted += 1;
            summary.membershipsRemoved += 1;
            continue;
          }
          summary.groupsOrphaned += 1;
        } else if (membership.role === 'admin' && !others.some((other) => other.role === 'admin')) {
          await tx.groupMember.update({ where: { groupId_userId: { groupId, userId: others[0]!.userId } }, data: { role: 'admin' } });
          summary.adminsPromoted += 1;
        }

        await tx.groupMember.delete({ where: { groupId_userId: { groupId, userId } } });
        summary.membershipsRemoved += 1;
      }

      await tx.groupMember.updateMany({ where: { addedById: userId }, data: { addedById: null } });
      await tx.groupInvite.updateMany({ where: { invitedById: userId }, data: { invitedById: null } });
      await tx.groupInvite.updateMany({ where: { acceptedById: userId }, data: { acceptedById: null } });
      await tx.group.updateMany({ where: { createdById: userId }, data: { createdById: null } });
    });

    this.principalGroups.invalidateUsers([...affected]);
    return summary;
  }
}
