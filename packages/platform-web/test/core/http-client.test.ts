// The browser HTTP client moved from the reference app (issue #727). The app's
// own suites (apps/web/src/__tests__/services/api*.test.ts) still run through
// it end to end against a mock server; these pin the package-level contract
// with a stubbed fetch: the bearer header, the one refresh-and-retry, the
// session-expired signal, the error hook and the refresh lock name.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError, PlatformHttpClient, isPlatformApiError } from '../../src/core/index.js';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('PlatformHttpClient', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('prefixes the base URL, sends the bearer token and unwraps the data envelope', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { data: { ok: true } }));
    const client = new PlatformHttpClient({ baseUrl: '/api', refreshLockName: 'test-lock' });
    client.setAccessToken('tok');

    await expect(client.get('/thing')).resolves.toEqual({ ok: true });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/thing');
    expect((init?.headers as Record<string, string>)['Authorization']).toBe('Bearer tok');
    expect(init?.credentials).toBe('include');
  });

  it('omits the bearer token with skipAuth', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { data: [] }));
    const client = new PlatformHttpClient({ baseUrl: '/api', refreshLockName: 'test-lock' });
    client.setAccessToken('tok');

    await client.get('/auth/providers', { skipAuth: true });

    const init = fetchMock.mock.calls[0]![1];
    expect((init?.headers as Record<string, string>)['Authorization']).toBeUndefined();
  });

  it('refreshes once on a 401 and retries with the new token', async () => {
    fetchMock
      .mockResolvedValueOnce(json(401, { message: 'expired' }))
      .mockResolvedValueOnce(json(200, { data: { accessToken: 'fresh' } }))
      .mockResolvedValueOnce(json(200, { data: 'second try' }));
    const client = new PlatformHttpClient({ baseUrl: '/api', refreshLockName: 'test-lock' });
    client.setAccessToken('stale');

    await expect(client.get('/thing')).resolves.toBe('second try');

    expect(fetchMock.mock.calls[1]![0]).toBe('/api/auth/refresh');
    const retry = fetchMock.mock.calls[2]![1];
    expect((retry?.headers as Record<string, string>)['Authorization']).toBe('Bearer fresh');
    expect(client.getAccessToken()).toBe('fresh');
  });

  it('signals a lost session when a held session is refused a refresh', async () => {
    fetchMock.mockResolvedValueOnce(json(401, {})).mockResolvedValueOnce(json(401, {}));
    const client = new PlatformHttpClient({ baseUrl: '/api', refreshLockName: 'test-lock' });
    const expired = vi.fn();
    client.onSessionExpired(expired);
    client.setAccessToken('stale');

    await expect(client.get('/thing')).rejects.toMatchObject({ status: 401, name: 'ApiError' });
    expect(expired).toHaveBeenCalledTimes(1);
    expect(client.getAccessToken()).toBeNull();
  });

  it('never signals a lost session for a page that held no token', async () => {
    fetchMock.mockResolvedValueOnce(json(401, {}));
    const client = new PlatformHttpClient({ baseUrl: '/api', refreshLockName: 'test-lock' });
    const expired = vi.fn();
    client.onSessionExpired(expired);

    await expect(client.refreshToken()).resolves.toBe(false);
    expect(expired).not.toHaveBeenCalled();
  });

  it('hands every error response to onErrorResponse and still throws an ApiError', async () => {
    fetchMock.mockResolvedValueOnce(
      json(503, { message: 'down', code: 'SERVICE_UNAVAILABLE', details: { reason: 'maintenance' } }),
    );
    const onErrorResponse = vi.fn();
    const client = new PlatformHttpClient({ baseUrl: '/api', refreshLockName: 'test-lock', onErrorResponse });

    const error = await client.get('/thing').catch((caught: unknown) => caught);

    expect(onErrorResponse).toHaveBeenCalledWith(503, {
      message: 'down',
      code: 'SERVICE_UNAVAILABLE',
      details: { reason: 'maintenance' },
    });
    expect(error).toBeInstanceOf(ApiError);
    expect(isPlatformApiError(error)).toBe(true);
    expect(error).toMatchObject({ status: 503, message: 'down', code: 'SERVICE_UNAVAILABLE' });
  });

  it('takes the refresh under the configured Web Lock', async () => {
    const requested: string[] = [];
    vi.stubGlobal('navigator', {
      locks: {
        request: (name: string, _options: unknown, callback: () => Promise<unknown>) => {
          requested.push(name);
          return callback();
        },
      },
    });
    fetchMock.mockResolvedValueOnce(json(200, { data: { accessToken: 'fresh' } }));
    const client = new PlatformHttpClient({ baseUrl: '/api', refreshLockName: 'my-app-auth-refresh' });

    await expect(client.refreshToken()).resolves.toBe(true);
    expect(requested).toEqual(['my-app-auth-refresh']);
  });
});
