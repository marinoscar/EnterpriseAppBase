// The refresh-token cookie, as identity's controllers read and write it on
// Fastify. The app registers `@fastify/cookie` (the reference app: `main.ts`);
// these structural types are what identity relies on from it, so the package
// does not depend on the plugin. Cookie settings: docs/SECURITY-ARCHITECTURE.md §3.
import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * The cookie attributes identity sets.
 *
 * @stability experimental
 */
export interface IdentityCookieOptions {
  /** Script cannot read the cookie. */
  httpOnly?: boolean;
  /** Sent over HTTPS only. */
  secure?: boolean;
  /** Cross-site policy. */
  sameSite?: 'lax' | 'strict' | 'none';
  /** The path the cookie is sent to. */
  path?: string;
  /** Lifetime in seconds. */
  maxAge?: number;
}

/** A Fastify request with `@fastify/cookie`'s parsed cookies. */
export type CookieRequest = FastifyRequest & { cookies: Record<string, string | undefined> };

/**
 * The cookie setters `@fastify/cookie` adds to a reply.
 *
 * @stability experimental
 */
export interface CookieReplyMethods {
  /**
   * Sets a cookie on the response.
   *
   * @param name - the cookie name.
   * @param value - the cookie value.
   * @param options - its attributes.
   */
  setCookie(name: string, value: string, options?: IdentityCookieOptions): unknown;
  /**
   * Expires a cookie.
   *
   * @param name - the cookie name.
   * @param options - the attributes it was set with (at least `path`).
   */
  clearCookie(name: string, options?: IdentityCookieOptions): unknown;
}

/**
 * A Fastify reply with `@fastify/cookie`'s setters.
 *
 * @stability experimental
 */
export type CookieReply = FastifyReply & CookieReplyMethods;
