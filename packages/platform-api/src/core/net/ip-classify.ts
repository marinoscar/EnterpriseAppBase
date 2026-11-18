// =============================================================================
// Public-address classification (issue #1046)
// =============================================================================
//
// PURE: no DNS, no socket. Given a literal IPv4 or IPv6 address, says whether
// it is a unicast address on the public internet. Everything else is "blocked"
// for an outbound request an end user can aim (a webhook, a link preview): the
// loopback and private ranges, link-local (including the cloud metadata
// address 169.254.169.254), carrier-grade NAT, the documentation and
// benchmarking ranges, multicast, the unspecified address and every IPv6 form
// that embeds an IPv4 address (IPv4-mapped `::ffff:a.b.c.d`, NAT64
// `64:ff9b::/96`, 6to4 `2002::/16`, the deprecated IPv4-compatible `::a.b.c.d`),
// which are judged by the IPv4 address they carry.
//
// It is deliberately stricter than the doctor's egress inventory
// (`classifyHost`), which grades a NAME by its shape for a report. This is a
// gate: when in doubt it answers "blocked".
// =============================================================================

import { isIP } from 'node:net';

const IPV4_BLOCKS: ReadonlyArray<readonly [string, number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

function ipv4ToInt(address: string): number | null {
  const parts = address.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

function inBlock(value: number, base: string, bits: number): boolean {
  const start = ipv4ToInt(base) as number;
  const size = 2 ** (32 - bits);
  return value >= start && value < start + size;
}

/**
 * Whether a literal IPv4 address is not publicly routable.
 *
 * @param address - dotted-quad notation.
 * @returns `true` for a private, loopback, link-local, CGNAT, reserved,
 *   documentation, multicast or unspecified address, and for anything that is
 *   not a valid dotted quad.
 *
 * @stability experimental
 */
export function isBlockedIpv4(address: string): boolean {
  const value = ipv4ToInt(address);
  if (value === null) return true;
  return IPV4_BLOCKS.some(([base, bits]) => inBlock(value, base, bits));
}

/** The eight 16-bit groups of an IPv6 literal, or `null`. A zone id (`%eth0`) is dropped. */
function ipv6Groups(input: string): number[] | null {
  let address = input;
  const zone = address.indexOf('%');
  if (zone >= 0) address = address.slice(0, zone);

  // A trailing dotted quad is two groups.
  const lastColon = address.lastIndexOf(':');
  if (lastColon >= 0 && address.slice(lastColon + 1).includes('.')) {
    const value = ipv4ToInt(address.slice(lastColon + 1));
    if (value === null) return null;
    address = `${address.slice(0, lastColon + 1)}${(value >>> 16).toString(16)}:${(value & 0xffff).toString(16)}`;
  }

  const halves = address.split('::');
  if (halves.length > 2) return null;
  const parse = (part: string): number[] | null => {
    if (part === '') return [];
    const out: number[] = [];
    for (const piece of part.split(':')) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(piece)) return null;
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

function embeddedIpv4(high: number, low: number): string {
  return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
}

/**
 * Whether a literal IPv6 address is not publicly routable. An address that
 * embeds an IPv4 address is judged by the one it embeds.
 *
 * @param address - an IPv6 literal, with or without a zone id.
 * @returns `true` when blocked, and for anything that is not a valid literal.
 *
 * @stability experimental
 */
export function isBlockedIpv6(address: string): boolean {
  const g = ipv6Groups(address);
  if (g === null) return true;
  const [g0, g1, g2, g3, g4, g5, g6, g7] = g as [number, number, number, number, number, number, number, number];

  // :: and ::1, and the deprecated IPv4-compatible ::a.b.c.d (first 96 bits zero).
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) return true;
  // IPv4-mapped ::ffff:a.b.c.d.
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0xffff) return isBlockedIpv4(embeddedIpv4(g6, g7));
  // NAT64 64:ff9b::/96 and the local-use 64:ff9b:1::/48.
  if (g0 === 0x64 && g1 === 0xff9b) return g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0 ? isBlockedIpv4(embeddedIpv4(g6, g7)) : true;
  // 6to4 2002::/16 carries the IPv4 address in the next 32 bits.
  if (g0 === 0x2002) return isBlockedIpv4(embeddedIpv4(g1, g2));
  // Teredo 2001::/32 and the IETF protocol assignments 2001::/23 (incl. ORCHID).
  if (g0 === 0x2001 && g1 < 0x200) return true;
  // Documentation 2001:db8::/32 and 3fff::/20.
  if (g0 === 0x2001 && g1 === 0x0db8) return true;
  if (g0 === 0x3fff && (g1 & 0xf000) === 0) return true;
  // Discard-only 100::/64.
  if (g0 === 0x0100 && g1 === 0 && g2 === 0 && g3 === 0) return true;
  // Unique local fc00::/7, link-local fe80::/10, deprecated site-local fec0::/10, multicast ff00::/8.
  if ((g0 & 0xfe00) === 0xfc00) return true;
  if ((g0 & 0xffc0) === 0xfe80) return true;
  if ((g0 & 0xffc0) === 0xfec0) return true;
  if ((g0 & 0xff00) === 0xff00) return true;
  // Anything outside the global unicast block 2000::/3 is not routable on the public internet.
  if ((g0 & 0xe000) !== 0x2000) return true;
  return false;
}

/**
 * Whether a literal address (IPv4 or IPv6) must not be the target of a request
 * an end user can aim. Anything that does not parse as an IP literal is blocked.
 *
 * @param address - an IP literal.
 * @returns `true` when blocked.
 *
 * @example
 * ```ts
 * isBlockedAddress('169.254.169.254'); // true  (cloud metadata)
 * isBlockedAddress('::ffff:10.0.0.1'); // true  (IPv4-mapped private)
 * isBlockedAddress('93.184.216.34');   // false
 * ```
 *
 * @stability experimental
 */
export function isBlockedAddress(address: string): boolean {
  const bare = address.startsWith('[') && address.endsWith(']') ? address.slice(1, -1) : address;
  const family = isIP(bare);
  if (family === 4) return isBlockedIpv4(bare);
  if (family === 6) return isBlockedIpv6(bare);
  return true;
}
