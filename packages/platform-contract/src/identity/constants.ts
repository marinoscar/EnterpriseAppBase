// The identity slice's plain values (issue #727, PP-6.6). Zod-free by rule: a
// browser that only needs an error code, an enum list or a type never pulls the
// schemas, and with them zod, into its bundle (test/no-zod-in-constants.test.ts).
//
// Every list here is the one the schemas validate with: the schemas import
// them, so a value cannot drift between what the API enforces and what the web
// app offers. Moved verbatim from the API (`packages/platform-api/src/identity/auth/auth-error-codes.ts`
// and the DTO files of auth, pat, device-auth and organizations); no value
// changed.

// =============================================================================
// Sign-in failure codes (issue #652)
// =============================================================================

/**
 * The CLOSED set of sign-in failure codes.
 *
 * A failed Google sign-in always ends as a 302 to
 * `${appUrl}/auth/callback?error=<code>`, where `<code>` is one of these and
 * nothing else: never an exception message, never raw JSON. Free text in that
 * query string let anyone craft a link that rendered attacker-chosen copy on a
 * trusted origin.
 *
 * - `not_allowlisted`: the email is not on the allowlist.
 * - `account_disabled`: the account exists but is deactivated.
 * - `access_denied`: the person cancelled or denied consent at the provider.
 * - `authentication_failed`: token exchange failed, code replayed or expired,
 *   no email on the profile, or anything unexpected.
 * - `server_misconfigured`: seed data is missing.
 * - `no_organization`: multi-org tenancy mode (`TENANCY_MODE=multi`) and the
 *   user has no active organization membership.
 *
 * The single source: the API resolves every failure to one of these, and the
 * web app keys its copy off this list (so a new code is a type error there
 * until it has copy).
 *
 * @stability stable
 */
export const AUTH_ERROR_CODES = [
  'not_allowlisted',
  'account_disabled',
  'access_denied',
  'authentication_failed',
  'server_misconfigured',
  'no_organization',
] as const;

/**
 * One sign-in failure code: a member of {@link AUTH_ERROR_CODES}.
 *
 * @stability stable
 */
export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[number];

/**
 * The code used for every failure that has no more specific one, and the code
 * a client shows for an unknown, legacy or missing value (never echo the raw
 * input).
 *
 * @stability stable
 */
export const DEFAULT_AUTH_ERROR_CODE: AuthErrorCode = 'authentication_failed';

/**
 * Whether `value` is one of the closed set of sign-in failure codes.
 *
 * @param value - anything, typically the `error` query parameter.
 * @returns `true` when `value` is an {@link AuthErrorCode}.
 *
 * @example
 * ```ts
 * const code = isAuthErrorCode(raw) ? raw : DEFAULT_AUTH_ERROR_CODE;
 * ```
 *
 * @stability stable
 */
export function isAuthErrorCode(value: unknown): value is AuthErrorCode {
  return typeof value === 'string' && (AUTH_ERROR_CODES as readonly string[]).includes(value);
}

// =============================================================================
// Tenancy and organizations
// =============================================================================

/**
 * The deployment's tenancy modes (`TENANCY_MODE`): one organization everyone
 * auto-joins (`single`) or one organization per customer (`multi`).
 *
 * @stability stable
 */
export const TENANCY_MODES = ['single', 'multi'] as const;

/**
 * One tenancy mode: a member of {@link TENANCY_MODES}.
 *
 * @stability stable
 */
export type TenancyModeValue = (typeof TENANCY_MODES)[number];

/**
 * The org roles an organization administrator can hand out, on a membership or
 * an invitation. `admin` is a SYSTEM role and is never assignable here.
 *
 * @stability stable
 */
export const ASSIGNABLE_ORG_ROLES = ['org_admin', 'contributor', 'viewer'] as const;

/**
 * One assignable org role: a member of {@link ASSIGNABLE_ORG_ROLES}.
 *
 * @stability stable
 */
export type AssignableOrgRole = (typeof ASSIGNABLE_ORG_ROLES)[number];

/**
 * An organization slug: 2 to 63 lower-case letters, digits or hyphens,
 * starting and ending with a letter or digit.
 *
 * @stability stable
 */
export const ORG_SLUG_PATTERN: RegExp = /^[a-z0-9](?:[a-z0-9-]{0,61})[a-z0-9]$/;

/**
 * The statuses of a membership: `active` (grants its role) or `suspended`
 * (listed, grants nothing).
 *
 * @stability stable
 */
export const ORG_MEMBER_STATUSES = ['active', 'suspended'] as const;

/**
 * One membership status: a member of {@link ORG_MEMBER_STATUSES}.
 *
 * @stability stable
 */
export type OrgMemberStatus = (typeof ORG_MEMBER_STATUSES)[number];

/**
 * The statuses of an organization invitation.
 *
 * @stability stable
 */
export const ORG_INVITE_STATUSES = ['pending', 'accepted', 'revoked', 'expired'] as const;

/**
 * One invitation status: a member of {@link ORG_INVITE_STATUSES}.
 *
 * @stability stable
 */
export type OrgInviteStatus = (typeof ORG_INVITE_STATUSES)[number];

// =============================================================================
// Personal access tokens
// =============================================================================

/**
 * The units a personal access token's lifetime is expressed in.
 *
 * @stability stable
 */
export const PAT_DURATION_UNITS = ['minutes', 'days', 'months'] as const;

/**
 * One duration unit: a member of {@link PAT_DURATION_UNITS}.
 *
 * @stability stable
 */
export type PatDurationUnitValue = (typeof PAT_DURATION_UNITS)[number];

/**
 * The bounds of a personal access token's `name` (characters, after trimming)
 * and `durationValue` (in its unit).
 *
 * @stability stable
 */
export const PAT_LIMITS = {
  /** The longest accepted token name. */
  nameMaxLength: 100,
  /** The smallest accepted duration value. */
  durationMin: 1,
  /** The largest accepted duration value. */
  durationMax: 999,
} as const;

// =============================================================================
// Device authorization (RFC 8628)
// =============================================================================

/**
 * The credential a device flow mints on the poll after approval: `session`
 * (an access JWT plus a refresh token; the default) or `pat` (a personal
 * access token).
 *
 * @stability stable
 */
export const DEVICE_TOKEN_TYPES = ['session', 'pat'] as const;

/**
 * One device credential type: a member of {@link DEVICE_TOKEN_TYPES}.
 *
 * @stability stable
 */
export type DeviceTokenTypeValue = (typeof DEVICE_TOKEN_TYPES)[number];

/**
 * The human-readable user code of a device flow: `XXXX-XXXX`, upper-case
 * letters and digits.
 *
 * @stability stable
 */
export const DEVICE_USER_CODE_PATTERN: RegExp = /^[A-Z0-9]{4}-[A-Z0-9]{4}$/;

/**
 * The RFC 8628 section 3.5 / RFC 6749 section 5.2 error codes of
 * `POST /api/auth/device/token`. A client branches on these, never on the
 * description or the HTTP status.
 *
 * @stability stable
 */
export const DEVICE_TOKEN_ERROR_CODES = [
  'authorization_pending',
  'slow_down',
  'expired_token',
  'access_denied',
  'invalid_grant',
  'invalid_request',
] as const;

/**
 * One device token error code: a member of {@link DEVICE_TOKEN_ERROR_CODES}.
 *
 * @stability stable
 */
export type DeviceTokenErrorCode = (typeof DEVICE_TOKEN_ERROR_CODES)[number];

/**
 * The statuses a listed device session can have. `approved` means approved but
 * not yet collected by the device; `expired` means the device collected its
 * credential.
 *
 * @stability stable
 */
export const DEVICE_SESSION_STATUSES = ['pending', 'approved', 'denied', 'expired'] as const;

/**
 * One device session status: a member of {@link DEVICE_SESSION_STATUSES}.
 *
 * @stability stable
 */
export type DeviceSessionStatus = (typeof DEVICE_SESSION_STATUSES)[number];
