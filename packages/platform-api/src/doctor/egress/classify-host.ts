// =============================================================================
// Host classification for the egress inventory (issue #773, PP-13.2)
// =============================================================================
//
// PURE: no DNS lookup, no socket, no `fetch`. A name is judged by its shape
// alone, because the doctor must be safe to run anywhere at any time, and in an
// air-gapped network every lookup of a public name simply hangs.
//
// The rules are conservative in one direction only: a name we cannot place is
// `public` (it is reachable only if the internet is), and a string we cannot
// even parse is `unknown`, which the `network.egress` check grades as public
// for an air-gapped install (fail closed).
// =============================================================================

import { EGRESS_MAX_HOSTS } from './egress.types';
import type { EgressDependency, EgressDependencyInput, EgressScope } from './egress.types';

/** Suffixes that only resolve inside a private network (RFC 6762, RFC 8375, Kubernetes, common LAN conventions). */
const PRIVATE_SUFFIXES = ['.internal', '.local', '.lan', '.home.arpa', '.svc', '.cluster.local', '.localhost'];

const HOSTNAME_LABEL = /^[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?$/;

function isIpv4(host: string): boolean {
  const parts = host.split('.');
  return parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255);
}

function isPrivateIpv4(host: string): boolean {
  const [a, b] = host.split('.').map(Number) as [number, number, number, number];
  return (
    a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
  );
}

/** Expands `::`-compressed IPv6 into 8 hextets, or `null` when it is not IPv6. */
function ipv6Hextets(host: string): number[] | null {
  if (!host.includes(':') || !/^[0-9a-f:.]+$/.test(host)) return null;
  const halves = host.split('::');
  if (halves.length > 2) return null;
  const parse = (part: string): number[] | null => {
    if (part === '') return [];
    const out: number[] = [];
    for (const piece of part.split(':')) {
      if (!/^[0-9a-f]{1,4}$/.test(piece)) return null;
      out.push(parseInt(piece, 16));
    }
    return out;
  };
  const head = parse(halves[0] ?? '');
  const tail = halves.length === 2 ? parse(halves[1] ?? '') : [];
  if (!head || !tail) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const missing = 8 - head.length - tail.length;
  if (missing < 1) return null;
  return [...head, ...new Array<number>(missing).fill(0), ...tail];
}

function isPrivateIpv6(hextets: number[]): boolean {
  const first = hextets[0] ?? 0;
  const loopback = hextets.slice(0, 7).every((h) => h === 0) && hextets[7] === 1;
  return loopback || (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80;
}

/**
 * Reduces a URL, a `host:port` string or a bare name to its lower-case
 * hostname: no scheme, userinfo, port, path, query or fragment, and no IPv6
 * brackets. Returns `null` for an empty or unparsable value. Pure.
 *
 * @param value - `https://user:pw@api.openai.com:443/v1?x=1`, `minio:9000`, `[::1]`, `smtp.corp.internal`.
 * @returns `api.openai.com`, `minio`, `::1`, `smtp.corp.internal`; or `null`.
 *
 * @example
 * ```ts
 * hostnameOf('http://ollama:11434/v1'); // 'ollama'
 * ```
 *
 * @stability experimental
 */
export function hostnameOf(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  let rest = value.trim().toLowerCase();
  if (rest === '') return null;

  const scheme = /^[a-z][a-z0-9+.-]*:\/\//.exec(rest);
  if (scheme) rest = rest.slice(scheme[0].length);
  else if (rest.startsWith('//')) rest = rest.slice(2);

  rest = rest.split(/[/?#]/, 1)[0] ?? '';
  const at = rest.lastIndexOf('@');
  if (at >= 0) rest = rest.slice(at + 1);

  let host: string;
  if (rest.startsWith('[')) {
    const close = rest.indexOf(']');
    if (close < 0) return null;
    host = rest.slice(1, close);
    if (!ipv6Hextets(host)) return null;
    return host;
  }

  // A bare IPv6 literal (more than one colon, no brackets) has no port to strip.
  if ((rest.match(/:/g) ?? []).length > 1) return ipv6Hextets(rest) ? rest : null;

  host = rest.split(':', 1)[0] ?? '';
  if (host.endsWith('.')) host = host.slice(0, -1);
  if (host === '' || host.length > 253) return null;
  if (!host.split('.').every((label) => HOSTNAME_LABEL.test(label))) return null;
  return host;
}

/**
 * Where `host` lives, judged by its shape alone. No DNS lookup, no network I/O.
 *
 * Private: `localhost`; single-label names (Docker service names such as
 * `minio`, `greptimedb`, `ollama`); IPv4 in 10/8, 172.16/12, 192.168/16, 127/8,
 * 169.254/16; IPv6 `::1`, `fc00::/7`, `fe80::/10`; names ending in `.internal`,
 * `.local`, `.lan`, `.home.arpa`, `.svc`, `.cluster.local` (or `.localhost`).
 * Everything else is public. Empty or unparsable is `unknown`. A port, scheme,
 * path or brackets are stripped first ({@link hostnameOf}).
 *
 * @param host - a hostname, `host:port`, IP literal or URL.
 * @returns the scope.
 *
 * @example
 * ```ts
 * classifyHost('minio:9000');                   // 'private'
 * classifyHost('contoso.openai.azure.com');     // 'public'
 * classifyHost('');                             // 'unknown'
 * ```
 *
 * @stability experimental
 */
export function classifyHost(host: string | null | undefined): EgressScope {
  const name = hostnameOf(host);
  if (name === null) return 'unknown';

  const v6 = ipv6Hextets(name);
  if (v6) return isPrivateIpv6(v6) ? 'private' : 'public';
  if (isIpv4(name)) return isPrivateIpv4(name) ? 'private' : 'public';
  if (/^[\d.]+$/.test(name)) return 'unknown';

  if (name === 'localhost' || !name.includes('.')) return 'private';
  if (PRIVATE_SUFFIXES.some((suffix) => name.endsWith(suffix))) return 'private';
  return 'public';
}

const SCOPE_RANK: Readonly<Record<EgressScope, number>> = { private: 0, unknown: 1, public: 2 };

/**
 * The worst scope over `hosts` (`public`, then `unknown`, then `private`); `unknown`
 * when there is no host at all. Pure.
 *
 * @param hosts - hostnames (or anything {@link classifyHost} accepts).
 * @returns the scope the dependency is graded on.
 *
 * @stability experimental
 */
export function scopeOfHosts(hosts: readonly string[]): EgressScope {
  if (hosts.length === 0) return 'unknown';
  return hosts
    .map((host) => classifyHost(host))
    .reduce<EgressScope>((worst, scope) => (SCOPE_RANK[scope] > SCOPE_RANK[worst] ? scope : worst), 'private');
}

/**
 * Builds an {@link EgressDependency} from a contributor's input: every entry of
 * `hosts` is reduced to its hostname ({@link hostnameOf}; empty and unparsable
 * ones are dropped), de-duplicated in order, capped at {@link EGRESS_MAX_HOSTS},
 * and `scope` is computed with {@link scopeOfHosts}. This is the one way a
 * contributor should build an entry: it guarantees no URL path, query, port or
 * userinfo leaves `describe()`.
 *
 * @param input - the dependency, with raw `hosts`.
 * @returns the normalised dependency.
 *
 * @example
 * ```ts
 * egressDependency({ id: 'email.smtp', capability: 'Email (SMTP)', direction: 'server',
 *   enabled: true, required: false, hosts: ['smtp.corp.internal'], degradation: 'No email is sent' });
 * ```
 *
 * @stability experimental
 */
export function egressDependency(input: EgressDependencyInput): EgressDependency {
  const hosts: string[] = [];
  for (const raw of input.hosts) {
    const host = hostnameOf(raw);
    if (host !== null && !hosts.includes(host)) hosts.push(host);
    if (hosts.length >= EGRESS_MAX_HOSTS) break;
  }
  return { ...input, hosts, scope: scopeOfHosts(hosts) };
}
