// The admin user list (issue #727, PP-6.6), moved from the reference app's
// `hooks/useUsers.ts`. The API enforces `users:read` / `users:write` /
// `rbac:manage`; this hook only carries the answers.

import { useCallback, useState } from 'react';

import { useIsMounted } from '../../internal/use-is-mounted.js';
import { useIdentityApi } from '../adapters.js';
import type { IdentityApi, UserListItem, UserListParams, UsersResponse } from '../api.js';

/**
 * What {@link useUsers} returns.
 *
 * @stability stable
 */
export interface UseUsersReturn {
  /** This page's users. */
  users: UserListItem[];
  /** Users across all pages. */
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
  /** Read a page of users. Never rejects; a failure lands in `error`. */
  fetchUsers: (params?: UserListParams) => Promise<void>;
  /** Update a user's display name or active flag. Rethrows on failure. */
  updateUser: (id: string, data: { displayName?: string; isActive?: boolean }) => Promise<void>;
  /** Replace a user's system roles. Rethrows on failure. */
  updateUserRoles: (id: string, roles: string[]) => Promise<void>;
}

/**
 * The deployment's users, over `/api/users`.
 *
 * @param api - the identity client; default {@link useIdentityApi}'s.
 * @returns see {@link UseUsersReturn}.
 *
 * @extensionPoint hook
 * @stability stable
 */
export function useUsers(api?: IdentityApi): UseUsersReturn {
  const identity = useIdentityApi(api);
  const [users, setUsers] = useState<UserListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [totalPages, setTotalPages] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Every `setState` past an `await` is guarded: a request that settles after
  // the component is gone must not schedule an update on it. Only the state
  // write is skipped; what these functions return or throw is unchanged.
  const isMounted = useIsMounted();

  const fetchUsers = useCallback(
    async (params?: UserListParams) => {
      setIsLoading(true);
      setError(null);
      try {
        const response: UsersResponse = await identity.getUsers(params);
        if (isMounted()) {
          setUsers(response.items);
          setTotal(response.total);
          setPage(response.page);
          setPageSize(response.pageSize);
          setTotalPages(response.totalPages);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to fetch users';
        if (isMounted()) {
          setError(message);
          setUsers([]);
        }
      } finally {
        if (isMounted()) setIsLoading(false);
      }
    },
    [identity, isMounted],
  );

  const updateUser = useCallback(
    async (id: string, data: { displayName?: string; isActive?: boolean }) => {
      setError(null);
      try {
        const updatedUser = await identity.updateUser(id, data);
        if (isMounted()) {
          setUsers((prevUsers) => prevUsers.map((user) => (user.id === id ? updatedUser : user)));
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to update user';
        if (isMounted()) setError(message);
        throw err;
      }
    },
    [identity, isMounted],
  );

  const updateUserRoles = useCallback(
    async (id: string, roles: string[]) => {
      setError(null);
      try {
        const updatedUser = await identity.updateUserRoles(id, roles);
        if (isMounted()) {
          setUsers((prevUsers) => prevUsers.map((user) => (user.id === id ? updatedUser : user)));
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to update user roles';
        if (isMounted()) setError(message);
        throw err;
      }
    },
    [identity, isMounted],
  );

  return { users, total, page, pageSize, totalPages, isLoading, error, fetchUsers, updateUser, updateUserRoles };
}
