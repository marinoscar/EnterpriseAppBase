// =============================================================================
// The token and revocation endpoints' body rules, enforced BEFORE parsing (PP-15.4)
// =============================================================================
//
// The platform host (Nest's Fastify adapter) already parses
// `application/x-www-form-urlencoded` globally, with the framework's default body
// limit. The OAuth endpoints are stricter than that, and only on their own two
// routes: the body must be a form (a JSON body, or any other type, is
// `400 invalid_request`) and at most 16 KiB. A global `onRequest` hook that looks
// at ONLY `POST /api/oauth/token` and `POST /api/oauth/revoke` keeps every other
// route of the application exactly as it was, and answers the RFC 6749 JSON error
// even for a body the parser would have refused with a platform error.
// =============================================================================

import { OAUTH_BODY_LIMIT_BYTES, OAUTH_ROUTE_PREFIX } from './oauth-server.constants';

/** The routes the rules cover (path only, no query). */
const GUARDED_PATHS: ReadonlySet<string> = new Set([`${OAUTH_ROUTE_PREFIX}/token`, `${OAUTH_ROUTE_PREFIX}/revoke`]);

const FORM = 'application/x-www-form-urlencoded';

/**
 * Decides whether a request must be refused before its body is read.
 *
 * @param method - the HTTP method.
 * @param url - the raw request URL.
 * @param headers - the request headers.
 * @returns the RFC 6749 error description when it must be refused with `400 invalid_request`, else `null`.
 *
 * @stability experimental
 */
export function oauthBodyViolation(method: string, url: string, headers: Record<string, unknown>): string | null {
  if (method !== 'POST') return null;
  const path = url.split('?')[0] ?? '';
  if (!GUARDED_PATHS.has(path)) return null;
  const contentType = String(headers['content-type'] ?? '').toLowerCase();
  if (!contentType.startsWith(FORM)) return 'The request body must be application/x-www-form-urlencoded.';
  const length = Number(headers['content-length']);
  if (Number.isFinite(length) && length > OAUTH_BODY_LIMIT_BYTES) return 'The request body is too large.';
  return null;
}

/** The structural part of the Fastify instance the guard installs itself on. */
interface HookHost {
  addHook(
    name: 'onRequest',
    hook: (
      request: { method: string; url: string; headers: Record<string, unknown> },
      reply: { code(status: number): { header(name: string, value: string): { header(name: string, value: string): { send(body: unknown): unknown } } } },
    ) => Promise<unknown> | unknown,
  ): void;
}

/**
 * Installs the guard as an `onRequest` hook. Call before the server is ready.
 *
 * @param instance - the Fastify instance.
 * @param isEnabled - whether the server is switched on: while it is not, every OAuth route is a plain 404, so the guard stays out of the way.
 *
 * @stability experimental
 */
export function installOAuthBodyGuard(instance: unknown, isEnabled: () => Promise<boolean>): void {
  const host = instance as Partial<HookHost> | null | undefined;
  if (!host || typeof host.addHook !== 'function') return;
  host.addHook('onRequest', async (request, reply) => {
    const violation = oauthBodyViolation(request.method, request.url, request.headers);
    if (violation === null || !(await isEnabled())) return undefined;
    return reply
      .code(400)
      .header('cache-control', 'no-store')
      .header('access-control-allow-origin', '*')
      .send({ error: 'invalid_request', error_description: violation });
  });
}
