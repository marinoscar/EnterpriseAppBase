// PP-15.5 (#1183): client identity unit tests. No database, no network: the CIMD
// transport and the DNS resolver are scripted ports.
import {
  CIMD_MAX_BYTES,
  CimdError,
  CimdFetcher,
  cimdExpiry,
  evaluateClientTrust,
  parseCimdClientId,
  validateCimdDocument,
  type TrustSettings,
} from '../../../src/identity/oauth-server/clients/index';
import { sharedRedirectHost, validateRedirectUris } from '../../../src/identity/oauth-server/clients/client-redirects';
import { PinnedGetError, type PinnedGetRequest, type PinnedGetResponse, type PinnedGetTransport } from '../../../src/core/index';

const CLIENT_ID = 'https://client.example.test/oauth/metadata.json';
const doc = (over: Record<string, unknown> = {}) => ({
  client_id: CLIENT_ID,
  client_name: 'Client Alpha',
  redirect_uris: ['https://client.example.test/callback'],
  ...over,
});

class Script implements PinnedGetTransport {
  readonly calls: PinnedGetRequest[] = [];
  constructor(private readonly answer: (req: PinnedGetRequest) => PinnedGetResponse | Promise<PinnedGetResponse>) {}
  async get(req: PinnedGetRequest): Promise<PinnedGetResponse> {
    this.calls.push(req);
    return this.answer(req);
  }
}
const ok = (body: unknown, headers: Record<string, string> = {}): PinnedGetResponse => ({ status: 200, headers, body: Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)) });
const publicDns = { resolveAll: async () => [{ address: '93.184.216.34', family: 4 as const }] };

async function fetchWith(transport: PinnedGetTransport, resolver = publicDns, url = CLIENT_ID) {
  return new CimdFetcher(transport, resolver).fetch(new URL(url));
}
async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return error instanceof CimdError ? error.code : `other:${String(error)}`;
  }
  return 'no error';
}

describe('parseCimdClientId', () => {
  it('accepts an https URL with a path', () => {
    expect(parseCimdClientId(CLIENT_ID)?.hostname).toBe('client.example.test');
    expect(parseCimdClientId('https://client.example.test/a?x=1')).not.toBeNull();
  });
  it.each([
    ['an http URL', 'http://client.example.test/meta.json'],
    ['a URL with a fragment', 'https://client.example.test/meta.json#frag'],
    ['an empty fragment', 'https://client.example.test/meta.json#'],
    ['only an origin', 'https://client.example.test'],
    ['only an origin with a slash', 'https://client.example.test/'],
    ['userinfo', 'https://user:pw@client.example.test/meta.json'],
    ['a dot segment', 'https://client.example.test/a/../meta.json'],
    ['an encoded dot segment', 'https://client.example.test/a/%2e%2e/meta.json'],
    ['a single dot segment', 'https://client.example.test/./meta.json'],
    ['a non-canonical host case', 'https://Client.Example.test/meta.json'],
    ['an opaque id', 'oc_abc123'],
    ['garbage', 'https://'],
  ])('treats %s as an opaque id', (_label, value) => {
    expect(parseCimdClientId(value)).toBeNull();
  });
});

describe('validateCimdDocument', () => {
  const url = new URL(CLIENT_ID);
  it('accepts a minimal document', () => {
    const meta = validateCimdDocument(url, doc());
    expect(meta.name).toBe('Client Alpha');
    expect(meta.redirectUris).toEqual(['https://client.example.test/callback']);
    expect(meta.applicationType).toBe('web');
  });
  it('treats a loopback callback as a native client', () => {
    expect(validateCimdDocument(url, doc({ redirect_uris: ['http://127.0.0.1/cb'] })).applicationType).toBe('native');
  });
  it('refuses a client_id that differs from the URL', () => {
    expect(() => validateCimdDocument(url, doc({ client_id: 'https://client.example.test/other.json' }))).toThrow(expect.objectContaining({ code: 'client_id_mismatch' }));
  });
  it.each([
    ['no redirect_uris', { redirect_uris: undefined }],
    ['empty redirect_uris', { redirect_uris: [] }],
    ['a relative redirect URI', { redirect_uris: ['/cb'] }],
    ['an http redirect URI', { redirect_uris: ['http://client.example.test/cb'] }],
    ['a fragment redirect URI', { redirect_uris: ['https://client.example.test/cb#x'] }],
    ['no client_name', { client_name: undefined }],
    ['a blank client_name', { client_name: '   ' }],
    ['grant_types without authorization_code', { grant_types: ['client_credentials'] }],
    ['response_types without code', { response_types: ['token'] }],
    ['a bad application_type', { application_type: 'desktop' }],
  ])('refuses a document with %s', (_label, over) => {
    expect(() => validateCimdDocument(url, doc(over))).toThrow(expect.objectContaining({ code: 'invalid_document' }));
  });
  it('refuses a confidential client with a clear code', () => {
    expect(() => validateCimdDocument(url, doc({ token_endpoint_auth_method: 'private_key_jwt' }))).toThrow(expect.objectContaining({ code: 'confidential_not_supported' }));
    expect(validateCimdDocument(url, doc({ token_endpoint_auth_method: 'none' })).name).toBe('Client Alpha');
  });
  it('refuses a non-object document', () => {
    for (const bad of [null, [], 'text', 7]) expect(() => validateCimdDocument(url, bad)).toThrow(CimdError);
  });
  it('keeps a logo only when https and on the client host, and caps the name', () => {
    expect(validateCimdDocument(url, doc({ logo_uri: 'https://client.example.test/logo.png' })).logoUri).toBe('https://client.example.test/logo.png');
    expect(validateCimdDocument(url, doc({ logo_uri: 'https://cdn.example.test/logo.png' })).logoUri).toBeNull();
    expect(validateCimdDocument(url, doc({ logo_uri: 'http://client.example.test/logo.png' })).logoUri).toBeNull();
    expect(validateCimdDocument(url, doc({ client_name: 'x'.repeat(500) })).name).toHaveLength(200);
  });
});

describe('cimdExpiry', () => {
  const now = new Date('2026-01-01T00:00:00Z');
  const minutes = (n: number) => n * 60_000;
  it('clamps max-age to between 5 minutes and 24 hours', () => {
    expect(cimdExpiry({ 'cache-control': 'max-age=10' }, now).getTime() - now.getTime()).toBe(minutes(5));
    expect(cimdExpiry({ 'cache-control': 'max-age=3600' }, now).getTime() - now.getTime()).toBe(minutes(60));
    expect(cimdExpiry({ 'cache-control': 'public, max-age=99999999' }, now).getTime() - now.getTime()).toBe(minutes(24 * 60));
  });
  it('gives the minimum for no-store and no-cache, an hour for no headers, and honours Expires', () => {
    expect(cimdExpiry({ 'cache-control': 'no-store' }, now).getTime() - now.getTime()).toBe(minutes(5));
    expect(cimdExpiry({ 'cache-control': 'no-cache' }, now).getTime() - now.getTime()).toBe(minutes(5));
    expect(cimdExpiry({}, now).getTime() - now.getTime()).toBe(minutes(60));
    expect(cimdExpiry({ expires: new Date(now.getTime() + minutes(30)).toUTCString() }, now).getTime() - now.getTime()).toBe(minutes(30));
  });
});

describe('CimdFetcher', () => {
  it('fetches through the guard with the required request shape', async () => {
    const transport = new Script(() => ok(doc(), { 'cache-control': 'max-age=600' }));
    const result = await fetchWith(transport);
    expect(result.metadata.name).toBe('Client Alpha');
    const req = transport.calls[0]!;
    expect(req.headers.accept).toBe('application/json');
    expect(req.timeoutMs).toBe(5000);
    expect(req.maxBytes).toBe(64 * 1024);
    expect(req.target.address).toBe('93.184.216.34');
  });
  it('refuses a private address (the egress guard) without calling the transport', async () => {
    const transport = new Script(() => ok(doc()));
    const privateDns = { resolveAll: async () => [{ address: '10.0.0.5', family: 4 as const }] };
    expect(await codeOf(fetchWith(transport, privateDns))).toBe('egress_refused');
    const loopbackDns = { resolveAll: async () => [{ address: '127.0.0.1', family: 4 as const }] };
    expect(await codeOf(fetchWith(transport, loopbackDns))).toBe('egress_refused');
    expect(transport.calls).toHaveLength(0);
  });
  it('refuses a redirect response', async () => {
    expect(await codeOf(fetchWith(new Script(() => ({ status: 302, headers: { location: 'https://elsewhere.example.test/' }, body: Buffer.alloc(0) }))))).toBe('redirect');
  });
  it('refuses a non-200 answer', async () => {
    expect(await codeOf(fetchWith(new Script(() => ({ status: 500, headers: {}, body: Buffer.alloc(0) }))))).toBe('http_status');
  });
  it('refuses a non-JSON body', async () => {
    expect(await codeOf(fetchWith(new Script(() => ok('<html>nope</html>'))))).toBe('not_json');
  });
  it('refuses an oversized body (reported by the transport and by length)', async () => {
    expect(await codeOf(fetchWith(new Script(() => Promise.reject(new PinnedGetError('too_large', 'big')))))).toBe('too_large');
    expect(await codeOf(fetchWith(new Script(() => ({ status: 200, headers: {}, body: Buffer.alloc(CIMD_MAX_BYTES + 1, 0x20) }))))).toBe('too_large');
  });
  it('maps a transport timeout and network error', async () => {
    expect(await codeOf(fetchWith(new Script(() => Promise.reject(new PinnedGetError('timeout', 'slow')))))).toBe('timeout');
    expect(await codeOf(fetchWith(new Script(() => Promise.reject(new PinnedGetError('network', 'down')))))).toBe('network');
  });
  it('gives up when the whole fetch (DNS included) is too slow', async () => {
    jest.useFakeTimers();
    try {
      const stuck = new Script(() => new Promise<PinnedGetResponse>(() => undefined));
      const pending = codeOf(fetchWith(stuck));
      await jest.advanceTimersByTimeAsync(8_100);
      expect(await pending).toBe('timeout');
    } finally {
      jest.useRealTimers();
    }
  });
  it('never puts the document in an error message', async () => {
    const secret = 'SECRET-DOCUMENT-TEXT';
    try {
      await fetchWith(new Script(() => ok(`not json ${secret}`)));
    } catch (error) {
      expect(String((error as Error).message)).not.toContain(secret);
    }
  });
});

describe('redirect URI rules', () => {
  it('accepts https and loopback and rejects the rest', () => {
    expect(validateRedirectUris(['https://a.example.test/cb', 'http://127.0.0.1:5000/cb'], 'native')).toBeNull();
    expect(validateRedirectUris(['http://a.example.test/cb'], 'web')).not.toBeNull();
    expect(validateRedirectUris(['https://a.example.test/cb#x'], 'web')).not.toBeNull();
    expect(validateRedirectUris(['http://127.0.0.1/cb'], 'web')).not.toBeNull();
    expect(validateRedirectUris(Array.from({ length: 11 }, (_, i) => `https://a.example.test/${i}`), 'web')).not.toBeNull();
    expect(validateRedirectUris([`https://a.example.test/${'x'.repeat(2000)}`], 'web')).not.toBeNull();
    expect(validateRedirectUris([], 'web')).not.toBeNull();
    expect(validateRedirectUris(['https://u:p@a.example.test/cb'], 'web')).not.toBeNull();
  });
  it('allows a reverse-domain custom scheme only for a native client', () => {
    expect(validateRedirectUris(['com.example.app://cb'], 'native')).toBeNull();
    expect(validateRedirectUris(['com.example.app://cb'], 'web')).not.toBeNull();
    expect(validateRedirectUris(['myapp://cb'], 'native')).not.toBeNull();
    expect(validateRedirectUris(['javascript:alert(1)'], 'native')).not.toBeNull();
  });
  it('computes the shared host', () => {
    expect(sharedRedirectHost(['http://127.0.0.1/cb', 'http://localhost/cb'])).toBe('loopback');
    expect(sharedRedirectHost(['https://A.example.test/x', 'https://a.example.test/y', 'http://127.0.0.1/cb'])).toBe('a.example.test');
    expect(sharedRedirectHost(['https://a.example.test/x', 'https://b.example.test/y'])).toBeNull();
    expect(sharedRedirectHost(['com.example.app://cb'])).toBe('com.example.app');
  });
});

describe('the client trust policy', () => {
  const settings = (over: Partial<TrustSettings> = {}): TrustSettings => ({ allowedClientHosts: [], allowAnyClientHost: false, allowLoopbackClients: true, ...over });
  const cimd = (redirectUris: string[], host = 'client.example.test') => ({ kind: 'cimd' as const, host, redirectUris });

  it('always admits a registered client', () => {
    expect(evaluateClientTrust({ kind: 'registered', host: 'anything.example.test', redirectUris: [] }, settings()).admitted).toBe(true);
  });
  it('refuses a host that is not on the list, naming it', () => {
    const verdict = evaluateClientTrust({ kind: 'dynamic', host: 'stranger.example.test', redirectUris: ['https://stranger.example.test/cb'] }, settings());
    expect(verdict).toEqual({ admitted: false, host: 'stranger.example.test', reason: 'host_not_allowed' });
  });
  it('admits a host on the list, and any host with allowAnyClientHost', () => {
    expect(evaluateClientTrust({ kind: 'dynamic', host: 'a.example.test', redirectUris: [] }, settings({ allowedClientHosts: ['a.example.test'] })).admitted).toBe(true);
    expect(evaluateClientTrust({ kind: 'dynamic', host: 'b.example.test', redirectUris: [] }, settings({ allowAnyClientHost: true })).admitted).toBe(true);
  });
  it('admits loopback only while allowLoopbackClients is on', () => {
    const loopback = { kind: 'dynamic' as const, host: 'loopback', redirectUris: ['http://127.0.0.1/cb'] };
    expect(evaluateClientTrust(loopback, settings()).admitted).toBe(true);
    expect(evaluateClientTrust(loopback, settings({ allowLoopbackClients: false }))).toEqual({ admitted: false, host: 'loopback', reason: 'loopback_not_allowed' });
  });
  it('needs a CIMD host on the list', () => {
    expect(evaluateClientTrust(cimd(['https://client.example.test/cb']), settings()).admitted).toBe(false);
    expect(evaluateClientTrust(cimd(['https://client.example.test/cb']), settings({ allowedClientHosts: ['client.example.test'] })).admitted).toBe(true);
  });
  it('refuses a CIMD redirect URI on another host unless that host is allowed', () => {
    const subject = cimd(['https://other.example.test/cb']);
    expect(evaluateClientTrust(subject, settings({ allowedClientHosts: ['client.example.test'] }))).toEqual({
      admitted: false,
      host: 'client.example.test',
      reason: 'redirect_host_not_allowed',
    });
    expect(evaluateClientTrust(subject, settings({ allowedClientHosts: ['client.example.test', 'other.example.test'] })).admitted).toBe(true);
  });
  it('lets a CIMD client use a loopback callback', () => {
    expect(evaluateClientTrust(cimd(['http://127.0.0.1/cb']), settings({ allowedClientHosts: ['client.example.test'] })).admitted).toBe(true);
  });
});
