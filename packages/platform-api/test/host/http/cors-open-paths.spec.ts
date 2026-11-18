// `buildCorsOptions(raw, { openPaths })` (PP-15.6): open prefixes answer any origin without credentials, everything else
// keeps the policy. Run through the real CORS plugin on a Fastify instance, because the plugin answers preflights in an
// onRequest hook, before any route handler.
import { InvalidCorsOriginError, buildCorsOptions } from '../../../src/host/index';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const Fastify = require('fastify');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const cors = require('@fastify/cors');

const OPEN = ['/api/oauth/token', '/api/oauth/.well-known'];

async function app(raw: string | undefined) {
  const instance = Fastify();
  await instance.register(cors, buildCorsOptions(raw, { openPaths: OPEN }));
  instance.all('/api/*', async () => ({ ok: true }));
  await instance.ready();
  return instance;
}
const preflight = (instance: any, url: string, origin: string) =>
  instance.inject({ method: 'OPTIONS', url, headers: { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type, authorization' } });

describe('buildCorsOptions openPaths', () => {
  it('adds a delegator and keeps the origin policy; without openPaths nothing changes', () => {
    const options = buildCorsOptions('https://a.example', { openPaths: OPEN });
    expect(options.origin).toEqual(['https://a.example']);
    expect(options.delegator).toEqual(expect.any(Function));
    expect(buildCorsOptions('https://a.example', { maxAge: 5 })).toEqual({ origin: ['https://a.example'], credentials: true, maxAge: 5 });
    expect(buildCorsOptions('https://a.example', { openPaths: [] })).toEqual({ origin: ['https://a.example'], credentials: true });
  });

  it.each([['relative'], ['/api/oauth/'], ['/api//x'], ['']])('rejects the malformed prefix %p', (prefix) => {
    expect(() => buildCorsOptions(undefined, { openPaths: [prefix] })).toThrow(InvalidCorsOriginError);
  });

  it.each([['an allowlist', 'https://app.example'], ['same-origin only', undefined]])('with %s: an open path answers a wildcard preflight, no credentials', async (_name, raw) => {
    const instance = await app(raw);
    const res = await preflight(instance, '/api/oauth/token', 'https://third.example');
    expect(res.statusCode).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
    expect(res.headers['access-control-allow-headers']).toBe('content-type, authorization');
    expect(res.headers['access-control-max-age']).toBe('600');
    const get = await instance.inject({ method: 'GET', url: '/api/oauth/.well-known/authorization-server?x=1', headers: { origin: 'https://third.example' } });
    expect(get.headers['access-control-allow-origin']).toBe('*');
    expect(get.headers['access-control-allow-credentials']).toBeUndefined();
    await instance.close();
  });

  it('every other path keeps the allowlist: the listed origin with credentials, a stranger nothing', async () => {
    const instance = await app('https://app.example');
    const listed = await preflight(instance, '/api/users', 'https://app.example');
    expect(listed.headers['access-control-allow-origin']).toBe('https://app.example');
    expect(listed.headers['access-control-allow-credentials']).toBe('true');
    const stranger = await preflight(instance, '/api/users', 'https://third.example');
    expect(stranger.headers['access-control-allow-origin']).toBeUndefined();
    const sibling = await preflight(instance, '/api/oauth/tokenX', 'https://third.example');
    expect(sibling.headers['access-control-allow-origin']).toBeUndefined();
    const authorize = await preflight(instance, '/api/oauth/authorize', 'https://third.example');
    expect(authorize.headers['access-control-allow-origin']).toBeUndefined();
    await instance.close();
  });

  it('same-origin only: every other path still emits no CORS header', async () => {
    const instance = await app(undefined);
    const res = await instance.inject({ method: 'GET', url: '/api/users', headers: { origin: 'https://third.example' } });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    await instance.close();
  });
});
