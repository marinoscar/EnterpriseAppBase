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
  /** Longest resource type id or grant role, in characters (#729). */
  readonly grantIdentifierMax: 64;
  /** Longest link label, in characters (#730). */
  readonly linkLabelMax: 120;
} = {
  groupNameMax: 120,
  groupDescriptionMax: 2000,
  emailMax: 320,
  pageSizeMax: 100,
  pageSizeDefault: 20,
  grantIdentifierMax: 64,
  linkLabelMax: 120,
};

/**
 * The scopes of `GET /api/groups`: `mine` (groups the caller belongs to) and
 * `all` (every group of the organization; `groups:admin`).
 *
 * @stability experimental
 */
export const GROUP_LIST_SCOPES = ['mine', 'all'] as const;

/**
 * The status filters of `GET /api/groups/:id/invites`.
 *
 * @stability experimental
 */
export const GROUP_INVITE_LIST_FILTERS = ['pending', 'all'] as const;

/**
 * The entries of a sharing enum schema, as `z.enum` types them: each value
 * keyed by itself (`SharingEnumEntries<GroupRole>` is
 * `{ admin: 'admin', editor: 'editor', viewer: 'viewer' }`). Named so a
 * schema's type reads as a reference.
 *
 * @stability experimental
 */
export type SharingEnumEntries<T extends string> = { [K in T]: K };

// ---- grants (issue #729, PP-7.2) ---------------------------------------------------

/**
 * Who a grant shares a record with: one `user` of the organization, one
 * `group` of the organization, or anyone holding a `link` token (#730).
 *
 * @stability experimental
 */
export const GRANT_GRANTEE_KINDS = ['user', 'group', 'link'] as const;

/**
 * One of {@link GRANT_GRANTEE_KINDS}.
 *
 * @stability experimental
 */
export type GrantGranteeKind = (typeof GRANT_GRANTEE_KINDS)[number];

/**
 * How a "shared with me" item reaches the caller: a grant to them, or a grant
 * to a group they belong to.
 *
 * @stability experimental
 */
export const SHARED_WITH_ME_VIA = ['user_grant', 'group_grant'] as const;

/**
 * The scopes of a "resources I can see" list: `owned` (owned by me),
 * `groups` (owned by a group I belong to), `shared` (shared with me through a
 * grant, or visible through the type's organization-wide default) and `all`
 * (the union).
 *
 * @stability experimental
 */
export const ACCESS_SCOPES = ['owned', 'groups', 'shared', 'all'] as const;

/**
 * One of {@link ACCESS_SCOPES}.
 *
 * @stability experimental
 */
export type AccessScope = (typeof ACCESS_SCOPES)[number];

/**
 * Resource type ids and grant roles: lower-case snake_case, like a table name
 * or a job type segment (`transcript`, `media_item`, `viewer`).
 *
 * @stability experimental
 */
export const SHARING_IDENTIFIER_PATTERN: RegExp = /^[a-z][a-z0-9_]*$/;

/**
 * The request header a link-share token travels in on API calls (#730). The
 * token reaches the browser in the URL FRAGMENT (`/s#<token>`), never in a
 * path or a query string, so it never lands in an access log or a `Referer`.
 *
 * @stability experimental
 */
export const LINK_TOKEN_HEADER = 'x-link-token';

/**
 * The share URL of a link grant: `${appUrl}/s#${token}`. The token is in the
 * fragment, which a browser never sends to a server.
 *
 * @param appUrl - the application's public origin (`APP_URL`); a trailing slash is dropped.
 * @param token - the link token.
 * @returns the URL to hand out.
 *
 * @example
 * ```ts
 * buildLinkUrl('https://app.example.com/', 'abc'); // 'https://app.example.com/s#abc'
 * ```
 *
 * @stability experimental
 */
export function buildLinkUrl(appUrl: string, token: string): string {
  return `${appUrl.replace(/\/+$/, '')}/s#${token}`;
}
