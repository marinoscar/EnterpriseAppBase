import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import {
  PlatformHostProvider,
  isPlatformApiError,
  useOptionalPlatformHost,
  usePlatformApi,
  usePlatformHost,
  usePlatformViewer,
} from '../../src/core/index.js';
import { createTestApiError, createTestPlatformHost } from '../../src/testing/index.js';

describe('PlatformHostProvider and its hooks', () => {
  it('hand the host, its transport and its viewer to packaged code', () => {
    const host = createTestPlatformHost({ permissions: ['a:read'], userId: 'u-1', features: { ai: true } });
    const wrapper = ({ children }: { children: ReactNode }) => <PlatformHostProvider host={host}>{children}</PlatformHostProvider>;

    const { result } = renderHook(
      () => ({ host: usePlatformHost(), api: usePlatformApi(), viewer: usePlatformViewer(), optional: useOptionalPlatformHost() }),
      { wrapper },
    );

    expect(result.current.host).toBe(host);
    expect(result.current.api).toBe(host.api);
    expect(result.current.optional).toBe(host);
    expect(result.current.viewer.userId).toBe('u-1');
    expect(result.current.viewer.hasPermission('a:read')).toBe(true);
    expect(result.current.viewer.hasPermission('b:read')).toBe(false);
    expect(result.current.viewer.isFeatureEnabled('ai')).toBe(true);
    expect(result.current.viewer.isFeatureEnabled('telemetry')).toBe(false);
  });

  it('usePlatformHost throws a clear error outside the provider; the optional variant answers null', () => {
    expect(() => renderHook(() => usePlatformHost())).toThrow(/no PlatformHostProvider/);
    expect(() => renderHook(() => usePlatformApi())).toThrow(/no PlatformHostProvider/);
    expect(renderHook(() => useOptionalPlatformHost()).result.current).toBeNull();
  });
});

describe('isPlatformApiError', () => {
  it('accepts an object with a numeric status and a string message', () => {
    expect(isPlatformApiError({ status: 403, message: 'Forbidden' })).toBe(true);
    expect(isPlatformApiError({ status: 409, message: 'Conflict', code: 'VERSION' })).toBe(true);
    expect(isPlatformApiError(createTestApiError(500, 'Boom'))).toBe(true);
  });

  it('rejects a network failure and anything else', () => {
    expect(isPlatformApiError(new TypeError('Failed to fetch'))).toBe(false);
    expect(isPlatformApiError({ status: '403', message: 'x' })).toBe(false);
    expect(isPlatformApiError({ status: 403, message: 'x', code: 7 })).toBe(false);
    expect(isPlatformApiError(null)).toBe(false);
    expect(isPlatformApiError('403')).toBe(false);
  });
});

describe('createTestPlatformHost', () => {
  it('answers from the table, most specific key first, and records every request', async () => {
    const host = createTestPlatformHost({
      responses: {
        'GET /things?x=1': 'exact',
        'GET /things': 'method+path',
        '/other': (request: { method: string }) => `any ${request.method}`,
      },
    });

    await expect(host.api.get('/things?x=1')).resolves.toBe('exact');
    await expect(host.api.get('/things?x=2')).resolves.toBe('method+path');
    await expect(host.api.post('/other', { a: 1 })).resolves.toBe('any POST');
    await host.api.patch('/other', { b: 2 }, { ifMatch: '3' }).catch(() => undefined);

    expect(host.requests).toEqual([
      { method: 'GET', path: '/things?x=1' },
      { method: 'GET', path: '/things?x=2' },
      { method: 'POST', path: '/other', body: { a: 1 } },
      { method: 'PATCH', path: '/other', body: { b: 2 }, ifMatch: '3' },
    ]);
  });

  it('rejects an unmatched request with a 404 PlatformApiError, and propagates a thrown one', async () => {
    const host = createTestPlatformHost({
      responses: {
        'DELETE /x': () => {
          throw createTestApiError(409, 'Conflict', 'VERSION');
        },
      },
    });

    await expect(host.api.get('/missing')).rejects.toMatchObject({ status: 404 });
    await expect(host.api.delete('/x')).rejects.toMatchObject({ status: 409, message: 'Conflict', code: 'VERSION' });
  });
});
