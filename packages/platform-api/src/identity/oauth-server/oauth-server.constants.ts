// =============================================================================
// Fixed lifetimes, limits and prefixes of the authorization server (PP-15.4)
// =============================================================================
//
// docs/specs/oauth-server.md §2.13 and §3. These are CONSTANTS, not settings:
// the code life, the pending-request life, the refresh grace window and the
// body limit are protocol-shaped numbers an operator has no reason to tune.
// The token lifetimes the operator does tune live in the `oauthServer` settings.
// =============================================================================

/**
 * The life of an authorization code, in milliseconds (60 s).
 *
 * @stability experimental
 */
export const OAUTH_CODE_TTL_MS = 60_000;

/**
 * The life of a pending authorization request, in milliseconds (10 minutes).
 *
 * @stability experimental
 */
export const OAUTH_REQUEST_TTL_MS = 10 * 60_000;

/**
 * The refresh grace window, in milliseconds (10 s). For this long after a
 * rotation, presenting the previous refresh token again is a client retrying a
 * lost response, not reuse.
 *
 * @stability experimental
 */
export const OAUTH_REFRESH_GRACE_MS = 10_000;

/**
 * The largest request body of `/api/oauth/token` and `/api/oauth/revoke`, in bytes (16 KiB).
 *
 * @stability experimental
 */
export const OAUTH_BODY_LIMIT_BYTES = 16 * 1024;

/**
 * The route prefix of every OAuth server route (under the global `/api` prefix).
 *
 * @stability experimental
 */
export const OAUTH_ROUTE_PREFIX = '/api/oauth';

/**
 * The prefix of an access token.
 *
 * @stability experimental
 */
export const OAUTH_ACCESS_TOKEN_PREFIX = 'oat_';

/**
 * The prefix of a refresh token.
 *
 * @stability experimental
 */
export const OAUTH_REFRESH_TOKEN_PREFIX = 'ort_';

/**
 * The prefix of an authorization code.
 *
 * @stability experimental
 */
export const OAUTH_CODE_PREFIX = 'oac_';

/** The longest `state` a client may send. */
export const OAUTH_STATE_MAX_LENGTH = 2048;

/** The longest `redirect_uri`, `client_id` and `resource` accepted. */
export const OAUTH_PARAM_MAX_LENGTH = 2048;

/** The most scopes one request may name. */
export const OAUTH_SCOPES_MAX = 64;

/**
 * One fixed-window rate limit.
 *
 * @stability experimental
 */
export interface OAuthRateLimitSpec {
  /** Hits allowed per window. */
  readonly limit: number;
  /** The window, in milliseconds. */
  readonly windowMs: number;
}

/**
 * Rate limits (docs/specs/oauth-server.md §3), fixed windows (one minute; registration one hour).
 *
 * @stability experimental
 */
export const OAUTH_RATE_LIMITS: Readonly<{
  /** `/authorize`: per source address. */
  authorizePerAddress: OAuthRateLimitSpec;
  /** `/token`: per client id. */
  tokenPerClient: OAuthRateLimitSpec;
  /** `/revoke`: per client id. */
  revokePerClient: OAuthRateLimitSpec;
  /** `/register`: per source address, per hour. */
  registerPerAddress: OAuthRateLimitSpec;
}> = Object.freeze({
  authorizePerAddress: { limit: 30, windowMs: 60_000 },
  tokenPerClient: { limit: 60, windowMs: 60_000 },
  revokePerClient: { limit: 60, windowMs: 60_000 },
  registerPerAddress: { limit: 10, windowMs: 60 * 60_000 },
});
