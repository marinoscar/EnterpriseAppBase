import type { OnboardingMetricsResponse } from '@marinoscar/platform-contract/onboarding';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { isPlatformApiError, useOptionalPlatformHost } from '../../core/index.js';
import { useIsMounted } from '../internal/use-is-mounted.js';
import { createOnboardingClient } from './client.js';
import type { OnboardingClient } from './client.js';

/**
 * What {@link useOnboardingMetrics} returns.
 *
 * @stability experimental
 */
export interface UseOnboardingMetricsReturn {
  /** `null` until the first read resolves. */
  metrics: OnboardingMetricsResponse | null;
  /** A read is in flight. */
  isLoading: boolean;
  /** The request failed. */
  error: string | null;
  /** Read again. Never throws. */
  reload(): Promise<void>;
}

/**
 * Loads `GET /admin/onboarding/metrics?days=` (aggregates only).
 *
 * @param days - the cohort window, in days.
 * @param client - the client. Default: `createOnboardingClient(host.api)`.
 * @returns the metrics, the loading flag, the error and `reload`.
 * @throws Error when no `client` is given and no `PlatformHostProvider` is mounted.
 *
 * @example
 * ```tsx
 * const { metrics } = useOnboardingMetrics(30);
 * ```
 *
 * @extensionPoint hook
 * @stability experimental
 */
export function useOnboardingMetrics(days: number, client?: OnboardingClient): UseOnboardingMetricsReturn {
  const host = useOptionalPlatformHost();
  const api = host?.api;
  const resolved = useMemo(() => {
    if (client) return client;
    if (!api) throw new Error('useOnboardingMetrics: no PlatformHostProvider above this component and no client was passed.');
    return createOnboardingClient(api);
  }, [client, api]);
  const [metrics, setMetrics] = useState<OnboardingMetricsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isMounted = useIsMounted();

  const reload = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await resolved.metrics(days);
      if (isMounted()) setMetrics(data);
    } catch (err) {
      if (isMounted()) {
        setError(isPlatformApiError(err) && err.status === 403 ? 'You do not have permission to see activation metrics' : 'Failed to load the activation metrics');
      }
    } finally {
      if (isMounted()) setIsLoading(false);
    }
  }, [resolved, days, isMounted]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { metrics, isLoading, error, reload };
}
