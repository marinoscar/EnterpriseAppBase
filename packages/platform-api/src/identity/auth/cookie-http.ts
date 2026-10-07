// The refresh-token cookie, as identity's controllers read and write it on
// Fastify. The app registers `@fastify/cookie` (the reference app: `main.ts`);
// these structural types are what identity relies on from it, so the package
// does not depend on the plugin. Cookie settings: docs/SECURITY-ARCHITECTURE.md §3.
import type { FastifyReply, FastifyRequest } from 'fastify';

/** The cookie attributes identity sets. */
export interface IdentityCookieOptions {
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'lax' | 'strict' | 'none';
  path?: string;
  maxAge?: number;
}

/** A Fastify request with `@fastify/cookie`'s parsed cookies. */
export type CookieRequest = FastifyRequest & { cookies: Record<string, string | undefined> };

/** A Fastify reply with `@fastify/cookie`'s setters. */
export type CookieReply = FastifyReply & {
  setCookie(name: string, value: string, options?: IdentityCookieOptions): unknown;
  clearCookie(name: string, options?: IdentityCookieOptions): unknown;
};
