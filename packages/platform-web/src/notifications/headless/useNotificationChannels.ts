import { useCallback, useEffect, useState } from 'react';
import { ApiError, getNotificationChannels } from './api.js';
import type { NotificationChannelDescriptor } from './types.js';
import { useIsMounted } from './useIsMounted.js';

/**
 * What {@link useNotificationChannels} returns.
 *
 * @stability experimental
 */
export interface UseNotificationChannelsReturn {
  /**
   * The registered channels, in registration order (`order`), never re-sorted
   * here. `null` until the first read resolves, which is not `[]`: an empty
   * array is a real answer ("this deployment registers no channels"), `null`
   * means "not known yet" (or the read failed: see `error`).
   */
  channels: NotificationChannelDescriptor[] | null;
  /** A read is in flight. */
  isLoading: boolean;
  /** The failure message of the last read, or `null`. */
  error: string | null;
  /** Reads again. */
  refresh: () => Promise<void>;
}

/**
 * Reads `GET /api/notifications/channels`: the channels, their labels and the
 * flags the broadcast composer and the preferences matrix apply. The bundle
 * holds no list of its own, so an app's channel appears with no edit here.
 *
 * @returns the descriptors and the read's state.
 *
 * @example
 * ```tsx
 * const { channels } = useNotificationChannels();
 * const label = channels?.find((channel) => channel.id === 'slack')?.label ?? 'slack';
 * ```
 *
 * @extensionPoint hook
 * @stability experimental
 */
export function useNotificationChannels(): UseNotificationChannelsReturn {
  const [channels, setChannels] = useState<NotificationChannelDescriptor[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isMounted = useIsMounted();

  const fetchChannels = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await getNotificationChannels();
      if (isMounted()) setChannels([...data].sort((a, b) => a.order - b.order));
    } catch (err) {
      if (isMounted()) {
        setError(err instanceof ApiError ? err.message : 'Failed to load notification channels');
      }
    } finally {
      if (isMounted()) setIsLoading(false);
    }
  }, [isMounted]);

  useEffect(() => {
    void fetchChannels();
  }, [fetchChannels]);

  return { channels, isLoading, error, refresh: fetchChannels };
}
