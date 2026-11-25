// The pinned GET transport (PP-15.5, #1183), against a local HTTP server: it
// pins the checked address, never follows a redirect, caps the body and times out.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { PinnedGetError, nodePinnedGetTransport, resolveWebhookTarget } from '../src/core/index';

const PERMISSIVE = { allowInsecureHttp: true, allowPrivateTargets: true, allowedHosts: [] as string[] };

describe('nodePinnedGetTransport', () => {
  let server: Server;
  let port: number;
  const seen: Array<{ url?: string; host?: string; accept?: string }> = [];

  beforeAll(async () => {
    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      seen.push({ url: req.url, host: req.headers.host, accept: String(req.headers.accept) });
      if (req.url === '/ok') {
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'max-age=60' });
        res.end('{"a":1}');
      } else if (req.url === '/redirect') {
        res.writeHead(302, { location: '/ok' });
        res.end();
      } else if (req.url === '/big') {
        res.writeHead(200);
        res.end(Buffer.alloc(5000, 0x61));
      } else if (req.url === '/slow') {
        // never answers
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(async () => {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  });

  const target = (path: string) =>
    resolveWebhookTarget(`http://pinned.example.test:${port}${path}`, PERMISSIVE, { resolveAll: async () => [{ address: '127.0.0.1', family: 4 as const }] });

  it('connects to the checked address while presenting the host name', async () => {
    const response = await nodePinnedGetTransport.get({ target: await target('/ok'), headers: { accept: 'application/json' }, timeoutMs: 2000, maxBytes: 1024 });
    expect(response.status).toBe(200);
    expect(response.body.toString()).toBe('{"a":1}');
    expect(response.headers['cache-control']).toBe('max-age=60');
    expect(seen.at(-1)).toMatchObject({ url: '/ok', host: `pinned.example.test:${port}`, accept: 'application/json' });
  });
  it('returns a 3xx as it is and never follows it', async () => {
    const before = seen.length;
    const response = await nodePinnedGetTransport.get({ target: await target('/redirect'), headers: {}, timeoutMs: 2000, maxBytes: 1024 });
    expect(response.status).toBe(302);
    expect(seen.length - before).toBe(1);
  });
  it('aborts a body over the cap', async () => {
    await expect(nodePinnedGetTransport.get({ target: await target('/big'), headers: {}, timeoutMs: 2000, maxBytes: 1000 })).rejects.toMatchObject({ code: 'too_large' });
  });
  it('times out', async () => {
    await expect(nodePinnedGetTransport.get({ target: await target('/slow'), headers: {}, timeoutMs: 200, maxBytes: 1000 })).rejects.toBeInstanceOf(PinnedGetError);
  });
});
