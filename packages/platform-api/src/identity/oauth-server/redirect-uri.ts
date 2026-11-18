// =============================================================================
// Redirect URI and resource matching (PP-15.4, docs/specs/oauth-server.md §2.12)
// =============================================================================
//
// PURE functions, I/O-free, so the rules are unit-tested without a database.
//
//   - the comparison is an exact string match against the client's registered URIs;
//   - loopback is the one exception (RFC 8252 §7.3): for `http://127.0.0.1`,
//     `http://[::1]` and `http://localhost` the PORT is ignored. Scheme, the
//     same loopback name, path and query still match exactly. `127.0.0.1` never
//     matches `localhost`;
//   - a registered `https` URI never matches on a prefix, a wildcard or a case
//     change of the path;
//   - a fragment, or credentials in the authority, never match.
// =============================================================================

/** `http://<loopback>[:port]<rest>`; the rest (path and query) is compared exactly. */
const LOOPBACK = /^http:\/\/(127\.0\.0\.1|\[::1\]|localhost)(?::(\d{1,5}))?((?:[/?][^#]*)?)$/i;

interface LoopbackParts {
  /** Lower-cased loopback name. */
  host: string;
  /** The port, or `null`. */
  port: number | null;
  /** Path and query, exactly as written (`''` when none). */
  rest: string;
}

function loopbackParts(uri: string): LoopbackParts | null {
  const match = LOOPBACK.exec(uri);
  if (!match) return null;
  const port = match[2] === undefined ? null : Number(match[2]);
  if (port !== null && (port < 1 || port > 65535)) return null;
  return { host: match[1]!.toLowerCase(), port, rest: match[3] ?? '' };
}

/**
 * Whether a redirect URI is a loopback `http` URI (`127.0.0.1`, `[::1]` or `localhost`).
 *
 * @param uri - a redirect URI.
 * @returns `true` for a loopback redirect.
 *
 * @stability experimental
 */
export function isLoopbackRedirectUri(uri: string): boolean {
  return loopbackParts(uri) !== null;
}

/**
 * Whether `requested` matches one of `registered` under the rules above.
 *
 * @param registered - the client's registered redirect URIs.
 * @param requested - the `redirect_uri` the request sent.
 * @returns `true` when it matches.
 *
 * @stability experimental
 */
export function matchesRedirectUri(registered: readonly string[], requested: string): boolean {
  if (requested.includes('#')) return false;
  if (registered.includes(requested)) return true;
  const want = loopbackParts(requested);
  if (!want) return false;
  return registered.some((candidate) => {
    const have = loopbackParts(candidate);
    return have !== null && have.host === want.host && have.rest === want.rest;
  });
}

/**
 * Where a person is sent back to, for the consent page: the authority of an
 * `http(s)` URI, or the scheme of a custom-scheme (native app) URI (`com.example.app://`).
 *
 * @param uri - a redirect URI.
 * @returns a short display string, or `''` when the URI cannot be parsed.
 *
 * @stability experimental
 */
export function redirectHostOf(uri: string): string {
  try {
    const parsed = new URL(uri);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.host;
    return `${parsed.protocol}//`;
  } catch {
    return '';
  }
}

/**
 * Normalises a resource identifier for comparison (RFC 8707): lower-case
 * scheme and host (default port dropped), no fragment, no trailing slash.
 *
 * @param value - an absolute URI.
 * @returns the normalised form, or `null` when it is not an absolute `http(s)` URI.
 *
 * @stability experimental
 */
export function normalizeResourceIdentifier(value: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  if (parsed.username !== '' || parsed.password !== '') return null;
  const path = parsed.pathname.replace(/\/+$/, '');
  return `${parsed.protocol}//${parsed.host}${path}${parsed.search}`;
}

/**
 * The client's registered redirect URIs from the stored JSON column, defensively
 * (a malformed column yields none).
 *
 * @param stored - `oauth_clients.redirect_uris`.
 * @returns the string entries.
 *
 * @stability experimental
 */
export function registeredRedirectUris(stored: unknown): string[] {
  return Array.isArray(stored) ? stored.filter((entry): entry is string => typeof entry === 'string') : [];
}
