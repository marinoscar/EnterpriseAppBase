// =============================================================================
// Client ID Metadata Documents (PP-15.5, docs/specs/oauth-server.md §2.15)
// =============================================================================
//
// A `client_id` that is an HTTPS URL names a JSON document the server fetches at
// `/authorize` (never at `/token`). The fetch is the SSRF primitive of this slice,
// so it goes through the SAME egress guard and a pinned GET the webhooks slice
// uses (`core/egress`): HTTPS only, public addresses only (every resolved address
// checked, the checked one connected to), no redirect followed, 5 s timeout, 64
// KiB cap, `Accept: application/json`.
//
// THE DOCUMENT IS DATA, NEVER MARKUP. Its text is validated, bounded and stored;
// nothing here, and nothing downstream, renders it as HTML. Nothing of a fetched
// body is logged: a failure is a closed code and the host.
//
// The transport and the DNS resolver are injectable (`OAUTH_CIMD_TRANSPORT`,
// `OAUTH_CIMD_HOST_RESOLVER`), so tests script the answers and never touch the network.
// =============================================================================

import { Inject, Injectable, Optional } from '@nestjs/common';

import {
  PinnedGetError,
  WebhookEgressError,
  nodePinnedGetTransport,
  resolveWebhookTarget,
  systemHostResolver,
  type HostResolver,
  type PinnedGetTransport,
  type WebhookEgressPolicy,
} from '../../../core/index';
import { isLoopbackRedirectUri } from '../redirect-uri';
import { CLIENT_NAME_MAX_LENGTH, validateRedirectUris } from './client-redirects';

/** Injection token of the CIMD fetch transport. @extensionPoint token @stability experimental */
export const OAUTH_CIMD_TRANSPORT: unique symbol = Symbol.for('@marinoscar/platform/identity/OAUTH_CIMD_TRANSPORT');
/** Injection token of the CIMD fetch DNS resolver. @extensionPoint token @stability experimental */
export const OAUTH_CIMD_HOST_RESOLVER: unique symbol = Symbol.for('@marinoscar/platform/identity/OAUTH_CIMD_HOST_RESOLVER');

/** The fetch deadline, in milliseconds. */
export const CIMD_FETCH_TIMEOUT_MS = 5_000;
/** The response cap, in bytes (64 KiB). */
export const CIMD_MAX_BYTES = 64 * 1024;
/** The shortest cache life, in milliseconds (5 minutes). */
export const CIMD_MIN_CACHE_MS = 5 * 60_000;
/** The longest cache life, in milliseconds (24 hours). */
export const CIMD_MAX_CACHE_MS = 24 * 60 * 60_000;
/** The cache life when the response names none (1 hour). */
export const CIMD_DEFAULT_CACHE_MS = 60 * 60_000;
/** The whole fetch, DNS included, must end inside this (so `/authorize` answers inside 10 s). */
export const CIMD_OVERALL_DEADLINE_MS = 8_000;

const EGRESS_POLICY: WebhookEgressPolicy = Object.freeze({ allowInsecureHttp: false, allowPrivateTargets: false, allowedHosts: Object.freeze([]) });

/**
 * Why a document could not be used. Closed values: they are logged, never the document.
 *
 * @stability experimental
 */
export type CimdFailureCode =
  | 'egress_refused'
  | 'timeout'
  | 'too_large'
  | 'redirect'
  | 'http_status'
  | 'network'
  | 'not_json'
  | 'client_id_mismatch'
  | 'invalid_document'
  | 'confidential_not_supported';

/**
 * A fetch or validation failure.
 *
 * @stability experimental
 */
export class CimdError extends Error {
  constructor(
    /** The closed code. */
    readonly code: CimdFailureCode,
    message: string,
  ) {
    super(message);
    this.name = 'CimdError';
  }
}

/**
 * Whether `clientId` is a metadata document URL: `https:`, a path (not only the
 * origin), no fragment, no userinfo, no dot segments, and already in canonical
 * form (so the string the client sent is the string the document must repeat).
 *
 * @param clientId - the `client_id` as sent.
 * @returns the parsed URL, or `null` when it is an opaque id.
 *
 * @stability experimental
 */
export function parseCimdClientId(clientId: string): URL | null {
  if (!clientId.startsWith('https://') || clientId.includes('#')) return null;
  let url: URL;
  try {
    url = new URL(clientId);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.hostname === '') return null;
  if (url.pathname === '' || url.pathname === '/') return null;
  // Dot segments are folded away by URL parsing: look at the string as sent.
  const afterAuthority = clientId.slice('https://'.length).split('?')[0]!;
  const rawPath = afterAuthority.slice(afterAuthority.indexOf('/'));
  if (rawPath.split('/').some((segment) => /^(\.|%2e){1,2}$/i.test(segment))) return null;
  if (url.href !== clientId) return null;
  return url;
}

/** What a valid document holds. @stability experimental */
export interface CimdMetadata {
  /** The display name (self-asserted). */
  readonly name: string;
  /** The redirect URIs. */
  readonly redirectUris: readonly string[];
  /** The home page, when it is a well-formed `https:` URL. */
  readonly clientUri: string | null;
  /** The logo, only when `https:` and on the client's host. */
  readonly logoUri: string | null;
  /** `web` or `native`. */
  readonly applicationType: 'web' | 'native';
}

/**
 * Validates a parsed document against the `client_id` URL.
 *
 * @param url - the `client_id` URL.
 * @param doc - the parsed JSON.
 * @returns the metadata worth storing.
 * @throws CimdError `client_id_mismatch`, `confidential_not_supported` or `invalid_document`.
 *
 * @stability experimental
 */
export function validateCimdDocument(url: URL, doc: unknown): CimdMetadata {
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) throw new CimdError('invalid_document', 'The document is not a JSON object.');
  const body = doc as Record<string, unknown>;
  if (body.client_id !== url.href) throw new CimdError('client_id_mismatch', 'The document client_id does not equal its URL.');

  const name = body.client_name;
  if (typeof name !== 'string' || name.trim() === '') throw new CimdError('invalid_document', 'client_name is required.');
  const redirects = body.redirect_uris;
  if (!Array.isArray(redirects) || redirects.length === 0) throw new CimdError('invalid_document', 'redirect_uris must be a non-empty array.');

  const method = body.token_endpoint_auth_method;
  if (method !== undefined && method !== 'none') {
    throw new CimdError('confidential_not_supported', 'Only public clients (token_endpoint_auth_method "none") are supported for metadata documents.');
  }
  const grants = body.grant_types;
  if (grants !== undefined && (!Array.isArray(grants) || !grants.includes('authorization_code'))) {
    throw new CimdError('invalid_document', 'grant_types must include authorization_code.');
  }
  const responses = body.response_types;
  if (responses !== undefined && (!Array.isArray(responses) || !responses.includes('code'))) {
    throw new CimdError('invalid_document', 'response_types must include code.');
  }
  const appType = body.application_type;
  if (appType !== undefined && appType !== 'web' && appType !== 'native') throw new CimdError('invalid_document', 'application_type must be web or native.');
  // A loopback callback implies a native client even when the document does not say so.
  const hasLoopback = redirects.some((uri) => typeof uri === 'string' && isLoopbackRedirectUri(uri));
  const applicationType: 'web' | 'native' = appType ?? (hasLoopback ? 'native' : 'web');
  const problem = validateRedirectUris(redirects, applicationType);
  if (problem) throw new CimdError('invalid_document', problem.message);

  const host = url.hostname.toLowerCase();
  let clientUri: string | null = null;
  if (typeof body.client_uri === 'string' && body.client_uri.length <= 2000) {
    try {
      clientUri = new URL(body.client_uri).protocol === 'https:' ? body.client_uri : null;
    } catch {
      clientUri = null;
    }
  }
  let logoUri: string | null = null;
  if (typeof body.logo_uri === 'string' && body.logo_uri.length <= 2000) {
    try {
      const logo = new URL(body.logo_uri);
      if (logo.protocol === 'https:' && logo.hostname.toLowerCase() === host) logoUri = body.logo_uri;
    } catch {
      logoUri = null;
    }
  }
  return {
    name: name.trim().slice(0, CLIENT_NAME_MAX_LENGTH),
    redirectUris: redirects as string[],
    clientUri,
    logoUri,
    applicationType,
  };
}

/**
 * When a response may be reused until, from its cache headers, clamped to 5
 * minutes to 24 hours. `no-store` and `no-cache` give the minimum.
 *
 * @param headers - the response headers (lower-case names).
 * @param now - the clock.
 * @returns the expiry.
 *
 * @stability experimental
 */
export function cimdExpiry(headers: Readonly<Record<string, string>>, now: Date): Date {
  let lifeMs = CIMD_DEFAULT_CACHE_MS;
  const control = (headers['cache-control'] ?? '').toLowerCase();
  const maxAge = /(?:^|[\s,])max-age=(\d+)/.exec(control);
  if (/(?:^|[\s,])(no-store|no-cache)(?:[\s,]|$)/.test(control)) lifeMs = 0;
  else if (maxAge) lifeMs = Number(maxAge[1]) * 1000;
  else if (headers.expires) {
    const at = Date.parse(headers.expires);
    if (Number.isFinite(at)) lifeMs = at - now.getTime();
  }
  const clamped = Math.min(CIMD_MAX_CACHE_MS, Math.max(CIMD_MIN_CACHE_MS, Number.isFinite(lifeMs) ? lifeMs : CIMD_DEFAULT_CACHE_MS));
  return new Date(now.getTime() + clamped);
}

/** A fetched, validated document. @stability experimental */
export interface CimdFetchResult {
  /** The validated metadata. */
  readonly metadata: CimdMetadata;
  /** Until when it may be reused. */
  readonly expiresAt: Date;
}

/**
 * Fetches and validates one metadata document.
 *
 * @stability experimental
 */
@Injectable()
export class CimdFetcher {
  private readonly transport: PinnedGetTransport;
  private readonly resolver: HostResolver;

  constructor(
    @Optional() @Inject(OAUTH_CIMD_TRANSPORT) transport?: PinnedGetTransport,
    @Optional() @Inject(OAUTH_CIMD_HOST_RESOLVER) resolver?: HostResolver,
  ) {
    this.transport = transport ?? nodePinnedGetTransport;
    this.resolver = resolver ?? systemHostResolver;
  }

  /**
   * GETs `url` and validates the document.
   *
   * @param url - a URL accepted by {@link parseCimdClientId}.
   * @param now - the clock.
   * @returns the metadata and its expiry.
   * @throws CimdError with a closed code; its message never carries the document.
   */
  async fetch(url: URL, now: Date = new Date()): Promise<CimdFetchResult> {
    let deadline: NodeJS.Timeout | undefined;
    const overall = new Promise<never>((_resolve, reject) => {
      deadline = setTimeout(() => reject(new CimdError('timeout', 'The metadata fetch took too long.')), CIMD_OVERALL_DEADLINE_MS);
      deadline.unref?.();
    });
    try {
      return await Promise.race([this.run(url, now), overall]);
    } finally {
      if (deadline) clearTimeout(deadline);
    }
  }

  private async run(url: URL, now: Date): Promise<CimdFetchResult> {
    let target;
    try {
      target = await resolveWebhookTarget(url.href, EGRESS_POLICY, this.resolver);
    } catch (error) {
      if (error instanceof WebhookEgressError) throw new CimdError('egress_refused', `The metadata URL was refused (${error.code}).`);
      throw new CimdError('network', 'The metadata host could not be resolved.');
    }
    let response;
    try {
      response = await this.transport.get({
        target,
        headers: { accept: 'application/json', 'user-agent': 'platform-oauth-server/1', 'accept-encoding': 'identity' },
        timeoutMs: CIMD_FETCH_TIMEOUT_MS,
        maxBytes: CIMD_MAX_BYTES,
      });
    } catch (error) {
      if (error instanceof PinnedGetError) {
        if (error.code === 'timeout') throw new CimdError('timeout', 'The metadata server did not answer in time.');
        if (error.code === 'too_large') throw new CimdError('too_large', 'The metadata document is larger than 64 KiB.');
      }
      throw new CimdError('network', 'The metadata server could not be reached.');
    }
    if (response.status >= 300 && response.status < 400) throw new CimdError('redirect', 'The metadata URL answered with a redirect.');
    if (response.status !== 200) throw new CimdError('http_status', `The metadata server answered ${response.status}.`);
    if (response.body.length > CIMD_MAX_BYTES) throw new CimdError('too_large', 'The metadata document is larger than 64 KiB.');
    let parsed: unknown;
    try {
      parsed = JSON.parse(response.body.toString('utf8'));
    } catch {
      throw new CimdError('not_json', 'The metadata document is not valid JSON.');
    }
    return { metadata: validateCimdDocument(url, parsed), expiresAt: cimdExpiry(response.headers, now) };
  }
}
