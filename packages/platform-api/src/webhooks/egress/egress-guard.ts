// =============================================================================
// The webhook egress guard (issue #1046)
// =============================================================================
//
// A webhook URL is typed by an end user and POSTed to by the server: the
// classic SSRF primitive. Every request therefore passes this guard, at create
// and update time (a clear 422) and AGAIN at send time (the name may resolve
// elsewhere by then: DNS rebinding):
//
//   1. the URL parses, is `https:` (`http:` only with `allowInsecureHttp`), has
//      no userinfo, and a port of 80, 443, 8443 or >= 1024;
//   2. every address the name resolves to (A and AAAA, all of them) is a public
//      unicast address: no loopback, private, link-local (cloud metadata
//      169.254.169.254 included), carrier-grade NAT, multicast, unspecified,
//      documentation or IPv4-mapped/embedded private address;
//   3. the connection is made to the address that was checked (pinned by the
//      transport), never to a second lookup of the name.
//
// Redirects are never followed (the transport), so a 3xx cannot bounce a
// checked request to an unchecked target.
//
// `allowPrivateTargets` (on-prem, development) turns step 2 and the port rule
// off; `allowedHosts` exempts exactly the listed host names from step 2.
// =============================================================================

import { lookup } from 'node:dns';
import { isIP } from 'node:net';

import { isBlockedAddress } from '../../core/index';

/** Why the guard refused a target. @stability experimental */
export type WebhookEgressErrorCode =
  | 'invalid_url'
  | 'scheme_not_allowed'
  | 'userinfo_not_allowed'
  | 'port_not_allowed'
  | 'private_target'
  | 'unresolvable';

/**
 * Thrown by the guard. The message never carries the URL's path or query (only
 * the host), because a webhook URL may hold a token.
 *
 * @stability experimental
 */
export class WebhookEgressError extends Error {
  constructor(
    /** The refusal. */
    readonly code: WebhookEgressErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'WebhookEgressError';
  }
}

/** One address a name resolved to. @stability experimental */
export interface ResolvedAddress {
  /** The IP literal. */
  address: string;
  /** Its family. */
  family: 4 | 6;
}

/** The knobs of the guard (module options). @stability experimental */
export interface WebhookEgressPolicy {
  /** Allow `http:` targets. Development only. */
  readonly allowInsecureHttp: boolean;
  /** Allow private, loopback and link-local targets and low ports. On-premises and development only. */
  readonly allowPrivateTargets: boolean;
  /** Host names exempt from the private-address check. */
  readonly allowedHosts: readonly string[];
}

/**
 * Resolves a host name to every address it has. A port so a test (and a
 * DNS-rebinding case) can script the answers.
 *
 * @stability experimental
 */
export interface HostResolver {
  /**
   * Every A and AAAA address of `hostname`.
   *
   * @param hostname - a DNS name (never an IP literal).
   * @returns the addresses; rejects when the name does not resolve.
   */
  resolveAll(hostname: string): Promise<ResolvedAddress[]>;
}

/**
 * The default resolver: the operating system's (`dns.lookup`, `all: true`), the
 * same one the connection would use.
 *
 * @stability experimental
 */
export const systemHostResolver: HostResolver = {
  resolveAll: (hostname) =>
    new Promise<ResolvedAddress[]>((resolve, reject) => {
      lookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
        if (error) reject(error);
        else resolve(addresses.map((entry) => ({ address: entry.address, family: entry.family === 6 ? 6 : 4 })));
      });
    }),
};

/** A target that passed the guard: connect to `address`, present `hostname`. @stability experimental */
export interface ResolvedWebhookTarget {
  /** The parsed URL. */
  readonly url: URL;
  /** The host name (or IP literal) for the Host header and TLS server name. */
  readonly hostname: string;
  /** The checked address to connect to. */
  readonly address: string;
  /** Its family. */
  readonly family: 4 | 6;
}

const ALWAYS_OK_PORTS = new Set([80, 443, 8443]);

/** Strips the brackets of an IPv6 URL host. */
function bareHost(url: URL): string {
  const host = url.hostname;
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
}

/**
 * The syntactic checks (steps 1): no DNS.
 *
 * @param raw - the URL as typed.
 * @param policy - the guard's policy.
 * @returns the parsed URL.
 * @throws WebhookEgressError for a malformed URL, a disallowed scheme, userinfo or a disallowed port.
 *
 * @stability experimental
 */
export function parseWebhookUrl(raw: string, policy: WebhookEgressPolicy): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new WebhookEgressError('invalid_url', 'The URL is not valid.');
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && policy.allowInsecureHttp)) {
    throw new WebhookEgressError('scheme_not_allowed', url.protocol === 'http:' ? 'The URL must use https.' : 'The URL must be an https URL.');
  }
  if (url.username !== '' || url.password !== '') {
    throw new WebhookEgressError('userinfo_not_allowed', 'The URL must not contain a user name or password.');
  }
  if (url.hostname === '') throw new WebhookEgressError('invalid_url', 'The URL has no host.');
  if (!policy.allowPrivateTargets && url.port !== '') {
    const port = Number(url.port);
    if (!ALWAYS_OK_PORTS.has(port) && port < 1024) {
      throw new WebhookEgressError('port_not_allowed', `Port ${port} is not allowed; use 80, 443, 8443 or a port from 1024.`);
    }
  }
  return url;
}

function isExemptHost(hostname: string, policy: WebhookEgressPolicy): boolean {
  const lower = hostname.toLowerCase();
  return policy.allowedHosts.some((allowed) => allowed.toLowerCase() === lower);
}

/**
 * The full guard: {@link parseWebhookUrl}, then resolve every address and
 * refuse the target when any is not public.
 *
 * @param raw - the URL as typed.
 * @param policy - the guard's policy.
 * @param resolver - the DNS port.
 * @returns the checked target, with the address to pin.
 * @throws WebhookEgressError `private_target` when ANY resolved address is blocked, `unresolvable` when the name has none.
 *
 * @stability experimental
 */
export async function resolveWebhookTarget(raw: string, policy: WebhookEgressPolicy, resolver: HostResolver): Promise<ResolvedWebhookTarget> {
  const url = parseWebhookUrl(raw, policy);
  const hostname = bareHost(url);
  const skipChecks = policy.allowPrivateTargets || isExemptHost(hostname, policy);

  const literal = isIP(hostname);
  if (literal !== 0) {
    if (!skipChecks && isBlockedAddress(hostname)) {
      throw new WebhookEgressError('private_target', `The address ${hostname} is not a public address.`);
    }
    return { url, hostname, address: hostname, family: literal === 6 ? 6 : 4 };
  }

  const lower = hostname.toLowerCase();
  if (!skipChecks && (lower === 'localhost' || lower.endsWith('.localhost'))) {
    throw new WebhookEgressError('private_target', `The host ${hostname} is not a public host.`);
  }

  let addresses: ResolvedAddress[];
  try {
    addresses = await resolver.resolveAll(hostname);
  } catch {
    throw new WebhookEgressError('unresolvable', `The host ${hostname} does not resolve.`);
  }
  if (addresses.length === 0) throw new WebhookEgressError('unresolvable', `The host ${hostname} does not resolve.`);

  if (!skipChecks) {
    const blocked = addresses.find((entry) => isBlockedAddress(entry.address));
    if (blocked) throw new WebhookEgressError('private_target', `The host ${hostname} resolves to a non-public address.`);
  }

  const first = addresses[0]!;
  return { url, hostname, address: first.address, family: first.family };
}

/**
 * The host of a URL for a log line or a metric: never the path, the query or
 * the userinfo.
 *
 * @param raw - a URL.
 * @returns the host, or `unknown`.
 *
 * @stability experimental
 */
export function hostForLog(raw: string): string {
  try {
    return new URL(raw).host || 'unknown';
  } catch {
    return 'unknown';
  }
}
