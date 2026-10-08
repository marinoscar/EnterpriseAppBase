// The adapter from the browser HTTP client to the transport port (issue #868),
// moved from the reference app's `platform/platformHost.tsx`. The app's own
// suite (apps/web/src/__tests__/platform/platformHost.test.tsx) still runs it
// end to end against a mock server; these pin the package-level contract with
// a stubbed fetch.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ApiError,
  PlatformHttpClient,
  createPlatformApiClient,
  isPlatformApiError,
  toHttpRequestOptions,
  toPlatformApiError,
} from '../../src/core/index.js';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function headersOf(init: RequestInit | undefined): Record<string, string> {
  return (init?.headers ?? {}) as Record<string, string>;
}

describe('toPlatformApiError', () => {
  it('maps an ApiError onto PlatformApiError, code and details included', () => {
    const mapped = toPlatformApiError(new ApiError('Nope', 409, 'CONFLICT', { reason: 'stale' }));
    expect(isPlatformApiError(mapped)).toBe(true);
    expect(mapped).toMatchObject({ name: 'PlatformApiError', status: 409, message: 'Nope', code: 'CONFLICT' });
    expect((mapped as { details?: unknown }).details).toEqual({ reason: 'stale' });
    expect(mapped).not.toBeInstanceOf(ApiError);
  });

  it('omits code and details the API did not send', () => {
    const mapped = toPlatformApiError(new ApiError('Gone', 404)) as Record<string, unknown>;
    expect('code' in mapped).toBe(false);
    expect('details' in mapped).toBe(false);
  });

  it('passes anything else through untouched', () => {
    const network = new TypeError('Failed to fetch');
    expect(toPlatformApiError(network)).toBe(network);
  });
});

describe('toHttpRequestOptions', () => {
  it('returns undefined for no options', () => {
    expect(toHttpRequestOptions(undefined)).toBeUndefined();
  });

  it('puts extra headers first so If-Match wins', () => {
    const signal = new AbortController().signal;
    expect(toHttpRequestOptions({ signal, ifMatch: '3', headers: { 'x-link-token': 't', 'If-Match': 'old' } })).toEqual({
      signal,
      headers: { 'x-link-token': 't', 'If-Match': '3' },
    });
  });

  it('sends no headers object when there are none', () => {
    expect(toHttpRequestOptions({})).toEqual({});
  });
});

describe('createPlatformApiClient', () => {
  const fetchMock = vi.fn<typeof fetch>();
  let http: PlatformHttpClient;

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    http = new PlatformHttpClient({ baseUrl: '/api', refreshLockName: 'test-lock' });
    http.setAccessToken('tok');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is frozen and has no postSse unless one is given', () => {
    const client = createPlatformApiClient(http);
    expect(Object.isFrozen(client)).toBe(true);
    expect(client.postSse).toBeUndefined();
    expect(typeof client.getBlob).toBe('function');
    expect(typeof client.postBlob).toBe('function');
  });

  it('unwraps the envelope with the bearer token, and rejects an error status as a PlatformApiError', async () => {
    const client = createPlatformApiClient(http);
    fetchMock.mockResolvedValueOnce(json(200, { data: { ok: true } }));
    await expect(client.get('/thing')).resolves.toEqual({ ok: true });
    expect(headersOf(fetchMock.mock.calls[0]![1])['Authorization']).toBe('Bearer tok');

    fetchMock.mockResolvedValueOnce(json(403, { message: 'Forbidden', code: 'NO' }));
    const error = await client.get('/thing').catch((e: unknown) => e);
    expect(isPlatformApiError(error)).toBe(true);
    expect(error).toMatchObject({ status: 403, message: 'Forbidden', code: 'NO' });
  });

  it('sends ifMatch as If-Match on PUT, PATCH and DELETE, and the JSON body', async () => {
    const client = createPlatformApiClient(http);
    fetchMock.mockImplementation(() => Promise.resolve(json(200, { data: null })));

    await client.put('/a', { x: 1 }, { ifMatch: '1' });
    await client.patch('/b', { y: 2 }, { ifMatch: '2' });
    await client.delete('/c', { ifMatch: '3' });
    await client.post('/d', { z: 3 });

    const calls = fetchMock.mock.calls;
    expect(calls.map(([url, init]) => [url, init?.method])).toEqual([
      ['/api/a', 'PUT'],
      ['/api/b', 'PATCH'],
      ['/api/c', 'DELETE'],
      ['/api/d', 'POST'],
    ]);
    expect(headersOf(calls[0]![1])['If-Match']).toBe('1');
    expect(headersOf(calls[1]![1])['If-Match']).toBe('2');
    expect(headersOf(calls[2]![1])['If-Match']).toBe('3');
    expect(calls[3]![1]?.body).toBe(JSON.stringify({ z: 3 }));
  });

  it('getBlob and postBlob return the raw body and headers, not the envelope', async () => {
    const client = createPlatformApiClient(http);
    fetchMock.mockResolvedValueOnce(
      new Response('bytes', { status: 200, headers: { 'Content-Disposition': 'attachment; filename="a.zip"' } }),
    );
    const got = await client.getBlob!('/download');
    expect(await got.blob.text()).toBe('bytes');
    expect(got.headers.get('content-disposition')).toBe('attachment; filename="a.zip"');

    fetchMock.mockResolvedValueOnce(new Response('csv', { status: 200 }));
    const posted = await client.postBlob!('/export', { q: 1 });
    expect(await posted.blob.text()).toBe('csv');
    expect(fetchMock.mock.calls[1]![1]?.method).toBe('POST');
  });

  it('maps the errors of the given postSse', async () => {
    const postSse = vi.fn().mockRejectedValue(new ApiError('Refused', 503, 'MAINTENANCE'));
    const client = createPlatformApiClient(http, { postSse });
    const onFrame = vi.fn();

    const error = await client.postSse!('/stream', { a: 1 }, { onFrame }).catch((e: unknown) => e);

    expect(postSse).toHaveBeenCalledWith('/stream', { a: 1 }, { onFrame });
    expect(isPlatformApiError(error)).toBe(true);
    expect(error).not.toBeInstanceOf(ApiError);
  });
});
