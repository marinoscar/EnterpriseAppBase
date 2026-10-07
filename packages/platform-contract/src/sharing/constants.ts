// =============================================================================
// Sharing constants (issue #728, PP-7.1): zod-free, so a client that needs only
// a role list, a status list or a limit never bundles zod.
// =============================================================================

/**
 * The roles a group member can hold, highest first: `admin` manages the group,
 * its members and invites; `editor` writes group-owned resources; `viewer`
 * reads them.
 *
 * @stability experimental
 */
export const GROUP_ROLES = ['admin', 'editor', 'viewer'] as const;

/**
 * One of {@link GROUP_ROLES}.
 *
 * @stability experimental
 */
export type GroupRole = (typeof GROUP_ROLES)[number];

/**
 * What a group invite currently is. `expired` is derived when the invite is
 * read (a pending invite past its `expiresAt`); no sweep writes it.
 *
 * @stability experimental
 */
export const GROUP_INVITE_STATUSES = ['pending', 'accepted', 'declined', 'revoked', 'expired'] as const;

/**
 * One of {@link GROUP_INVITE_STATUSES}.
 *
 * @stability experimental
 */
export type GroupInviteStatus = (typeof GROUP_INVITE_STATUSES)[number];

/**
 * The bounds the schemas enforce.
 *
 * @stability experimental
 */
export const SHARING_LIMITS: {
  /** Longest group name, in characters. */
  readonly groupNameMax: 120;
  /** Longest group description, in characters. */
  readonly groupDescriptionMax: 2000;
  /** Longest e-mail address accepted. */
  readonly emailMax: 320;
  /** Largest page a list returns. */
  readonly pageSizeMax: 100;
  /** The page size when none is asked for. */
  readonly pageSizeDefault: 20;
} = {
  groupNameMax: 120,
  groupDescriptionMax: 2000,
  emailMax: 320,
  pageSizeMax: 100,
  pageSizeDefault: 20,
};
