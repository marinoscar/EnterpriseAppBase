import { renderHook, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { parseLinkTokenFromHash, usePublicLink } from '../../src/sharing/headless/index.js';
import { createTestApiError, createTestPlatformHost } from '../../src/testing/index.js';
import type { TestApiRequest } from '../../src/testing/index.js';
import { RESOLUTION, TOKEN } from './fixtures.js';

function setUrl(url: string) {
  window.history.replaceState(null, '', url);
}

/** Every storage write the page could make: none is allowed. */
function spyOnStorage() {
  return [
    vi.spyOn(Storage.prototype, 'setItem'),
    vi.spyOn(window.localStorage, 'setItem'),
    vi.spyOn(window.sessionStorage, 'setItem'),
  ];
}

describe('parseLinkTokenFromHash (#731)', () => {
  it('takes the token from a fragment, with or without the #', () => {
    expect(parseLinkTokenFromHash(`#${TOKEN}`)).toBe(TOKEN);
    expect(parseLinkTokenFromHash(TOKEN)).toBe(TOKEN);
  });

  it('refuses an empty or malformed fragment', () => {
    expect(parseLinkTokenFromHash('')).toBeNull();
    expect(parseLinkTokenFromHash('#')).toBeNull();
    expect(parseLinkTokenFromHash('#short')).toBeNull();
    expect(parseLinkTokenFromHash('#lnk_has spaces and <tags>')).toBeNull();
    expect(parseLinkTokenFromHash('#%E0%A4%A')).toBeNull();
  });
});

describe('usePublicLink (#731)', () => {
  beforeEach(() => setUrl(`/s#${TOKEN}`));
  afterEach(() => {
    vi.restoreAllMocks();
    setUrl('/');
  });

  it('removes the fragment at once, sends the token only in x-link-token and resolves', async () => {
    const storage = spyOnStorage();
    const host = createTestPlatformHost({ responses: { 'GET /public/links/current': RESOLUTION } });
    const { result } = renderHook(() => usePublicLink({ apiClient: host.api }));

    // The address bar has lost the token before the API answered.
    expect(window.location.hash).toBe('');
    expect(window.location.href).not.toContain(TOKEN);
    expect(window.location.pathname).toBe('/s');

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.resolution).toEqual(RESOLUTION);
    expect(result.current.token).toBe(TOKEN);
    expect(result.current.error).toBeNull();

    expect(host.requests).toHaveLength(1);
    const request = host.requests[0]!;
    expect(request.path).toBe('/public/links/current');
    expect(request.path).not.toContain(TOKEN);
    expect(request.headers).toEqual({ 'x-link-token': TOKEN });

    for (const spy of storage) expect(spy).not.toHaveBeenCalled();
  });

  it('never touches localStorage or sessionStorage, even when the link fails', async () => {
    const storage = spyOnStorage();
    const host = createTestPlatformHost({
      responses: {
        'GET /public/links/current': () => {
          throw createTestApiError(404, 'Link not found');
        },
      },
    });
    const { result } = renderHook(() => usePublicLink({ apiClient: host.api }));
    await waitFor(() => expect(result.current.status).toBe('unavailable'));
    for (const spy of storage) expect(spy).not.toHaveBeenCalled();
  });

  it('survives a StrictMode effect re-run: the token is kept in memory, the fragment stays gone', async () => {
    const host = createTestPlatformHost({ responses: { 'GET /public/links/current': RESOLUTION } });
    const wrapper = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>;
    const { result } = renderHook(() => usePublicLink({ apiClient: host.api }), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(window.location.hash).toBe('');
    expect(host.requests.every((request) => request.headers?.['x-link-token'] === TOKEN)).toBe(true);
  });

  it.each([
    ['unknown, expired or revoked (404)', () => createTestApiError(404, 'Link not found')],
    ['throttled (429)', () => createTestApiError(429, 'Too many', undefined, { retryAfterMs: 60_000 })],
    ['a network failure', () => new TypeError('Failed to fetch')],
  ])('reports %s as the same unavailable status', async (_name, makeError) => {
    const host = createTestPlatformHost({
      responses: {
        'GET /public/links/current': () => {
          throw makeError();
        },
      },
    });
    const { result } = renderHook(() => usePublicLink({ apiClient: host.api }));
    await waitFor(() => expect(result.current.status).toBe('unavailable'));
    expect(result.current.resolution).toBeNull();
  });

  it('makes no request without a token in the fragment', async () => {
    setUrl('/s');
    const host = createTestPlatformHost({ responses: { 'GET /public/links/current': RESOLUTION } });
    const { result } = renderHook(() => usePublicLink({ apiClient: host.api }));
    await waitFor(() => expect(result.current.status).toBe('unavailable'));
    expect(host.requests).toHaveLength(0);
  });

  it('clears a malformed fragment too, without sending it', async () => {
    setUrl('/s#not a token');
    const host = createTestPlatformHost({ responses: { 'GET /public/links/current': RESOLUTION } });
    const { result } = renderHook(() => usePublicLink({ apiClient: host.api }));
    await waitFor(() => expect(result.current.status).toBe('unavailable'));
    expect(window.location.hash).toBe('');
    expect(host.requests).toHaveLength(0);
  });

  it('resolves a second link pasted into the same tab', async () => {
    const other = 'lnk_ZyXwVuTsRqPoNmLkJiHgFeDcBa9876543210_-zyxwv';
    const host = createTestPlatformHost({
      responses: { 'GET /public/links/current': (request: TestApiRequest) => ({ ...RESOLUTION, title: request.headers?.['x-link-token'] === other ? 'Second' : 'First' }) },
    });
    const { result } = renderHook(() => usePublicLink({ apiClient: host.api }));
    await waitFor(() => expect(result.current.resolution?.title).toBe('First'));

    setUrl(`/s#${other}`);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await waitFor(() => expect(result.current.resolution?.title).toBe('Second'));
    expect(window.location.hash).toBe('');
    expect(result.current.token).toBe(other);
  });

  it('never logs the token', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((level) => vi.spyOn(console, level));
    const host = createTestPlatformHost({
      responses: {
        'GET /public/links/current': () => {
          throw createTestApiError(404, 'Link not found');
        },
      },
    });
    const { result } = renderHook(() => usePublicLink({ apiClient: host.api }));
    await waitFor(() => expect(result.current.status).toBe('unavailable'));
    for (const spy of spies) {
      for (const call of spy.mock.calls) expect(JSON.stringify(call)).not.toContain(TOKEN);
    }
  });
});
