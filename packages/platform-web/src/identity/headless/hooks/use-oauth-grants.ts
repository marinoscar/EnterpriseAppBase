// The caller's connected apps (PP-15.7, #1185; `GET` / `DELETE /api/oauth/grants`).

import type { OAuthGrantView } from '@marinoscar/platform-contract/identity';
import { useCallback, useEffect, useState } from 'react';

import { isPlatformApiError } from '../../../core/index.js';
import { useIsMounted } from '../../internal/use-is-mounted.js';
import { useOAuthServerApi } from '../adapters.js';
import type { OAuthServerApi } from '../oauth-api.js';

/**
 * What {@link useOAuthGrants} returns.
 *
 * @stability experimental
 */
export interface UseOAuthGrantsReturn {
  /** The caller's active grants (never a token). */
  grants: OAuthGrantView[];
  /** A list request is in flight. */
  isLoading: boolean;
  /** The last failure's message, or `null`. */
  error: string | null;
  /** The API answered `404`: the OAuth server is off on this deployment. */
  unavailable: boolean;
  /** Re-read the list. Never rejects; a failure lands in `error`. */
  refresh: () => Promise<void>;
  /** Disconnect one app, then re-read. Rethrows on failure. */
  revoke: (id: string) => Promise<void>;
}

/**
 * The caller's connected apps. Reads the list on mount. Any signed-in user
 * manages their own grants: the routes need no permission.
 *
 * @param api - the OAuth client; default {@link useOAuthServerApi}'s.
 * @returns see {@link UseOAuthGrantsReturn}.
 *
 * @extensionPoint hook
 * @stability experimental
 */
export function useOAuthGrants(api?: OAuthServerApi): UseOAuthGrantsReturn {
  const oauth = useOAuthServerApi(api);
  const isMounted = useIsMounted();
  const [grants, setGrants] = useState<OAuthGrantView[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await oauth.listGrants();
      if (isMounted()) {
        setGrants(result);
        setUnavailable(false);
      }
    } catch (err) {
      if (!isMounted()) return;
      setGrants([]);
      if (isPlatformApiError(err) && err.status === 404) {
        setUnavailable(true);
      } else {
        setError(err instanceof Error || isPlatformApiError(err) ? err.message : 'Could not load your connected apps.');
      }
    } finally {
      if (isMounted()) setIsLoading(false);
    }
  }, [oauth, isMounted]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const revoke = useCallback(
    async (id: string) => {
      setError(null);
      try {
        await oauth.revokeGrant(id);
      } catch (err) {
        if (isMounted()) setError(err instanceof Error || isPlatformApiError(err) ? err.message : 'Could not disconnect the app.');
        throw err;
      }
      await refresh();
    },
    [oauth, refresh, isMounted],
  );

  return { grants, isLoading, error, unavailable, refresh, revoke };
}
