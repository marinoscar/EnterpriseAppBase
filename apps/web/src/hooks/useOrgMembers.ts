import { useCallback, useRef, useState } from 'react';
import {
  getOrgMembers,
  removeOrgMember,
  updateOrgMember,
  type OrgMember,
  type OrgMemberListParams,
  type OrgMemberStatus,
  type OrgRole,
} from '../services/organizations';
import { useIsMounted } from './useIsMounted';

/** Error text for the page: the API's message when it gave one. */
function messageOf(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

export interface UseOrgMembersResult {
  members: OrgMember[];
  total: number;
  isLoading: boolean;
  error: string | null;
  fetchMembers: (params?: OrgMemberListParams) => Promise<void>;
  /** Change a member's org role and/or status, then re-read the list. Rethrows on failure. */
  updateMember: (userId: string, data: { roleName?: OrgRole; status?: OrgMemberStatus }) => Promise<void>;
  /** Remove a member, then re-read the list. Rethrows on failure. */
  removeMember: (userId: string) => Promise<void>;
}

/**
 * The ACTIVE organization's members (#726), over `/api/org/members`. The org
 * is the one the session's token is bound to; nothing here names it. The
 * API decides every write (last-admin and self rules included); a refusal
 * lands in `error` and is rethrown to the caller.
 */
export function useOrgMembers(): UseOrgMembersResult {
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [total, setTotal] = useState(0);
  // The last query, re-used by the refresh after a write. A ref, so the
  // fetch function stays stable for effects that depend on it.
  const paramsRef = useRef<OrgMemberListParams>({});
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isMounted = useIsMounted();

  const fetchMembers = useCallback(
    async (next?: OrgMemberListParams) => {
      const effective = next ?? paramsRef.current;
      paramsRef.current = effective;
      setIsLoading(true);
      setError(null);
      try {
        const response = await getOrgMembers(effective);
        if (isMounted()) {
          setMembers(response.items);
          setTotal(response.total);
        }
      } catch (err) {
        if (isMounted()) {
          setError(messageOf(err, 'Failed to load members'));
          setMembers([]);
        }
      } finally {
        if (isMounted()) setIsLoading(false);
      }
    },
    [isMounted],
  );

  const updateMember = useCallback(
    async (userId: string, data: { roleName?: OrgRole; status?: OrgMemberStatus }) => {
      setError(null);
      try {
        await updateOrgMember(userId, data);
      } catch (err) {
        if (isMounted()) setError(messageOf(err, 'Failed to update the member'));
        throw err;
      }
      await fetchMembers();
    },
    [fetchMembers, isMounted],
  );

  const removeMember = useCallback(
    async (userId: string) => {
      setError(null);
      try {
        await removeOrgMember(userId);
      } catch (err) {
        if (isMounted()) setError(messageOf(err, 'Failed to remove the member'));
        throw err;
      }
      await fetchMembers();
    },
    [fetchMembers, isMounted],
  );

  return { members, total, isLoading, error, fetchMembers, updateMember, removeMember };
}
