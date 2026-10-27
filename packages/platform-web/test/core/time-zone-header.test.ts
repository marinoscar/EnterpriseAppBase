// Every packaged transport names the viewer's display zone in `X-Time-Zone`,
// so the API cuts calendar days in it for a user on "Automatic" (the server
// prefers the stored `profile.timezone`, then this header, then UTC).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TIME_ZONE_HEADER } from '@marinoscar/platform-contract/timezone';

import { PlatformHttpClient, connectSse, postSse, setPreferredTimeZone, timeZoneHeader } from '../../src/core/index.js';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function headersOf(call: Parameters<typeof fetch> | undefined): Record<string, string> {
  return (call?.[1]?.headers ?? {}) as Record<string, string>;
}

function endedStream() {
  return {
    status: 200,
    ok: true,
    body: {
      getReader: () => ({ read: vi.fn().mockResolvedValue({ done: true, value: undefined }), releaseLock: vi.fn() }),
      cancel: vi.fn().mockResolvedValue(undefined),
    },
  };
}

describe('X-Time-Zone on every request', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    setPreferredTimeZone('America/Costa_Rica');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setPreferredTimeZone(null);
  });

  it('the header name is the contract constant', () => {
    expect(TIME_ZONE_HEADER).toBe('x-time-zone');
    expect(timeZoneHeader()).toEqual({ 'x-time-zone': 'America/Costa_Rica' });
  });

  it('PlatformHttpClient sends the display zone on GET, POST and FormData requests', async () => {
    fetchMock.mockImplementation(async () => json(200, { data: null }));
    const client = new PlatformHttpClient({ baseUrl: '/api', refreshLockName: 'tz-lock' });
    client.setAccessToken('tok');

    await client.get('/a');
    await client.post('/b', { x: 1 });
    const form = new FormData();
    form.append('f', 'v');
    await client.postFormData('/c', form);

    for (const call of fetchMock.mock.calls) {
      expect(headersOf(call)[TIME_ZONE_HEADER]).toBe('America/Costa_Rica');
    }
    // FormData still carries no hand-set Content-Type.
    expect(headersOf(fetchMock.mock.calls[2])['Content-Type']).toBeUndefined();
  });

  it('follows a zone change between requests and is sent on unauthenticated calls', async () => {
    fetchMock.mockImplementation(async () => json(200, { data: null }));
    const client = new PlatformHttpClient({ baseUrl: '/api', refreshLockName: 'tz-lock' });

    await client.get('/auth/providers', { skipAuth: true });
    setPreferredTimeZone('Asia/Tokyo');
    await client.get('/auth/providers', { skipAuth: true });

    expect(headersOf(fetchMock.mock.calls[0])[TIME_ZONE_HEADER]).toBe('America/Costa_Rica');
    expect(headersOf(fetchMock.mock.calls[1])[TIME_ZONE_HEADER]).toBe('Asia/Tokyo');
  });

  it('keeps the header on the retry after a refresh', async () => {
    fetchMock
      .mockResolvedValueOnce(json(401, { message: 'expired' }))
      .mockResolvedValueOnce(json(200, { data: { accessToken: 'fresh' } }))
      .mockResolvedValueOnce(json(200, { data: 'ok' }));
    const client = new PlatformHttpClient({ baseUrl: '/api', refreshLockName: 'tz-lock' });
    client.setAccessToken('stale');

    await expect(client.get('/thing')).resolves.toBe('ok');
    expect(headersOf(fetchMock.mock.calls[2])[TIME_ZONE_HEADER]).toBe('America/Costa_Rica');
  });

  it("lets a caller's own header win", async () => {
    fetchMock.mockImplementation(async () => json(200, { data: null }));
    const client = new PlatformHttpClient({ baseUrl: '/api', refreshLockName: 'tz-lock' });

    await client.get('/a', { headers: { [TIME_ZONE_HEADER]: 'Europe/Paris' } });
    expect(headersOf(fetchMock.mock.calls[0])[TIME_ZONE_HEADER]).toBe('Europe/Paris');
  });

  it('postSse sends the display zone', async () => {
    fetchMock.mockResolvedValue(endedStream() as unknown as Response);
    await postSse({
      url: '/api/ai/responses/stream',
      body: {},
      authorization: () => 'Bearer t',
      reauthenticate: vi.fn().mockResolvedValue(true),
      onFrame: vi.fn(),
    });
    expect(headersOf(fetchMock.mock.calls[0])[TIME_ZONE_HEADER]).toBe('America/Costa_Rica');
  });

  it('connectSse sends the display zone', async () => {
    fetchMock.mockResolvedValue(endedStream() as unknown as Response);
    const connection = connectSse({
      url: '/api/notifications/stream',
      onOpen: vi.fn(),
      authorization: () => 'Bearer t',
      reauthenticate: vi.fn().mockResolvedValue(true),
      onFrame: vi.fn(),
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    connection.close();
    expect(headersOf(fetchMock.mock.calls[0])[TIME_ZONE_HEADER]).toBe('America/Costa_Rica');
  });
});
