// =============================================================================
// Sharing events (issue #728, PP-7.1): rung 4 of the extension contract
// =============================================================================
//
// In-process events an app may listen to (`@OnEvent(SHARING_EVENTS.MEMBER_ADDED)`
// with the reference app's `EventEmitter2`), emitted through the
// `SHARING_EVENT_EMITTER` port:
//
//   - AFTER the triggering transaction committed, so a listener that re-reads
//     the rows sees the change;
//   - synchronously, wrapped so a throwing listener never reaches the request
//     that made the change (do real work in a queued job, not in a listener);
//   - with IDS ONLY: never an e-mail address, never a name.
// =============================================================================

import type { GroupRole } from '@marinoscar/platform-contract/sharing';

/**
 * The event names. Permanent once released.
 *
 * @extensionPoint event
 * @stability experimental
 */
export const SHARING_EVENTS: {
  /** A group was created (its creator is its first admin). */
  readonly GROUP_CREATED: 'sharing.group.created';
  /** A group was deleted with its members and invites. */
  readonly GROUP_DELETED: 'sharing.group.deleted';
  /** A user became a member (added by an admin, or by accepting an invite). */
  readonly MEMBER_ADDED: 'sharing.group.member_added';
  /** A member left or was removed. */
  readonly MEMBER_REMOVED: 'sharing.group.member_removed';
  /** A member's role changed. */
  readonly MEMBER_ROLE_CHANGED: 'sharing.group.member_role_changed';
  /** An invite was created. */
  readonly INVITE_CREATED: 'sharing.group.invite_created';
  /** An invite was accepted (a `MEMBER_ADDED` follows). */
  readonly INVITE_ACCEPTED: 'sharing.group.invite_accepted';
} = {
  GROUP_CREATED: 'sharing.group.created',
  GROUP_DELETED: 'sharing.group.deleted',
  MEMBER_ADDED: 'sharing.group.member_added',
  MEMBER_REMOVED: 'sharing.group.member_removed',
  MEMBER_ROLE_CHANGED: 'sharing.group.member_role_changed',
  INVITE_CREATED: 'sharing.group.invite_created',
  INVITE_ACCEPTED: 'sharing.group.invite_accepted',
};

/**
 * One of the {@link SHARING_EVENTS} names.
 *
 * @stability experimental
 */
export type SharingEventName = (typeof SHARING_EVENTS)[keyof typeof SHARING_EVENTS];

/**
 * The payload of `sharing.group.created` and `sharing.group.deleted`.
 *
 * @stability experimental
 */
export interface GroupEventPayload {
  /** The group's organization. */
  readonly orgId: string;
  /** The group. */
  readonly groupId: string;
  /** Who did it. */
  readonly actorUserId: string;
}

/**
 * The payload of the three member events.
 *
 * @stability experimental
 */
export interface GroupMemberEventPayload extends GroupEventPayload {
  /** The member. */
  readonly userId: string;
  /** The member's role after the change (`null` once removed). */
  readonly role: GroupRole | null;
  /** The role before the change (`null` when newly added). */
  readonly previousRole: GroupRole | null;
}

/**
 * The payload of the two invite events. No address: the invite id is the
 * reference.
 *
 * @stability experimental
 */
export interface GroupInviteEventPayload extends GroupEventPayload {
  /** The invite. */
  readonly inviteId: string;
  /** The role it grants. */
  readonly role: GroupRole;
}
