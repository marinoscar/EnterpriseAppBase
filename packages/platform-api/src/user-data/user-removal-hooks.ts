// The platform's own user removal hook (issue #743, PP-9.1): the sharing
// slice's `GroupMembershipPurge` (#728), which keeps every group administrable
// when a member's user row is deleted (the last-admin rule). The cascade from
// `User` would delete the membership and skip the rule, so it runs first.

import { GroupMembershipPurge } from '../sharing/index';
import type { UserRemovalHook } from './user-data.types';

/**
 * Runs `GroupMembershipPurge.purgeUser` before a user row is deleted (factory
 * reset, offboarding with `userDisposition: 'purge'`). Pass it in
 * `UserDataModule.forRoot({ userRemovalHooks })` when the app mounts the
 * sharing slice.
 *
 * @stability experimental
 * @extensionPoint hook
 * @example
 * ```ts
 * UserDataModule.forRoot({ imports: [UserDataHostModule], datamodel, userRemovalHooks: [groupMembershipRemovalHook] });
 * ```
 */
export const groupMembershipRemovalHook: UserRemovalHook<GroupMembershipPurge> = {
  id: 'sharing.group-memberships',
  inject: GroupMembershipPurge,
  run: async (purge, userId) => ({ ...(await purge.purgeUser(userId)) }),
};
