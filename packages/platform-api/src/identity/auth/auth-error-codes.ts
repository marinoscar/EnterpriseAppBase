import { ForbiddenException } from '@nestjs/common';
import { DatabaseSeedException } from '../../core/index';

// The CLOSED set of sign-in failure codes (#652) is defined ONCE, in
// `@marinoscar/platform-contract/identity` (#727): the web app keys its copy
// off the same list, so the two can no longer drift. Re-exported here so the
// API's imports are unchanged.
import { AUTH_ERROR_CODES, DEFAULT_AUTH_ERROR_CODE, type AuthErrorCode } from '@marinoscar/platform-contract/identity';

export { AUTH_ERROR_CODES, DEFAULT_AUTH_ERROR_CODE };
export type { AuthErrorCode };

/**
 * Reasons a login can be refused, a subset of `AuthErrorCode`.
 *
 * @stability stable
 */
export type AuthLoginDeniedReason = Extract<
  AuthErrorCode,
  'not_allowlisted' | 'account_disabled' | 'access_denied' | 'no_organization'
>;

/**
 * A sign-in that ended in a refusal rather than a fault: refused by policy
 * (allowlist, disabled account, no organization in multi-org mode) or declined by the person at Google's consent
 * screen (`GoogleOAuthGuard` raises that one).
 *
 * Still a 403 `ForbiddenException`, so every caller that treats it as one (and
 * the OpenAPI document) is unchanged; `reason` is what the OAuth callback turns
 * into the redirect's `error` code. The human message stays for logs and API
 * consumers and is never put in the redirect.
 *
 * @stability stable
 */
export class AuthLoginDeniedException extends ForbiddenException {
  /**
   * @param reason - the redirect's `error` code.
   * @param message - the human message, for logs and API consumers; never put in the redirect.
   */
  constructor(
    /** The sign-in error code the OAuth callback redirects with. */
    readonly reason: AuthLoginDeniedReason,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Builds the frontend callback URL for a failed sign-in:
 * `${appUrl}/auth/callback?error=<code>`.
 *
 * @stability stable
 */
export function buildAuthErrorRedirectUrl(
  appUrl: string | undefined,
  code: AuthErrorCode,
): string {
  const url = new URL('/auth/callback', appUrl);
  url.searchParams.set('error', code);
  return url.toString();
}

/**
 * True for Passport's `AuthorizationError` with code `access_denied`.
 *
 * `passport-oauth2` does not currently raise that for a consent denial (it
 * calls `fail()` for `?error=access_denied`, which `GoogleOAuthGuard` turns into
 * an `AuthLoginDeniedException('access_denied')`), but a strategy that does
 * raise it must still land on the same code.
 *
 * Matched structurally (name and code) rather than with `instanceof`, because
 * the class belongs to `passport-oauth2`, a transitive dependency this module
 * should not import, and more than one copy of it can be installed.
 *
 * @stability stable
 */
export function isOAuthAccessDenied(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { name, code } = error as { name?: unknown; code?: unknown };
  return name === 'AuthorizationError' && code === 'access_denied';
}

/**
 * Maps anything thrown on the Google sign-in path to a code from the closed
 * set. Anything unrecognised is `authentication_failed`, so a new failure mode
 * can never leak its message into the redirect.
 *
 * @stability stable
 */
export function resolveAuthErrorCode(error: unknown): AuthErrorCode {
  if (error instanceof AuthLoginDeniedException) return error.reason;
  if (error instanceof DatabaseSeedException) return 'server_misconfigured';
  if (isOAuthAccessDenied(error)) return 'access_denied';
  return DEFAULT_AUTH_ERROR_CODE;
}
