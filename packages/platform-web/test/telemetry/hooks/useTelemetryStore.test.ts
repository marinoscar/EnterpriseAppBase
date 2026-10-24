/**
 * `hooks/useTelemetryStore.ts` (PP-14.11).
 *
 * What a page test cannot assert directly:
 *   - `save` passes the store row's loaded version as the expected version
 *     (`If-Match`) and adopts the reply, so a second save carries the new one.
 *   - A 409 is `conflict`, not a generic `saveError`.
 *   - A failed load is `loadError`; writes resolve `true`/`false` and never throw.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const client = vi.hoisted(() => ({
  getTelemetryStore: vi.fn(),
  updateTelemetryStore: vi.fn(),
}));
vi.mock('../../../src/telemetry/headless/services/client.js', () => ({
  useTelemetryClient: () => client,
  createTelemetryClient: () => client,
}));

import { createTestApiError } from '../../../src/testing/index.js';
import { useTelemetryStore } from '../../../src/telemetry/headless/hooks/useTelemetryStore.js';
import { mockTelemetryStoreMemory } from '../fixtures/telemetry.js';

async function loaded() {
  const hook = renderHook(() => useTelemetryStore());
  await waitFor(() => expect(hook.result.current.store).not.toBeNull());
  return hook;
}

describe('useTelemetryStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    client.getTelemetryStore.mockResolvedValue(mockTelemetryStoreMemory);
  });

  it('loads the store', async () => {
    const { result } = await loaded();

    expect(result.current.store?.active.id).toBe('memory');
    expect(result.current.isLoading).toBe(false);
    expect(result.current.loadError).toBeNull();
  });

  it('reports a failed load', async () => {
    client.getTelemetryStore.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useTelemetryStore());

    await waitFor(() => expect(result.current.loadError).toBe('boom'));
    expect(result.current.store).toBeNull();
  });

  it('saves with the loaded version, adopts the reply, and sends the new version next time', async () => {
    client.updateTelemetryStore.mockResolvedValue({ ...mockTelemetryStoreMemory, settings: { database: 'x', latencyMs: 0 }, version: 3 });
    const { result } = await loaded();

    let ok = false;
    await act(async () => {
      ok = await result.current.save({ settings: { database: 'x' }, secrets: { apiKey: 'k' } });
    });

    expect(ok).toBe(true);
    expect(client.updateTelemetryStore).toHaveBeenCalledWith({ settings: { database: 'x' }, secrets: { apiKey: 'k' } }, 2);
    expect(result.current.store?.version).toBe(3);

    await act(async () => {
      await result.current.save({ settings: { latencyMs: 5 } });
    });
    expect(client.updateTelemetryStore).toHaveBeenLastCalledWith({ settings: { latencyMs: 5 } }, 3);
  });

  it('treats a 409 as a conflict, not an error', async () => {
    client.updateTelemetryStore.mockRejectedValue(createTestApiError(409, 'changed'));
    const { result } = await loaded();

    let ok = true;
    await act(async () => {
      ok = await result.current.save({ settings: {} });
    });

    expect(ok).toBe(false);
    expect(result.current.conflict).toBe(true);
    expect(result.current.saveError).toBeNull();
  });

  it('reports any other failure as saveError and resolves false', async () => {
    client.updateTelemetryStore.mockRejectedValue(new Error('Invalid settings for the telemetry store'));
    const { result } = await loaded();

    let ok = true;
    await act(async () => {
      ok = await result.current.save({ settings: {} });
    });

    expect(ok).toBe(false);
    expect(result.current.saveError).toBe('Invalid settings for the telemetry store');
    expect(result.current.conflict).toBe(false);
  });
});
