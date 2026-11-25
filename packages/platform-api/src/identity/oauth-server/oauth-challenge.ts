// =============================================================================
// The Bearer challenge of a protected resource (PP-15.6, docs/specs/oauth-server.md §2.16)
// =============================================================================
//
// A hosted client learns how to sign in from the FAILED REQUEST: a real HTTP
// 401 (or 403 for a step-up) whose `WWW-Authenticate` names the protected
// resource metadata document (RFC 9728 §5.1) and, for a refusal, the error
// (RFC 6750 §3). This file builds the header value, with correct quoting and no
// line breaks; where it is sent is decided by `JwtAuthGuard` (401),
// `InsufficientScopeException` (403) and `PermissionsGuard`.
// =============================================================================

import { oauthResourceRegistry } from './oauth-resource.registry';

/**
 * The OAuth errors a resource challenge carries (RFC 6750 §3.1).
 *
 * @stability experimental
 */
export type OAuthChallengeError = 'invalid_token' | 'insufficient_scope' | 'invalid_request';

/**
 * Input of {@link buildBearerChallenge}.
 *
 * @stability experimental
 */
export interface BearerChallengeInput {
  /** The registered protected resource id the challenge is for. */
  readonly resourceId: string;
  /** `invalid_token` only when a token was presented; `insufficient_scope` for a step-up. */
  readonly error?: OAuthChallengeError;
  /** A human sentence for `error_description`. Never a secret and never the caller's input. */
  readonly errorDescription?: string;
  /** Scope ids for `scope` (RFC 6750 §3: the scopes the call needs). */
  readonly scope?: readonly string[];
  /** The application root. Default: the one `OAuthServerContext` registered at module init. */
  readonly appUrl?: string;
}

let configuredAppUrl: string | undefined;

/**
 * Records the application root the challenge URLs are built on. Called once by
 * the OAuth server module at init (from `APP_URL`); an app never calls it.
 *
 * @param appUrl - `APP_URL`, or `undefined` to forget it.
 *
 * @internal
 */
export function configureOAuthChallengeBase(appUrl: string | undefined): void {
  configuredAppUrl = appUrl ? appUrl.replace(/\/+$/, '') : undefined;
}

/**
 * The application root the challenge URLs are currently built on (a test seam
 * for the conformance suite, which sets a probe root and restores this one).
 *
 * @returns the root, or `undefined` when none is configured.
 *
 * @internal
 */
export function configuredOAuthChallengeBase(): string | undefined {
  return configuredAppUrl;
}

/**
 * The URL of a resource's protected resource metadata document as clients see
 * it: `<APP_URL>/.well-known/oauth-protected-resource<resource path>` (the
 * nginx fragment, or the Vite proxy in development, maps it to the API).
 *
 * @param appUrl - `APP_URL`.
 * @param resourcePath - the resource's `path` (for example `/api/mcp`).
 * @returns the absolute URL.
 *
 * @stability experimental
 */
export function protectedResourceMetadataUrl(appUrl: string, resourcePath: string): string {
  return `${appUrl.replace(/\/+$/, '')}/.well-known/oauth-protected-resource${resourcePath}`;
}

/**
 * Quotes `value` as an HTTP quoted-string: control characters (CR and LF
 * included) become a space, anything outside printable ASCII becomes `?`, then
 * `\` and `"` are escaped.
 *
 * @param value - raw text.
 * @returns the text between the quotes (the quotes are not added).
 *
 * @stability experimental
 */
export function quoteChallengeValue(value: string): string {
  let out = '';
  for (const character of value) {
    const code = character.codePointAt(0)!;
    if (code < 0x20 || code === 0x7f) out += out.endsWith(' ') ? '' : ' ';
    else if (code > 0x7e) out += '?';
    else out += character === '\\' || character === '"' ? `\\${character}` : character;
  }
  return out;
}

/** A scope token keeps only the characters RFC 6749 §3.3 allows: no space, quote, backslash, control or non-ASCII character. */
function scopeToken(scope: string): string {
  let out = '';
  for (const character of scope) {
    const code = character.codePointAt(0)!;
    if (code >= 0x21 && code <= 0x7e && character !== '"' && character !== '\\') out += character;
  }
  return out;
}

/**
 * Builds a `WWW-Authenticate` value for a protected resource:
 * `Bearer resource_metadata="<absolute url>", error="...", error_description="...", scope="a b"`.
 * Every value is quoted, and the result never contains a line break.
 *
 * @param input - the resource id and the optional error, description and scopes.
 * @returns the header value.
 * @throws Error when the resource is not registered or no application root is known.
 *
 * @example
 * ```ts
 * buildBearerChallenge({ resourceId: 'notes', error: 'insufficient_scope', scope: ['notes:read', 'notes:write'] });
 * ```
 *
 * @extensionPoint hook
 * @stability experimental
 */
export function buildBearerChallenge(input: BearerChallengeInput): string {
  const resource = oauthResourceRegistry.get(input.resourceId);
  if (!resource) throw new Error(`buildBearerChallenge: unknown protected resource "${input.resourceId}"`);
  const appUrl = input.appUrl ?? configuredAppUrl;
  if (!appUrl) throw new Error('buildBearerChallenge: no application URL is configured (APP_URL)');

  const parts = [`resource_metadata="${quoteChallengeValue(protectedResourceMetadataUrl(appUrl, resource.path))}"`];
  if (input.error) parts.push(`error="${quoteChallengeValue(input.error)}"`);
  if (input.errorDescription) parts.push(`error_description="${quoteChallengeValue(input.errorDescription)}"`);
  if (input.scope && input.scope.length > 0) {
    // A scope token has no space, quote or backslash (RFC 6749 §3.3); drop anything else.
    const tokens = [...new Set(input.scope.map(scopeToken).filter((scope) => scope !== ''))];
    if (tokens.length > 0) parts.push(`scope="${tokens.join(' ')}"`);
  }
  return `Bearer ${parts.join(', ')}`;
}
