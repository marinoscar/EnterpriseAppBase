import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AuthLoginDeniedException } from '../auth-error-codes';

/**
 * Per-request `passport.authenticate` options of {@link GoogleOAuthGuard}.
 *
 * @stability stable
 */
export interface GoogleAuthenticateOptions {
  /** `select_account`: show Google's account chooser. */
  prompt: 'select_account';
}

/**
 * Google OAuth guard for Fastify
 *
 * Initiates the Google OAuth flow when applied to a route.
 * Used on both the initial OAuth endpoint and the callback endpoint.
 *
 * Note: Passport OAuth strategies expect Express-style request/response objects.
 * This guard overrides getRequest/getResponse to return raw Node.js http objects
 * that Passport can work with. After authentication, it copies the user back
 * to the Fastify request so controllers can access req.user normally.
 *
 * The guard of the `google` sign-in provider (`registerAuthProvider`).
 *
 * @stability stable
 */
@Injectable()
export class GoogleOAuthGuard extends AuthGuard('google') {
  /**
   * The raw Node.js request, for Passport.
   *
   * @param context - the execution context.
   * @returns the raw request.
   */
  getRequest(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    // Return the raw Node.js IncomingMessage for Passport compatibility
    return request.raw || request;
  }

  /**
   * Per-request options for `passport.authenticate` (#652).
   *
   * `GET /auth/google?select_account=1` forwards `prompt=select_account`, so
   * Google shows its account chooser instead of silently re-using the signed-in
   * account. That is the way out for someone who was refused with one account and
   * wants to try another. Anything else leaves the behaviour unchanged.
   *
   * The query is read from the FASTIFY request: `getRequest` above returns the
   * raw `IncomingMessage`, which has no parsed `query`.
   *
   * @param context - the execution context.
   * @returns the options, or `undefined`.
   */
  getAuthenticateOptions(context: ExecutionContext): GoogleAuthenticateOptions | undefined {
    const query = context.switchToHttp().getRequest()?.query as
      | Record<string, unknown>
      | undefined;

    return query?.select_account === '1'
      ? { prompt: 'select_account' }
      : undefined;
  }

  /**
   * The raw Node.js response, for Passport.
   *
   * @param context - the execution context.
   * @returns the raw response.
   */
  getResponse(context: ExecutionContext) {
    const response = context.switchToHttp().getResponse();
    // Return the raw Node.js ServerResponse for Passport compatibility
    return response.raw || response;
  }

  /**
   * Turns a consent denial into `AuthLoginDeniedException('access_denied')`,
   * rethrows any other error, and returns the profile.
   *
   * @param err - Passport's error.
   * @param user - the profile, or `false`.
   * @param _info - Passport's info.
   * @param context - the execution context.
   * @returns the profile.
   */
  handleRequest<TUser = unknown>(
    err: Error | null,
    user: TUser | false,
    _info: unknown,
    context: ExecutionContext,
  ): TUser {
    if (err) {
      throw err;
    }

    if (!user) {
      // `passport-oauth2` reports `?error=access_denied` (the person cancelled
      // or denied consent at Google) through `fail()`, not `error()`, so it
      // arrives here as `!user` with no `err`. Name it, so the callback can
      // redirect with `error=access_denied` instead of a generic failure (#652).
      // The query is Google-supplied, so only its code is read, never its
      // `error_description`.
      const query = context.switchToHttp().getRequest()?.query as
        | Record<string, unknown>
        | undefined;

      if (query?.error === 'access_denied') {
        throw new AuthLoginDeniedException(
          'access_denied',
          'Google sign-in was cancelled or denied',
        );
      }

      throw new Error('Authentication failed');
    }

    // Copy user from raw request to Fastify request so controllers can access it
    const fastifyRequest = context.switchToHttp().getRequest();
    fastifyRequest.user = user;

    return user;
  }
}
