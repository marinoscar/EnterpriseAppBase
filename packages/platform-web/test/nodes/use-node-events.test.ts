// `useNodeEvents` (issue #1045): the request it sends, "load more", the error
// string, and that an inline query literal does not re-fetch on every render.

import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ApiError } from '../../src/core/index.js';
import { useNodeEvents } from '../../src/nodes/headless/index.js';
import type { WorkerNodeEvent, WorkerNodeEventList } from '../../src/nodes/headless/index.js';
import { fakeNodesApi } from './harness.js';

function event(id: string, overrides: Partial<WorkerNodeEvent> = {}): WorkerNodeEvent {
  return {
    id,
    nodeId: 'node-1',
    type: 'power.battery_low',
    severity: 'warning',
    attrs: { batteryPercent: 18, threshold: 20 },
    occurredAt: '2026-01-01T11:58:00.000Z',
    receivedAt: '2026-01-01T11:58:05.000Z',
    ...overrides,
  };
}

function page(items: WorkerNodeEvent[], pageNumber: number, total: number, pageSize = 2): WorkerNodeEventList {
  return { items, total, page: pageNumber, pageSize, totalPages: Math.ceil(total / pageSize) };
}

describe('useNodeEvents', () => {
  it('asks for the first page with the query it was given', async () => {
    const api = fakeNodesApi();
    api.listNodeEvents.mockResolvedValue(page([event('e1')], 1, 1));

    const { result } = renderHook(() => useNodeEvents('node-1', { pageSize: 2, severity: 'warning', type: 'power.battery_low' }, api));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(api.listNodeEvents).toHaveBeenCalledTimes(1);
    expect(api.listNodeEvents).toHaveBeenCalledWith('node-1', {
      page: 1,
      pageSize: 2,
      type: 'power.battery_low',
      severity: 'warning',
    });
    expect(result.current.events.map((e) => e.id)).toEqual(['e1']);
    expect(result.current.total).toBe(1);
    expect(result.current.hasMore).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('leaves unset members out of the request', async () => {
    const api = fakeNodesApi();
    api.listNodeEvents.mockResolvedValue(page([], 1, 0));
    const { result } = renderHook(() => useNodeEvents('node-1', {}, api));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(api.listNodeEvents).toHaveBeenCalledWith('node-1', { page: 1 });
  });

  it('does not re-fetch when re-rendered with an equal inline query', async () => {
    const api = fakeNodesApi();
    api.listNodeEvents.mockResolvedValue(page([], 1, 0));
    const { result, rerender } = renderHook(() => useNodeEvents('node-1', { pageSize: 20 }, api));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    rerender();
    rerender();
    expect(api.listNodeEvents).toHaveBeenCalledTimes(1);
  });

  it('appends the next page on loadMore, dropping an event it already holds', async () => {
    const api = fakeNodesApi();
    api.listNodeEvents
      .mockResolvedValueOnce(page([event('e1'), event('e2')], 1, 4))
      // A new event arrived in between, so page 2 starts with one already shown.
      .mockResolvedValueOnce(page([event('e2'), event('e3')], 2, 4));

    const { result } = renderHook(() => useNodeEvents('node-1', { pageSize: 2 }, api));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.hasMore).toBe(true);

    await act(async () => {
      await result.current.loadMore();
    });

    expect(api.listNodeEvents).toHaveBeenLastCalledWith('node-1', { page: 2, pageSize: 2 });
    expect(result.current.events.map((e) => e.id)).toEqual(['e1', 'e2', 'e3']);
    expect(result.current.hasMore).toBe(false);
  });

  it('asks for nothing without a node', async () => {
    const api = fakeNodesApi();
    const { result } = renderHook(() => useNodeEvents(null, {}, api));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(api.listNodeEvents).not.toHaveBeenCalled();
    expect(result.current.events).toEqual([]);
    expect(result.current.hasMore).toBe(false);
  });

  it('reports a failure as a sentence and clears the list', async () => {
    const api = fakeNodesApi();
    api.listNodeEvents.mockRejectedValue(new ApiError('Forbidden', 403));
    const { result } = renderHook(() => useNodeEvents('node-1', {}, api));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBe('You do not have permission to view worker node events');
    expect(result.current.events).toEqual([]);
  });

  it('reads a malformed answer as an empty page instead of crashing', async () => {
    const api = fakeNodesApi();
    api.listNodeEvents.mockResolvedValue(undefined);
    const { result } = renderHook(() => useNodeEvents('node-1', {}, api));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.events).toEqual([]);
    expect(result.current.total).toBe(0);
    expect(result.current.hasMore).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('refresh re-reads the first page without raising the loading flag', async () => {
    const api = fakeNodesApi();
    api.listNodeEvents.mockResolvedValueOnce(page([event('e1')], 1, 1)).mockResolvedValueOnce(page([event('e0'), event('e1')], 1, 2));
    const { result } = renderHook(() => useNodeEvents('node-1', { pageSize: 2 }, api));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.events.map((e) => e.id)).toEqual(['e0', 'e1']);
    expect(api.listNodeEvents).toHaveBeenLastCalledWith('node-1', { page: 1, pageSize: 2 });
  });
});
