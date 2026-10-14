import { isIP } from 'node:net';

import { telemetryIpVersion } from '@marinoscar/platform-contract/telemetry';

import {
  TELEMETRY_CONNECTION_CARRIES_NO_SECRET,
  TELEMETRY_DEFAULT_DATABASE,
  TELEMETRY_DEFAULT_PG_PORT,
  telemetryConnectionValueSchema,
  telemetryHostSchema,
} from './telemetry-connection.schema';

// The host rule moved to `@marinoscar/platform-contract/telemetry` (#702),
// which runs in the browser too and so cannot use `node:net`. It reproduces
// `net.isIP` with Node's own grammar; this spec proves the two agree, so the
// move changed no accepted or refused host.

const CORPUS: string[] = [
  // IPv4
  '0.0.0.0',
  '127.0.0.1',
  '10.0.0.255',
  '255.255.255.255',
  '256.0.0.1',
  '01.2.3.4',
  '1.2.3',
  '1.2.3.4.5',
  '1.2.3.4 ',
  '1..3.4',
  '192.168.1.1/24',
  // IPv6
  '::',
  '::1',
  '::ffff:192.168.0.1',
  '2001:db8::1',
  '2001:0db8:0000:0000:0000:ff00:0042:8329',
  'fe80::1%eth0',
  'fe80::1%',
  '1:2:3:4:5:6:7:8',
  '1:2:3:4:5:6:7:8:9',
  '1:2:3:4:5:6:7::',
  '1::2::3',
  ':::',
  'gggg::1',
  '12345::1',
  '[::1]',
  '1:2:3:4:5:6:1.2.3.4',
  '1:2:3:4:5:1.2.3.4',
  '::1.2.3.4',
  // Hostnames and junk
  'greptimedb',
  'greptime.internal',
  'http://greptimedb',
  'greptimedb:4003',
  '',
  ' ',
  'a b',
];

/** Deterministic pseudo-random strings over the IP alphabets. */
function generated(count: number): string[] {
  let seed = 7;
  const next = () => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return seed;
  };
  const alphabet = '0123456789abcdefABCDEF:.%z';
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const length = 1 + (next() % 24);
    let s = '';
    for (let j = 0; j < length; j++) s += alphabet[next() % alphabet.length];
    out.push(s);
  }
  return out;
}

/** Deterministic IPv6-shaped strings: 1-9 groups, some empty (`::`), some an IPv4 tail. */
function generatedIpv6(count: number): string[] {
  let seed = 11;
  const next = () => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return seed;
  };
  const group = () => ['', '0', '1', 'ffff', 'db8', '12345', 'g1', '0db8'][next() % 8]!;
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const groups = Array.from({ length: 1 + (next() % 9) }, group);
    if (next() % 4 === 0) groups.push(['1.2.3.4', '256.1.1.1', '1.2.3'][next() % 3]!);
    out.push(groups.join(':') + (next() % 10 === 0 ? '%eth0' : ''));
  }
  return out;
}

describe('telemetry connection value schemas (contract)', () => {
  it.each(CORPUS)('telemetryIpVersion(%j) equals net.isIP', (value) => {
    expect(telemetryIpVersion(value)).toBe(isIP(value));
  });

  it('agrees with net.isIP over generated IP-like strings', () => {
    const corpus = [...generated(20_000), ...generatedIpv6(20_000)];
    const disagreements = corpus.filter((value) => telemetryIpVersion(value) !== isIP(value));
    expect(disagreements).toEqual([]);
  });

  it('accepts hostnames and IP literals, refuses a scheme, a port or a path', () => {
    for (const host of ['greptimedb', 'otel_collector', '10.0.0.5', '2001:db8::1', ' greptimedb ']) {
      expect(telemetryHostSchema.safeParse(host).success).toBe(true);
    }
    for (const host of ['http://greptimedb', 'greptimedb:4003', 'greptimedb/x', '', '-bad']) {
      expect(telemetryHostSchema.safeParse(host).success).toBe(false);
    }
  });

  it('keeps the defaults and the no-secret proof', () => {
    expect(TELEMETRY_DEFAULT_PG_PORT).toBe(4003);
    expect(TELEMETRY_DEFAULT_DATABASE).toBe('public');
    expect(TELEMETRY_CONNECTION_CARRIES_NO_SECRET).toBe(true);
    expect(telemetryConnectionValueSchema.parse({ host: null, pgPort: 4003 })).toEqual({ host: null });
  });
});
