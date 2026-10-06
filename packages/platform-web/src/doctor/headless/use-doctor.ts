// Run the admin Doctor (`GET /admin/doctor`), issue #634; packaged by #696.
//
// The house fetch-hook contract:
//   - a mounted guard on every `setState` past an `await`;
//   - an API error becomes its message, with 403 named explicitly;
//   - `rerun` RESOLVES rather than throwing: the caller is a click handler and
//     the error has already been captured for rendering.
//
// ⚠ `error` MEANS THE REQUEST FAILED. A report whose verdict is `fail` is a
// successful read and lands in `report`.

import { useCallback, useEffect, useMemo, useState } from 'react';

import { isPlatformApiError, useOptionalPlatformHost } from '../../core/index.js';
import { useIsMounted } from '../internal/use-is-mounted.js';
import { createDoctorClient } from './client.js';
import type { DoctorClient } from './client.js';
import type { DoctorReport } from './types.js';

function messageFor(err: unknown): string {
  if (isPlatformApiError(err)) {
    if (err.status === 403) {
      return 'You do not have permission to run the Doctor';
    }
    return err.message || 'Failed to run the Doctor checks';
  }
  return 'Failed to run the Doctor checks';
}

/**
 * What {@link useDoctor} returns.
 *
 * @stability stable
 */
export interface UseDoctorReturn {
  /** `null` until the first run resolves. Never a signal about the deployment itself. */
  report: DoctorReport | null;
  /** A run is in flight. The previous report stays while a rerun runs. */
  isLoading: boolean;
  /** The REQUEST failed (403, network, maintenance). Never a failing check. */
  error: string | null;
  /** Run every check again, bypassing any cache (`refresh=true`). */
  rerun: () => Promise<void>;
}

/**
 * Loads the Doctor report on mount (possibly from the API's short cache);
 * `rerun` sends `refresh=true` so every probe runs again.
 *
 * @param client - the client to use. Default: `createDoctorClient(usePlatformApi())`.
 *   Pass one (and keep its identity stable) to use the hook without a host.
 * @returns the report, the loading flag, the request error and `rerun`.
 * @throws Error when no `client` is given and no `PlatformHostProvider` is mounted.
 *
 * @example
 * ```tsx
 * const { report, isLoading, error, rerun } = useDoctor();
 * ```
 *
 * @extensionPoint hook
 * @stability stable
 */
export function useDoctor(client?: DoctorClient): UseDoctorReturn {
  const host = useOptionalPlatformHost();
  const api = host?.api;
  const resolved = useMemo(() => {
    if (client) return client;
    if (!api) {
      throw new Error(
        'useDoctor: no PlatformHostProvider above this component and no client was passed. ' +
          'Mount PlatformHostProvider (from @marinoscar/platform-web/core) or pass createDoctorClient(api).',
      );
    }
    return createDoctorClient(api);
  }, [client, api]);

  const [report, setReport] = useState<DoctorReport | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isMounted = useIsMounted();

  const run = useCallback(
    async (refresh: boolean) => {
      try {
        setIsLoading(true);
        setError(null);
        const response = await resolved.getReport(refresh ? { refresh: true } : {});
        if (isMounted()) setReport(response);
      } catch (err) {
        if (isMounted()) setError(messageFor(err));
      } finally {
        if (isMounted()) setIsLoading(false);
      }
    },
    [resolved, isMounted],
  );

  useEffect(() => {
    void run(false);
  }, [run]);

  const rerun = useCallback(() => run(true), [run]);

  return { report, isLoading, error, rerun };
}
