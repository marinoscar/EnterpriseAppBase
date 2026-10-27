/** `useStorageStatus`: fails open (null) while loading and on error; `skip` is inert. */
import { waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { createTestApiError, createTestPlatformHost } from '../../../src/testing/index.js';
import { useStorageStatus } from '../../../src/settings/headless/use-storage-status.js';
import { renderHook } from './test-utils.js';

describe('useStorageStatus', () => {
  it('is null while loading, then the configured flag', async () => {
    const host = createTestPlatformHost({ responses: { 'GET /storage/status': { configured: false } } });
    const { result } = renderHook(() => useStorageStatus(), { host });
    expect(result.current).toEqual({ configured: null, isLoading: true });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.configured).toBe(false);
  });

  it('reports true when configured', async () => {
    const host = createTestPlatformHost({ responses: { 'GET /storage/status': { configured: true } } });
    const { result } = renderHook(() => useStorageStatus(), { host });
    await waitFor(() => expect(result.current.configured).toBe(true));
  });

  it('fails open: a failed read leaves configured null', async () => {
    const host = createTestPlatformHost({
      responses: {
        'GET /storage/status': () => {
          throw createTestApiError(500, 'boom');
        },
      },
    });
    const { result } = renderHook(() => useStorageStatus(), { host });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.configured).toBeNull();
  });

  it('treats a malformed body as unknown', async () => {
    const host = createTestPlatformHost({ responses: { 'GET /storage/status': {} } });
    const { result } = renderHook(() => useStorageStatus(), { host });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.configured).toBeNull();
  });

  it('skip makes no request and stays null', async () => {
    const host = createTestPlatformHost({ responses: { 'GET /storage/status': { configured: false } } });
    const { result } = renderHook(() => useStorageStatus({ skip: true }), { host });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(result.current).toEqual({ configured: null, isLoading: false });
    expect(host.requests).toHaveLength(0);
  });
});
