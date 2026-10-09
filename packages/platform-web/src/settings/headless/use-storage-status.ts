// Whether object storage is configured in this deployment (`GET
// /api/storage/status`). Moved from the reference app's
// `hooks/useStorageStatus.ts` (#892), behaviour unchanged.
//
// FAILS OPEN: `configured` is `null` ("unknown") while loading and whenever
// the read fails, and only an explicit `false` from the API makes a caller
// swap an upload control for a notice. An unknown answer never blocks an
// upload; the API is the real gate.

import { useEffect, useState } from 'react';

import { usePlatformApi } from '../../core/index.js';

/**
 * What {@link useStorageStatus} returns.
 *
 * @stability experimental
 */
export interface UseStorageStatusResult {
  /** `true` or `false` from the API; `null` while unknown (loading, failed or skipped). */
  configured: boolean | null;
  /** Whether the read is in flight. */
  isLoading: boolean;
}

/**
 * Whether object storage is configured; fails open.
 *
 * @param options - `skip`: make the hook inert (no request, `configured: null`),
 *   for a caller that never shows an upload control.
 * @returns the answer and whether it is loading.
 *
 * @example
 * ```ts
 * const { configured } = useStorageStatus();
 * if (configured === false) return <FeatureUnavailableNotice feature="storage" />;
 * ```
 *
 * @extensionPoint hook
 * @stability experimental
 */
export function useStorageStatus(options: { skip?: boolean } = {}): UseStorageStatusResult {
  const { skip = false } = options;
  const api = usePlatformApi();
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(!skip);

  useEffect(() => {
    if (skip) {
      setIsLoading(false);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    api
      .get<{ configured?: unknown }>('/storage/status')
      .then((status) => {
        if (!cancelled) setConfigured(typeof status.configured === 'boolean' ? status.configured : null);
      })
      .catch(() => {
        // Unknown, not "off": never block on a failed read.
        if (!cancelled) setConfigured(null);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api, skip]);

  return { configured: skip ? null : configured, isLoading: skip ? false : isLoading };
}
