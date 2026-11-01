import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { isBlockedAddress, isBlockedIpv4, isBlockedIpv6 } from '../../src/core/index';
import {
  WebhookEgressError,
  hostForLog,
  nodeWebhookTransport,
  parseWebhookUrl,
  resolveWebhookTarget,
  type WebhookEgressPolicy,
} from '../../src/webhooks/index';
import { ScriptedHostResolver } from '../../src/webhooks/testing/index';
import { toSnippet, WebhookTransportError } from '../../src/webhooks/egress/transport';

const STRICT: WebhookEgressPolicy = { allowInsecureHttp: false, allowPrivateTargets: false, allowedHosts: [] };

describe('isBlockedAddress', () => {
  it.each([
    '0.0.0.0', '0.1.2.3', '10.0.0.1', '10.255.255.255', '100.64.0.1', '100.127.255.254', '127.0.0.1', '127.255.0.9',
    '169.254.169.254', '169.254.0.1', '172.16.0.1', '172.31.255.255', '192.0.0.8', '192.0.2.1', '192.168.0.1', '192.168.255.255',
    '198.18.0.1', '198.19.255.255', '198.51.100.7', '203.0.113.9', '224.0.0.1', '239.255.255.255', '240.0.0.1', '255.255.255.255',
  ])('blocks the IPv4 address %s', (address) => {
    expect(isBlockedIpv4(address)).toBe(true);
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each(['93.184.216.34', '8.8.8.8', '1.1.1.1', '172.15.255.255', '172.32.0.1', '100.63.255.255', '100.128.0.1', '192.167.1.1', '198.17.0.1', '11.0.0.1'])(
    'allows the public IPv4 address %s',
    (address) => {
      expect(isBlockedAddress(address)).toBe(false);
    },
  );

  it.each([
    '::', '::1', 'fe80::1', 'fe80::abcd:1%eth0', 'febf::1', 'fc00::1', 'fd12:3456::1', 'fec0::1', 'ff02::1', 'ff00::',
    '::ffff:10.0.0.1', '::ffff:127.0.0.1', '::ffff:169.254.169.254', '::ffff:192.168.1.1', '::ffff:a00:1', '::ffff:7f00:1',
    '::10.0.0.1', '64:ff9b::a00:1', '64:ff9b::7f00:1', '64:ff9b:1::1', '2002:a00:1::1', '2002:7f00:1::', '2001::1', '2001:db8::1', '3fff::1', '100::1',
    '1000::1',
  ])('blocks the IPv6 address %s', (address) => {
    expect(isBlockedIpv6(address)).toBe(true);
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each(['2606:4700:4700::1111', '2001:4860:4860::8888', '::ffff:93.184.216.34', '2a00:1450:4001::200e', '64:ff9b::5db8:d822'])(
    'allows the public IPv6 address %s',
    (address) => {
      expect(isBlockedAddress(address)).toBe(false);
    },
  );

  it('blocks anything that is not an address, and bracketed literals are judged inside', () => {
    expect(isBlockedAddress('example.test')).toBe(true);
    expect(isBlockedAddress('999.1.1.1')).toBe(true);
    expect(isBlockedAddress('')).toBe(true);
    expect(isBlockedAddress('[::1]')).toBe(true);
    expect(isBlockedAddress('[2606:4700:4700::1111]')).toBe(false);
  });
});

describe('parseWebhookUrl', () => {
  it('accepts https on the standard and high ports', () => {
    expect(parseWebhookUrl('https://receiver.example.test/a?b=1', STRICT).host).toBe('receiver.example.test');
    for (const port of [443, 8443, 1024, 9000, 65535]) expect(() => parseWebhookUrl(`https://receiver.example.test:${port}/`, STRICT)).not.toThrow();
  });

  it.each([
    ['not a url', 'invalid_url'],
    ['https://', 'invalid_url'],
    ['ftp://receiver.example.test/x', 'scheme_not_allowed'],
    ['http://receiver.example.test/x', 'scheme_not_allowed'],
    ['javascript:alert(1)', 'scheme_not_allowed'],
    ['https://user@receiver.example.test/x', 'userinfo_not_allowed'],
    ['https://user:pw@receiver.example.test/x', 'userinfo_not_allowed'],
    ['https://receiver.example.test:22/x', 'port_not_allowed'],
    ['https://receiver.example.test:1023/x', 'port_not_allowed'],
    ['https://receiver.example.test:25/x', 'port_not_allowed'],
  ])('refuses %s as %s', (url, code) => {
    expect(() => parseWebhookUrl(url, STRICT)).toThrow(expect.objectContaining({ code }));
  });

  it('allows http only with allowInsecureHttp, and low ports only with allowPrivateTargets', () => {
    expect(() => parseWebhookUrl('http://receiver.example.test/x', { ...STRICT, allowInsecureHttp: true })).not.toThrow();
    expect(() => parseWebhookUrl('https://receiver.example.test:22/x', { ...STRICT, allowPrivateTargets: true })).not.toThrow();
  });

  it('never puts the path or the query in an error message', () => {
    try {
      parseWebhookUrl('https://user:pw@receiver.example.test/secret/path?token=zzz', STRICT);
      throw new Error('should have refused');
    } catch (error) {
      expect(String((error as Error).message)).not.toMatch(/secret|token|zzz|pw/);
    }
  });
});

describe('resolveWebhookTarget', () => {
  it('pins the first address of a public name', async () => {
    const resolver = new ScriptedHostResolver().set('receiver.example.test', '93.184.216.34');
    const target = await resolveWebhookTarget('https://receiver.example.test/x', STRICT, resolver);
    expect(target).toMatchObject({ hostname: 'receiver.example.test', address: '93.184.216.34', family: 4 });
  });

  it('refuses a name when ANY of its addresses is not public', async () => {
    const resolver = new ScriptedHostResolver().set('mixed.example.test', '93.184.216.34', '10.0.0.7');
    await expect(resolveWebhookTarget('https://mixed.example.test/', STRICT, resolver)).rejects.toMatchObject({ code: 'private_target' });
    resolver.set('v6.example.test', '2606:4700:4700::1111', '::ffff:10.0.0.1');
    await expect(resolveWebhookTarget('https://v6.example.test/', STRICT, resolver)).rejects.toMatchObject({ code: 'private_target' });
  });

  it('refuses IP literals and localhost without a lookup', async () => {
    const resolver = new ScriptedHostResolver();
    for (const url of ['https://127.0.0.1/', 'https://[::1]/', 'https://169.254.169.254/latest/meta-data', 'https://localhost/', 'https://api.localhost/', 'https://[::ffff:10.0.0.1]/', 'https://2130706433/', 'https://0x7f.1/']) {
      await expect(resolveWebhookTarget(url, STRICT, resolver)).rejects.toBeInstanceOf(WebhookEgressError);
    }
    expect(resolver.lookups).toEqual([]);
  });

  it('answers unresolvable for a name with no address', async () => {
    await expect(resolveWebhookTarget('https://nowhere.example.test/', STRICT, new ScriptedHostResolver())).rejects.toMatchObject({ code: 'unresolvable' });
  });

  it('catches DNS rebinding: the name that was public yesterday is checked again now', async () => {
    const resolver = new ScriptedHostResolver().set('rebind.example.test', '93.184.216.34');
    await expect(resolveWebhookTarget('https://rebind.example.test/', STRICT, resolver)).resolves.toBeDefined();
    resolver.set('rebind.example.test', '127.0.0.1');
    await expect(resolveWebhookTarget('https://rebind.example.test/', STRICT, resolver)).rejects.toMatchObject({ code: 'private_target' });
  });

  it('honours allowPrivateTargets and allowedHosts, and only for what they name', async () => {
    const resolver = new ScriptedHostResolver().set('intranet.example.test', '10.1.1.1').set('other.example.test', '10.1.1.2');
    await expect(resolveWebhookTarget('https://intranet.example.test/', { ...STRICT, allowPrivateTargets: true }, resolver)).resolves.toMatchObject({ address: '10.1.1.1' });
    const allowed = { ...STRICT, allowedHosts: ['Intranet.Example.Test'] };
    await expect(resolveWebhookTarget('https://intranet.example.test/', allowed, resolver)).resolves.toMatchObject({ address: '10.1.1.1' });
    await expect(resolveWebhookTarget('https://other.example.test/', allowed, resolver)).rejects.toMatchObject({ code: 'private_target' });
  });
});

describe('hostForLog', () => {
  it('keeps only the host', () => {
    expect(hostForLog('https://user:pw@receiver.example.test:8443/a/b?token=1#frag')).toBe('receiver.example.test:8443');
    expect(hostForLog('nonsense')).toBe('unknown');
  });
});

describe('nodeWebhookTransport (against a local server)', () => {
  let server: Server;
  let port: number;
  let handler: (request: IncomingMessage, response: ServerResponse, body: string) => void;
  const seen: Array<{ host: string | undefined; headers: IncomingMessage['headers']; body: string }> = [];

  beforeAll(async () => {
    server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        seen.push({ host: request.headers.host, headers: request.headers, body });
        handler(request, response, body);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    seen.length = 0;
    handler = (_request, response) => {
      response.statusCode = 200;
      response.end('ok');
    };
  });

  const target = (hostname = 'receiver.example.test', extra = '/in?x=1') => ({
    url: new URL(`http://${hostname}:${port}${extra}`),
    hostname,
    address: '127.0.0.1',
    family: 4 as const,
  });

  it('connects to the PINNED address while presenting the name, and posts the exact body', async () => {
    const response = await nodeWebhookTransport.send({ target: target(), headers: { 'content-type': 'application/json', 'x-test': '1' }, body: '{"a":1}', timeoutMs: 2000 });
    expect(response).toEqual({ status: 200, retryAfter: null, snippet: 'ok' });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.host).toBe(`receiver.example.test:${port}`);
    expect(seen[0]!.body).toBe('{"a":1}');
    expect(seen[0]!.headers['x-test']).toBe('1');
  });

  it('does not follow a redirect: the 3xx is the answer', async () => {
    handler = (_request, response) => {
      response.statusCode = 302;
      response.setHeader('location', 'http://127.0.0.1:1/elsewhere');
      response.end();
    };
    const response = await nodeWebhookTransport.send({ target: target(), headers: {}, body: '{}', timeoutMs: 2000 });
    expect(response.status).toBe(302);
    expect(seen).toHaveLength(1);
  });

  it('reports Retry-After and keeps at most 1 KiB of the body, control characters removed', async () => {
    handler = (_request, response) => {
      response.statusCode = 429;
      response.setHeader('retry-after', '120');
      response.end(`bad\u0000\u0007${'x'.repeat(5000)}`);
    };
    const response = await nodeWebhookTransport.send({ target: target(), headers: {}, body: '{}', timeoutMs: 2000 });
    expect(response.status).toBe(429);
    expect(response.retryAfter).toBe('120');
    expect(response.snippet.length).toBe(1024);
    expect(response.snippet.startsWith('badxxx')).toBe(true);
  });

  it('times out with a stable code', async () => {
    handler = () => undefined;
    await expect(nodeWebhookTransport.send({ target: target(), headers: {}, body: '{}', timeoutMs: 150 })).rejects.toMatchObject({ code: 'timeout' });
  });

  it('reports a refused connection as a network failure without the URL', async () => {
    const dead = { url: new URL('http://receiver.example.test:1/secret/path?token=zzz'), hostname: 'receiver.example.test', address: '127.0.0.1', family: 4 as const };
    const error = await nodeWebhookTransport.send({ target: dead, headers: {}, body: '{}', timeoutMs: 2000 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WebhookTransportError);
    expect((error as WebhookTransportError).code).toBe('network');
    expect(String((error as Error).message)).not.toMatch(/secret|token|zzz/);
  });
});

describe('toSnippet', () => {
  it('strips control characters and caps the length', () => {
    expect(toSnippet('a\u0000b\nc\u007fd')).toBe('ab\ncd');
    expect(toSnippet('y'.repeat(3000))).toHaveLength(1024);
  });
});
