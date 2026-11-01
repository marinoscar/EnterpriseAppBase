// The caller's personal access tokens (issue #727, PP-6.6), moved from the
// reference app's `hooks/usePersonalAccessTokens.ts`.

import { useCallback, useEffect, useState } from 'react';

import { useIsMounted } from '../../internal/use-is-mounted.js';
import { useIdentityApi } from '../adapters.js';
import type { CreatePatInput, IdentityApi, PatCreatedResponse, PersonalAccessToken } from '../api.js';

/**
 * What {@link usePersonalAccessTokens} returns.
 *
 * @stability stable
 */
export interface UsePersonalAccessTokensReturn {
  /** The caller's tokens (never their values). */
  tokens: PersonalAccessToken[];
  /** A list request is in flight. */
  isLoading: boolean;
  /** The last failure's message, or `null`. */
  error: string | null;
  /** Re-read the list. Never rejects; a failure lands in `error`. */
  fetchTokens: () => Promise<void>;
  /** Create a token (its raw value is in the answer, once), then re-read. Rethrows on failure. */
  createToken: (data: CreatePatInput) => Promise<PatCreatedResponse>;
  /** Revoke a token, then re-read. Rethrows on failure. */
  revokeToken: (id: string) => Promise<void>;
}

/**
 * The caller's personal access tokens, over `/api/pat`. Reads the list on mount.
 *
 * @param api - the identity client; default {@link useIdentityApi}'s.
 * @returns see {@link UsePersonalAccessTokensReturn}.
 *
 * @extensionPoint hook
 * @stability stable
 */
export function usePersonalAccessTokens(api?: IdentityApi): UsePersonalAccessTokensReturn {
  const identity = useIdentityApi(api);
  const [tokens, setTokens] = useState<PersonalAccessToken[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isMounted = useIsMounted();

  const fetchTokens = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await identity.getPersonalAccessTokens();
      if (isMounted()) setTokens(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch tokens';
      if (isMounted()) {
        setError(message);
        setTokens([]);
      }
    } finally {
      if (isMounted()) setIsLoading(false);
    }
  }, [identity, isMounted]);

  const createToken = useCallback(
    async (data: CreatePatInput): Promise<PatCreatedResponse> => {
      setError(null);
      try {
        const response = await identity.createPersonalAccessToken(data);
        await fetchTokens();
        return response;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to create token';
        if (isMounted()) setError(message);
        throw err;
      }
    },
    [identity, fetchTokens, isMounted],
  );

  const revokeToken = useCallback(
    async (id: string) => {
      setError(null);
      try {
        await identity.revokePersonalAccessToken(id);
        await fetchTokens();
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to revoke token';
        if (isMounted()) setError(message);
        throw err;
      }
    },
    [identity, fetchTokens, isMounted],
  );

  useEffect(() => {
    void fetchTokens();
  }, [fetchTokens]);

  return { tokens, isLoading, error, fetchTokens, createToken, revokeToken };
}
