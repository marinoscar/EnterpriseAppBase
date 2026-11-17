// =============================================================================
// Route-prefix matching shared by every confined credential family
// =============================================================================
//
// A `nod_` credential is confined to `/api/nodes`; an `oat_` token to the route
// prefixes of the protected resource it was issued for. Both decide on the RAW
// REQUEST PATH, before any I/O, with the same rule, so this is the one place
// the rule is written.
//
// The rule is "exactly the prefix, or something UNDER it": `/api/nodes` or a
// path beginning `/api/nodes/`. NOT `startsWith(prefix)`, which would also
// admit `/api/nodesX` and any future `/api/nodes…`-shaped route somebody adds
// without thinking about it. The query string is not part of route identity
// and is stripped first: a caller who could append `?/api/nodes` to a
// forbidden path and pass would have found a complete bypass.
// =============================================================================

/**
 * The path of a request, query string stripped, or `null` when the request has
 * no URL to reason about (the caller must then refuse: failing closed on a
 * request that cannot be classified is the only safe default for an allowlist).
 *
 * Reads the RAW URL, not Nest's route metadata, because a path is a fact that
 * exists before routing and cannot be accidentally omitted by a controller.
 * `originalUrl ?? url` covers both adapters (Fastify exposes the full path on
 * `url`; Express rewrites `url` under a mounted router and keeps `originalUrl`).
 *
 * @param request - the request.
 * @returns the path without its query string, or `null`.
 *
 * @stability experimental
 */
export function requestPathOf(request: { originalUrl?: unknown; url?: unknown }): string | null {
  const raw = request.originalUrl ?? request.url;
  if (typeof raw !== 'string') return null;
  return raw.split('?')[0] ?? null;
}

/**
 * Whether `path` equals `prefix` or lies under it (`prefix + '/'`).
 *
 * @param path - a request path without a query string.
 * @param prefix - a route prefix without a trailing slash.
 * @returns `true` for the prefix itself or anything beneath it.
 *
 * @stability experimental
 */
export function isUnderRoutePrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}
