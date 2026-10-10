// =============================================================================
// The browser half of a sign-in: the refresh cookie and the redirect (PP-14.9)
// =============================================================================
//
// Moved out of `AuthController`'s private members so that EVERY provider's
// callback (Google's, the generic `AuthProviderController`'s and a `custom`
// provider's own controller) ends a sign-in identically:
//
//   - the refresh token is set in the HttpOnly `refresh_token` cookie, the ONLY
//     cookie the slice sets (`SameSite=Lax`, `Path=/api/auth`, 14 days,
//     `Secure` in production);
//   - the browser is redirected to the web app's `/auth/callback` with the
//     ACCESS token and its lifetime in the query string (the access token is
//     read only from `Authorization: Bearer` afterwards) or, on a refusal,
//     with `error=<code>` from the closed set (the exception's message never
//     reaches the redirect);
//   - the redirect is an explicit 302 (Nest pre-sets 200 and Fastify's
//     `redirect` keeps a status that was set).
// =============================================================================

import type { Logger } from '@nestjs/common';

import { DatabaseSeedException } from '../../core/index';
import { buildAuthErrorRedirectUrl, resolveAuthErrorCode } from './auth-error-codes';
import type { FullTokenResponse } from './auth.service';
import type { CookieReply } from './cookie-http';

/**
 * The refresh-token cookie's name.
 *
 * @stability experimental
 */
export const REFRESH_TOKEN_COOKIE = 'refresh_token';

/**
 * The refresh-token cookie's attributes: HttpOnly, `SameSite=Lax`,
 * `Path=/api/auth`, 14 days (seconds, as the cookie spec counts), `Secure` when
 * `NODE_ENV` is `production` (read at load).
 *
 * @stability experimental
 */
export const REFRESH_TOKEN_COOKIE_OPTIONS = Object.freeze({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/api/auth',
  maxAge: 14 * 24 * 60 * 60,
});

/**
 * Sets the refresh token in the HttpOnly cookie with the slice's attributes.
 *
 * @param reply - the Fastify reply (with `@fastify/cookie`).
 * @param refreshToken - the refresh token.
 *
 * @extensionPoint function
 * @stability experimental
 */
export function setRefreshTokenCookie(reply: CookieReply, refreshToken: string): void {
  reply.setCookie(REFRESH_TOKEN_COOKIE, refreshToken, { ...REFRESH_TOKEN_COOKIE_OPTIONS });
}

/**
 * The web app's callback URL for a finished sign-in:
 * `${appUrl}/auth/callback?token=<access>&expiresIn=<seconds>`.
 *
 * @param appUrl - the web app's origin (`appUrl` configuration).
 * @param tokens - the tokens `completeExternalLogin` returned.
 *
 * @stability experimental
 */
export function buildSignInSuccessRedirectUrl(appUrl: string | undefined, tokens: Pick<FullTokenResponse, 'accessToken' | 'expiresIn'>): string {
  const redirectUrl = new URL('/auth/callback', appUrl);
  redirectUrl.searchParams.set('token', tokens.accessToken);
  redirectUrl.searchParams.set('expiresIn', tokens.expiresIn.toString());
  return redirectUrl.toString();
}

/**
 * What {@link respondToSignIn} takes.
 *
 * @stability experimental
 */
export interface RespondToSignInInput {
  /** The Fastify reply. */
  reply: CookieReply;
  /** The web app's origin (`appUrl` configuration). */
  appUrl: string | undefined;
  /** Runs the login (`() => authService.completeExternalLogin(profile)`); its throw becomes an `error=<code>` redirect. */
  signIn: () => Promise<FullTokenResponse>;
  /** The caller's logger. */
  logger: Pick<Logger, 'log' | 'error'>;
  /** Names the callback in log lines (`Google OAuth callback`). */
  label: string;
}

/**
 * Runs a sign-in and answers the browser: on success the refresh cookie and a
 * 302 to the web callback with the access token; on any failure a 302 to the
 * callback with `error=<code>` (`resolveAuthErrorCode`, the closed set).
 *
 * @param input - see {@link RespondToSignInInput}.
 * @returns the reply, after `redirect`.
 *
 * @example
 * ```ts
 * @Get('callback')
 * callback(@Req() req, @Res() reply: CookieReply) {
 *   return respondToSignIn({
 *     reply, appUrl: this.config.get('appUrl'), logger: this.logger, label: 'SSO callback',
 *     signIn: () => this.auth.completeExternalLogin(mapMyProfile(req.body)),
 *   });
 * }
 * ```
 *
 * @extensionPoint function
 * @stability experimental
 */
export async function respondToSignIn(input: RespondToSignInInput): Promise<unknown> {
  const { reply, appUrl, signIn, logger, label } = input;
  try {
    const tokens = await signIn();

    // Set refresh token in HttpOnly cookie
    logger.log(`Setting refresh token cookie with options: ${JSON.stringify(REFRESH_TOKEN_COOKIE_OPTIONS)}`);
    setRefreshTokenCookie(reply, tokens.refreshToken!);

    // Redirect to frontend with access token only. The URL carries the access
    // token, so it is never logged.
    logger.log('Redirecting to the web app callback');
    return reply.status(302).redirect(buildSignInSuccessRedirectUrl(appUrl, tokens));
  } catch (error) {
    // Log with full context for debugging
    if (error instanceof DatabaseSeedException) {
      logger.error(`Database seed error during ${label} - seeds have not been run`, {
        error: error.message,
        stack: error.stack,
      });
    } else {
      logger.error(`Error in ${label}`, error);
    }

    // Closed set of codes only: the exception's message never reaches the
    // redirect, so the callback page cannot be made to show attacker-chosen text.
    //
    // EXPLICIT 302, like the success branch: by the time a route handler runs,
    // Nest has already set the reply's status to the route default (200), and
    // Fastify's `redirect(url)` keeps a status that was set.
    return reply.status(302).redirect(buildAuthErrorRedirectUrl(appUrl, resolveAuthErrorCode(error)));
  }
}
