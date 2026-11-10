// =============================================================================
// A cookie-backed `state` store for passport-oauth2 strategies (PP-14.9)
// =============================================================================
//
// WHY. `state: true` / `pkce: true` of `passport-oauth2` use a session store and
// fail with "requires session support" on every sign-in in this app (Fastify,
// no session plugin). The slice itself adds neither, so a real OAuth 2.0
// provider must bring a `store`. This one keeps the state in a short-lived,
// HMAC-signed cookie:
//
//   - HttpOnly, SameSite=Lax (sent on the provider's top-level redirect back),
//     Path=/api/auth, Secure in production, 10 minutes;
//   - the value is `state.expiry.HMAC(state.expiry)`, so a forged or edited
//     cookie fails; the comparison with the `state` the provider returned and
//     the signature check are constant time;
//   - cleared when the callback is verified (single use).
//
// It does not do PKCE (the verifier would need the same treatment); pass a
// store of your own for that. The cookie is written on the raw response and read
// from the raw request's `Cookie` header, which is what Passport hands a store.
// =============================================================================

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Options of {@link createCookieStateStore}.
 *
 * @stability experimental
 */
export interface CookieStateStoreOptions {
  /** The HMAC key (for example the app's JWT secret; the signature is domain-separated). */
  secret: string;
  /** The cookie name. Default `oauth_state`. */
  cookieName?: string;
  /** Lifetime in seconds. Default 600. */
  ttlSeconds?: number;
  /** The `Secure` attribute. Default: `NODE_ENV === 'production'`. */
  secure?: boolean;
}

/**
 * The raw request as the store sees it: Passport's request plus the response the
 * identity guard attaches.
 *
 * @stability experimental
 */
export type CookieStateStoreRequest = IncomingMessage & {
  /** The raw response, attached by the identity sign-in guard. */
  res?: ServerResponse;
  /** Set by `verify`: the cookie the guard clears from the Fastify reply (the raw header would be overwritten by Fastify's own `Set-Cookie`). */
  clearAuthStateCookie?: string;
};

/**
 * The `store` object `passport-oauth2` calls.
 *
 * @stability experimental
 */
export interface CookieStateStore {
  /**
   * Generates a state, remembers it in the cookie and passes it to the provider.
   *
   * @param req - Passport's raw request, with the response attached.
   * @param callback - receives the state to send to the provider.
   */
  store(req: CookieStateStoreRequest, callback: (error: Error | null, state: string) => void): void;
  /**
   * The same, in the shape `@types/passport-oauth2` declares (a `meta` argument that is ignored).
   *
   * @param req - Passport's raw request, with the response attached.
   * @param meta - ignored.
   * @param callback - receives the state to send to the provider.
   */
  store(req: CookieStateStoreRequest, meta: unknown, callback: (error: Error | null, state: string) => void): void;
  /**
   * Checks the returned state against the cookie and marks the cookie for clearing.
   *
   * @param req - Passport's raw request.
   * @param providedState - the `state` the provider sent back.
   * @param callback - `ok` is true for a valid, unexpired, matching state.
   */
  verify(
    req: CookieStateStoreRequest,
    providedState: string,
    callback: (error: Error | null, ok: boolean, info?: { message: string }) => void,
  ): void;
  /**
   * The same, in the shape `@types/passport-oauth2` declares (a `meta` argument that is ignored).
   *
   * @param req - Passport's raw request.
   * @param providedState - the `state` the provider sent back.
   * @param meta - ignored.
   * @param callback - `ok` is true for a valid, unexpired, matching state.
   */
  verify(
    req: CookieStateStoreRequest,
    providedState: string,
    meta: unknown,
    callback: (error: Error | null, ok: boolean, info?: { message: string }) => void,
  ): void;
}

const sign = (secret: string, payload: string): Buffer => createHmac('sha256', secret).update(`oauth-state:${payload}`).digest();

const equal = (a: Buffer, b: Buffer): boolean => a.length === b.length && timingSafeEqual(a, b);

function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return value.join('=');
  }
  return undefined;
}

/**
 * A `store` for `passport-oauth2`'s `state` option that works without a session
 * plugin. Pass it as `store` (not `state: true`) in the strategy's options.
 *
 * @param options - the signing key and optional cookie settings.
 * @returns the store: `store(req, callback)` and `verify(req, providedState, callback)`.
 *
 * @example
 * ```ts
 * new GithubStrategy({ clientID, clientSecret, callbackURL, store: createCookieStateStore({ secret: jwtSecret }) }, verify);
 * ```
 *
 * @extensionPoint hook
 * @stability experimental
 */
export function createCookieStateStore(options: CookieStateStoreOptions): CookieStateStore {
  if (!options.secret) throw new TypeError('createCookieStateStore requires a secret');
  const name = options.cookieName ?? 'oauth_state';
  const ttl = options.ttlSeconds ?? 600;
  const attributes = `Path=/api/auth; HttpOnly; SameSite=Lax${(options.secure ?? process.env.NODE_ENV === 'production') ? '; Secure' : ''}`;

  // Written with the two-argument `store` and three-argument `verify` Passport
  // dispatches on by arity (`Function.length`); the overloads above are typing only.
  const impl = {
    store(req: CookieStateStoreRequest, callback: (error: Error | null, state: string) => void) {
      const res = req.res;
      if (!res) return callback(new Error('The cookie state store needs the response; use it with the identity sign-in routes'), '');
      const state = randomBytes(24).toString('base64url');
      const payload = `${state}.${Math.floor(Date.now() / 1000) + ttl}`;
      res.appendHeader('Set-Cookie', `${name}=${payload}.${sign(options.secret, payload).toString('base64url')}; Max-Age=${ttl}; ${attributes}`);
      callback(null, state);
    },

    verify(
      req: CookieStateStoreRequest,
      providedState: string,
      callback: (error: Error | null, ok: boolean, info?: { message: string }) => void,
    ) {
      const fail = (message: string) => callback(null, false, { message });
      const [state, expiry, signature] = (readCookie(req.headers.cookie, name) ?? '').split('.');
      req.clearAuthStateCookie = name;
      if (!state || !expiry || !signature || typeof providedState !== 'string') return fail('Unable to verify authorization request state.');
      if (!equal(sign(options.secret, `${state}.${expiry}`), Buffer.from(signature, 'base64url'))) return fail('Invalid authorization request state.');
      if (Number(expiry) <= Math.floor(Date.now() / 1000)) return fail('The authorization request expired.');
      if (!equal(Buffer.from(state), Buffer.from(providedState))) return fail('Invalid authorization request state.');
      callback(null, true);
    },
  };
  return impl as CookieStateStore;
}
