// The admin view of users' OAuth grants (#1203; `GET` / `DELETE
// /api/admin/oauth/grants`): the "Connections" of a client on the admin
// "OAuth clients" page. Reads need `oauth_clients:read`, a revoke
// `oauth_clients:write`; the API enforces both.

import type { OAuthAdminGrantView } from '@marinoscar/platform-contract/identity';
import { useCallback, useEffect, useRef, useState } from 'react';

import { isPlatformApiError } from '../../../core/index.js';
import { useIsMounted } from '../../internal/use-is-mounted.js';
import { useOAuthServerApi } from '../adapters.js';
import type { OAuthServerApi } from '../oauth-api.js';

const messageOf = (error: unknown, fallback: string): string =>
  isPlatformApiError(error) || error instanceof Error ? error.message || fallback : fallback;

/**
 * Which grants {@link useOAuthAdminGrants} lists. Both filters are optional;
 * with neither, every user's grants to every client.
 *
 * @stability experimental
 */
export interface OAuthAdminGrantFilter {
  /** Only the grants of this client: the client's row id (`OAuthClientView.id`). */
  clientId?: string;
  /** Only the grants of this user. */
  userId?: string;
}

/**
 * What {@link useOAuthAdminGrants} returns.
 *
 * @stability experimental
 */
export interface UseOAuthAdminGrantsReturn {
  /** The current page of grants, newest first (never a token). */
  grants: OAuthAdminGrantView[];
  /** Grants across all pages. */
  total: number;
  /** The page, 1-based. */
  page: number;
  /** The page size. */
  pageSize: number;
  /** Revoked grants are listed too. */
  includeRevoked: boolean;
  /** A list request is in flight. */
  isLoading: boolean;
  /** The last failure's message, or `null`. */
  error: string | null;
  /** Change the page or its size. */
  setPagination: (next: { page: number; pageSize: number }) => void;
  /** List revoked grants too, or active ones only (back to page 1). */
  setIncludeRevoked: (includeRevoked: boolean) => void;
  /** Re-read the page. Never rejects; a failure lands in `error`. */
  refresh: () => Promise<void>;
  /** Revoke one grant (reason `admin`), then re-read. Rethrows on failure. */
  revoke: (id: string) => Promise<void>;
}

/**
 * Users' OAuth grants as an administrator sees them, paged, active only by
 * default. Reads on mount and whenever the filter, the page or
 * `includeRevoked` changes.
 *
 * @param filter - the client and/or user to list; see {@link OAuthAdminGrantFilter}.
 * @param api - the OAuth client; default {@link useOAuthServerApi}'s.
 * @returns see {@link UseOAuthAdminGrantsReturn}.
 *
 * @example
 * ```tsx
 * const { grants, revoke } = useOAuthAdminGrants({ clientId: client.id });
 * ```
 *
 * @extensionPoint hook
 * @stability experimental
 */
export function useOAuthAdminGrants(filter: OAuthAdminGrantFilter = {}, api?: OAuthServerApi): UseOAuthAdminGrantsReturn {
  const oauth = useOAuthServerApi(api);
  const isMounted = useIsMounted();
  const { clientId, userId } = filter;
  const [grants, setGrants] = useState<OAuthAdminGrantView[]>([]);
  const [total, setTotal] = useState(0);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 20 });
  const [includeRevoked, setIncludeRevokedState] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestSeq = useRef(0);

  const refresh = useCallback(async () => {
    const seq = ++requestSeq.current;
    setIsLoading(true);
    setError(null);
    try {
      const result = await oauth.listAdminGrants({
        ...(clientId ? { clientId } : {}),
        ...(userId ? { userId } : {}),
        ...(includeRevoked ? { includeRevoked } : {}),
        page: pagination.page,
        pageSize: pagination.pageSize,
      });
      if (isMounted() && seq === requestSeq.current) {
        setGrants(result.items);
        setTotal(result.total);
      }
    } catch (err) {
      if (isMounted() && seq === requestSeq.current) {
        setGrants([]);
        setTotal(0);
        setError(messageOf(err, 'Could not load the connections.'));
      }
    } finally {
      if (isMounted() && seq === requestSeq.current) setIsLoading(false);
    }
  }, [oauth, clientId, userId, includeRevoked, pagination.page, pagination.pageSize, isMounted]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setIncludeRevoked = useCallback((next: boolean) => {
    setIncludeRevokedState(next);
    setPagination((current) => ({ ...current, page: 1 }));
  }, []);

  const revoke = useCallback(
    async (id: string) => {
      setError(null);
      try {
        await oauth.revokeAdminGrant(id);
      } catch (err) {
        if (isMounted()) setError(messageOf(err, 'Could not revoke the connection.'));
        throw err;
      }
      await refresh();
    },
    [oauth, refresh, isMounted],
  );

  return {
    grants,
    total,
    page: pagination.page,
    pageSize: pagination.pageSize,
    includeRevoked,
    isLoading,
    error,
    setPagination,
    setIncludeRevoked,
    refresh,
    revoke,
  };
}
