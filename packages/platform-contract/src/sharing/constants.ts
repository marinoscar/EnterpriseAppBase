// =============================================================================
// Sharing constants (issue #728, PP-7.1): zod-free, so a client that needs only
// a role list, a status list or a limit never bundles zod.
// =============================================================================

/**
 * The group roles the platform ships, highest first: `admin` manages the
 * group, its members and invites; `editor` writes group-owned resources;
 * `viewer` reads them. An app registers MORE roles with `registerGroupRole`
 * (they are text in the database), so a role on the wire is any registered id
 * ({@link GroupRole}); this list is only the built-in ones.
 *
 * @stability experimental
 */
export const BUILTIN_GROUP_ROLES = ['admin', 'editor', 'viewer'] as const;

/**
 * One of {@link BUILTIN_GROUP_ROLES}.
 *
 * @stability experimental
 */
export type BuiltinGroupRole = (typeof BUILTIN_GROUP_ROLES)[number];

/**
 * The built-in group roles.
 *
 * @deprecated The role vocabulary is open now: use {@link BUILTIN_GROUP_ROLES} for the platform's own roles, and the
 * registry (`GET /api/sharing/group-roles`) for every role an app can assign.
 *
 * @stability experimental
 */
export const GROUP_ROLES = BUILTIN_GROUP_ROLES;

/**
 * A group role id: a built-in one or any the app registered with
 * `registerGroupRole`. The union keeps editor autocompletion for the built-ins
 * while accepting any registered id.
 *
 * @stability experimental
 */
export type GroupRole = BuiltinGroupRole | (string & Record<never, never>);

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
  /** Longest grantee reference of an app-registered grantee kind, in characters. */
  readonly granteeRefMax: 255;
  /** Longest link label, in characters (#730). */
  readonly linkLabelMax: 120;
} = {
  groupNameMax: 120,
  groupDescriptionMax: 2000,
  emailMax: 320,
  pageSizeMax: 100,
  pageSizeDefault: 20,
  grantIdentifierMax: 64,
  granteeRefMax: 255,
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
 * The grantee kinds the platform ships: one `user` of the organization, one
 * `group` of the organization, or anyone holding a `link` token (#730). An app
 * registers MORE kinds with `registerGranteeKind` (`grants.grantee_kind` is
 * text); a registered kind that is `persisted` stores its grants with a
 * `grantee_ref`, and `GET /api/sharing/grantee-kinds` lists them all.
 *
 * @stability experimental
 */
export const BUILTIN_GRANTEE_KINDS = ['user', 'group', 'link'] as const;

/**
 * One of {@link BUILTIN_GRANTEE_KINDS}.
 *
 * @stability experimental
 */
export type BuiltinGranteeKind = (typeof BUILTIN_GRANTEE_KINDS)[number];

/**
 * The built-in grantee kinds.
 *
 * @deprecated The kind vocabulary is open now: use {@link BUILTIN_GRANTEE_KINDS} for the platform's own kinds.
 *
 * @stability experimental
 */
export const GRANT_GRANTEE_KINDS = BUILTIN_GRANTEE_KINDS;

/**
 * The kind of a grant's grantee: a built-in kind or any a persisted app kind
 * registered (`email-domain`).
 *
 * @stability experimental
 */
export type GrantGranteeKind = BuiltinGranteeKind | (string & Record<never, never>);

/**
 * An id of a registered grantee kind, built in or not: lower-case letters,
 * digits and hyphens, 2 to 48 characters, starting with a letter
 * (`user`, `email-domain`).
 *
 * @stability experimental
 */
export const GRANTEE_KIND_ID_PATTERN: RegExp = /^[a-z][a-z0-9-]{1,47}$/;

/**
 * How a grantee kind collects its grantee in a share dialog: `user-search`
 * (an e-mail address), `group-select` (a group of the caller), `text` (one
 * text field), `none` (nothing to pick: a link) or `custom` (a picker the app
 * registers with `registerGranteePicker`).
 *
 * @stability experimental
 */
export const GRANTEE_KIND_INPUTS = ['user-search', 'group-select', 'text', 'none', 'custom'] as const;

/**
 * One of {@link GRANTEE_KIND_INPUTS}.
 *
 * @stability experimental
 */
export type GranteeKindInput = (typeof GRANTEE_KIND_INPUTS)[number];

/**
 * How a "shared with me" item reaches the caller through the built-in kinds: a
 * grant to them, or a grant to a group they belong to. A grant of an app kind
 * reports the kind's own `via` (`email_domain_grant`).
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
 * The prefix of every link-share token (#730), like the `nod_` and `pat_`
 * credentials: it makes a leaked token recognisable to secret scanning.
 *
 * @stability experimental
 */
export const LINK_TOKEN_PREFIX = 'lnk_';

/**
 * A well-formed link-share token: `lnk_` and 43 base64url characters (32
 * random bytes). The API refuses anything else before any lookup.
 *
 * @stability experimental
 */
export const LINK_TOKEN_PATTERN: RegExp = /^lnk_[A-Za-z0-9_-]{43}$/;

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
