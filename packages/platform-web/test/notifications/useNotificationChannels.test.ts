import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useNotificationChannels } from '../../src/notifications/headless/useNotificationChannels.js';
import { getNotificationChannels, ApiError } from '../../src/notifications/headless/api.js';
import { builtinChannelDescriptors, slackDescriptor } from './channels-fixture.js';

// A fetch-on-mount hook in the shape of `useNotificationEvents` (PP-14.10): the
// channel registry, in server order, with the loading and error states
// distinct from an empty answer.

vi.mock('../../src/notifications/headless/api.js', () => ({
  getNotificationChannels: vi.fn(),
  ApiError: class ApiError extends Error {},
}));

const mockGetChannels = vi.mocked(getNotificationChannels);

describe('useNotificationChannels', () => {
  beforeEach(() => vi.clearAllMocks());

  it('is loading with no channels until the read resolves, which is not an empty answer', async () => {
    mockGetChannels.mockResolvedValue(builtinChannelDescriptors());
    const { result } = renderHook(() => useNotificationChannels());

    expect(result.current.channels).toBeNull();
    expect(result.current.isLoading).toBe(true);

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.channels?.map((channel) => channel.id)).toEqual(['email', 'browser', 'push']);
    expect(result.current.error).toBeNull();
  });

  it("keeps an app's channel and lists the channels in registry order", async () => {
    mockGetChannels.mockResolvedValue([slackDescriptor({ order: 3 }), ...builtinChannelDescriptors().reverse()]);
    const { result } = renderHook(() => useNotificationChannels());

    await waitFor(() => expect(result.current.channels).not.toBeNull());
    expect(result.current.channels?.map((channel) => channel.id)).toEqual(['email', 'browser', 'push', 'slack']);
  });

  it('reports a failure as an error with no channels', async () => {
    mockGetChannels.mockRejectedValue(new ApiError('nope', 500));
    const { result } = renderHook(() => useNotificationChannels());

    await waitFor(() => expect(result.current.error).toBe('nope'));
    expect(result.current.channels).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it('reads again on refresh', async () => {
    mockGetChannels.mockResolvedValue([]);
    const { result } = renderHook(() => useNotificationChannels());
    await waitFor(() => expect(result.current.channels).toEqual([]));

    mockGetChannels.mockResolvedValue(builtinChannelDescriptors());
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.channels).toHaveLength(3);
    expect(mockGetChannels).toHaveBeenCalledTimes(2);
  });
});
