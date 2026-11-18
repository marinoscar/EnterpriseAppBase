// =============================================================================
// Redirect URI rules for registered, dynamic and metadata-document clients (PP-15.5)
// =============================================================================
//
// PURE functions, no I/O. docs/specs/oauth-server.md §2.15:
//
//   - a redirect URI is `https:` or a loopback `http:` URI, with no fragment and
//     no userinfo;
//   - a custom scheme is allowed only for `application_type: native` and only in
//     reverse-domain style (`com.example.app:`);
//   - at most 10 URIs of at most 2,000 characters each;
//   - the HOST OF A CLIENT (dynamic, registered) is the one host shared by every
//     non-loopback redirect URI, or `loopback` when they are all loopback. Mixed
//     hosts are refused.
// =============================================================================

import { isLoopbackRedirectUri } from '../redirect-uri';

/** The most redirect URIs a client may register. */
export const CLIENT_REDIRECT_URIS_MAX = 10;
/** The longest redirect URI, in characters. */
export const CLIENT_REDIRECT_URI_MAX_LENGTH = 2000;
/** The longest client name, in characters. */
export const CLIENT_NAME_MAX_LENGTH = 200;
/** The pseudo-host of a client whose redirect URIs are all loopback. */
export const LOOPBACK_CLIENT_HOST = 'loopback';

/** A reverse-domain custom scheme: at least two dot-separated labels. */
const REVERSE_DOMAIN_SCHEME = /^[a-z][a-z0-9-]*(\.[a-z0-9-]+)+$/;

/** Why a set of redirect URIs was refused. @stability experimental */
export interface RedirectUriProblem {
  /** A sentence for the caller; never echoes the URI. */
  readonly message: string;
}

/**
 * The host a redirect URI contributes: `loopback`, the lower-cased host of an
 * `https:` URI, or the scheme of a custom-scheme URI.
 *
 * @param uri - a redirect URI that already passed {@link validateRedirectUris}.
 * @returns the host.
 *
 * @stability experimental
 */
export function redirectUriHost(uri: string): string {
  if (isLoopbackRedirectUri(uri)) return LOOPBACK_CLIENT_HOST;
  try {
    const parsed = new URL(uri);
    if (parsed.protocol === 'https:') return parsed.hostname.toLowerCase();
    return parsed.protocol.slice(0, -1).toLowerCase();
  } catch {
    return '';
  }
}

/**
 * Checks a list of redirect URIs.
 *
 * @param uris - the candidate URIs.
 * @param applicationType - `native` permits a reverse-domain custom scheme; `web` forbids loopback.
 * @returns a problem, or `null` when every rule holds.
 *
 * @stability experimental
 */
export function validateRedirectUris(uris: readonly unknown[], applicationType: 'web' | 'native'): RedirectUriProblem | null {
  if (uris.length === 0) return { message: 'redirect_uris must contain at least one URI.' };
  if (uris.length > CLIENT_REDIRECT_URIS_MAX) return { message: `redirect_uris may hold at most ${CLIENT_REDIRECT_URIS_MAX} URIs.` };
  for (const uri of uris) {
    if (typeof uri !== 'string' || uri.length === 0) return { message: 'Every redirect URI must be a non-empty string.' };
    if (uri.length > CLIENT_REDIRECT_URI_MAX_LENGTH) return { message: `A redirect URI is longer than ${CLIENT_REDIRECT_URI_MAX_LENGTH} characters.` };
    if (uri.includes('#')) return { message: 'A redirect URI must not contain a fragment.' };
    if (isLoopbackRedirectUri(uri)) {
      if (applicationType === 'web') return { message: 'A loopback redirect URI needs application_type "native".' };
      continue;
    }
    let parsed: URL;
    try {
      parsed = new URL(uri);
    } catch {
      return { message: 'A redirect URI is not an absolute URI.' };
    }
    if (parsed.username !== '' || parsed.password !== '') return { message: 'A redirect URI must not contain credentials.' };
    if (parsed.protocol === 'https:') {
      if (parsed.hostname === '') return { message: 'A redirect URI has no host.' };
      continue;
    }
    if (parsed.protocol === 'http:') return { message: 'A redirect URI must use https (http is allowed only for a loopback address).' };
    const scheme = parsed.protocol.slice(0, -1).toLowerCase();
    if (applicationType !== 'native' || !REVERSE_DOMAIN_SCHEME.test(scheme)) {
      return { message: 'A custom URI scheme is allowed only for a native client and only in reverse-domain form (com.example.app).' };
    }
  }
  return null;
}

/**
 * The host of a dynamic or registered client: the one host every non-loopback
 * redirect URI shares, or `loopback` when they are all loopback.
 *
 * @param uris - URIs that passed {@link validateRedirectUris}.
 * @returns the host, or `null` when the non-loopback URIs are on different hosts.
 *
 * @stability experimental
 */
export function sharedRedirectHost(uris: readonly string[]): string | null {
  const hosts = new Set<string>();
  for (const uri of uris) {
    const host = redirectUriHost(uri);
    if (host !== LOOPBACK_CLIENT_HOST) hosts.add(host);
  }
  if (hosts.size === 0) return LOOPBACK_CLIENT_HOST;
  if (hosts.size > 1) return null;
  return [...hosts][0]!;
}
