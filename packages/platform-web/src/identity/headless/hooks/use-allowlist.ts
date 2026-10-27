// The email allowlist (issue #727, PP-6.6), moved from the reference app's
// `hooks/useAllowlist.ts`. The API enforces `allowlist:read` / `allowlist:write`.

import { useCallback, useState } from 'react';

import { useIsMounted } from '../../internal/use-is-mounted.js';
import { useIdentityApi } from '../adapters.js';
import type { AllowedEmailEntry, AllowlistParams, AllowlistResponse, IdentityApi } from '../api.js';

/**
 * What {@link useAllowlist} returns.
 *
 * @stability stable
 */
export interface UseAllowlistReturn {
  /** This page's entries. */
  entries: AllowedEmailEntry[];
  /** Entries across all pages. */
  total: number;
  /** The page the API answered with (one-based). */
  page: number;
  /** The page size the API answered with. */
  pageSize: number;
  /** The number of pages. */
  totalPages: number;
  /** A list request is in flight. */
  isLoading: boolean;
  /** The last failure's message, or `null`. */
  error: string | null;
  /** Read a page of entries. Never rejects; a failure lands in `error`. */
  fetchAllowlist: (params?: AllowlistParams) => Promise<void>;
  /** Allow an address, then re-read the current page. Rethrows on failure. */
  addEmail: (email: string, notes?: string) => Promise<void>;
  /** Remove an entry, then re-read the current page. Rethrows on failure. */
  removeEmail: (id: string) => Promise<void>;
}

/**
 * The email allowlist, over `/api/allowlist`.
 *
 * @param api - the identity client; default {@link useIdentityApi}'s.
 * @returns see {@link UseAllowlistReturn}.
 *
 * @extensionPoint hook
 * @stability stable
 */
export function useAllowlist(api?: IdentityApi): UseAllowlistReturn {
  const identity = useIdentityApi(api);
  const [entries, setEntries] = useState<AllowedEmailEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [totalPages, setTotalPages] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isMounted = useIsMounted();

  const fetchAllowlist = useCallback(
    async (params?: AllowlistParams) => {
      setIsLoading(true);
      setError(null);
      try {
        const response: AllowlistResponse = await identity.getAllowlist(params);
        if (isMounted()) {
          setEntries(response.items);
          setTotal(response.total);
          setPage(response.page);
          setPageSize(response.pageSize);
          setTotalPages(response.totalPages);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to fetch allowlist';
        if (isMounted()) {
          setError(message);
          setEntries([]);
        }
      } finally {
        if (isMounted()) setIsLoading(false);
      }
    },
    [identity, isMounted],
  );

  const addEmail = useCallback(
    async (email: string, notes?: string) => {
      setError(null);
      try {
        await identity.addToAllowlist(email, notes);
        await fetchAllowlist({ page, pageSize });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to add email';
        if (isMounted()) setError(message);
        throw err;
      }
    },
    [identity, fetchAllowlist, page, pageSize, isMounted],
  );

  const removeEmail = useCallback(
    async (id: string) => {
      setError(null);
      try {
        await identity.removeFromAllowlist(id);
        await fetchAllowlist({ page, pageSize });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to remove email';
        if (isMounted()) setError(message);
        throw err;
      }
    },
    [identity, fetchAllowlist, page, pageSize, isMounted],
  );

  return { entries, total, page, pageSize, totalPages, isLoading, error, fetchAllowlist, addEmail, removeEmail };
}
