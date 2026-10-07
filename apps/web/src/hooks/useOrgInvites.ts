import { useCallback, useRef, useState } from 'react';
import {
  createOrgInvite,
  getOrgInvites,
  revokeOrgInvite,
  type OrgInvite,
  type OrgInviteListParams,
  type OrgRole,
} from '../services/organizations';
import { useIsMounted } from './useIsMounted';

function messageOf(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

export interface UseOrgInvitesResult {
  invites: OrgInvite[];
  total: number;
  isLoading: boolean;
  error: string | null;
  fetchInvites: (params?: OrgInviteListParams) => Promise<void>;
  /** Invite (or re-invite) an address, then re-read the list. Rethrows on failure. */
  inviteMember: (data: { email: string; roleName: OrgRole; notes?: string }) => Promise<void>;
  /** Revoke a pending invitation, then re-read the list. Rethrows on failure. */
  revokeInvite: (id: string) => Promise<void>;
}

/**
 * The ACTIVE organization's invitations (#726), over `/api/org/invites`. The
 * org comes from the session's token, never from this hook.
 */
export function useOrgInvites(): UseOrgInvitesResult {
  const [invites, setInvites] = useState<OrgInvite[]>([]);
  const [total, setTotal] = useState(0);
  // The last query, re-used by the refresh after a write. A ref, so the
  // fetch function stays stable for effects that depend on it.
  const paramsRef = useRef<OrgInviteListParams>({});
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isMounted = useIsMounted();

  const fetchInvites = useCallback(
    async (next?: OrgInviteListParams) => {
      const effective = next ?? paramsRef.current;
      paramsRef.current = effective;
      setIsLoading(true);
      setError(null);
      try {
        const response = await getOrgInvites(effective);
        if (isMounted()) {
          setInvites(response.items);
          setTotal(response.total);
        }
      } catch (err) {
        if (isMounted()) {
          setError(messageOf(err, 'Failed to load invitations'));
          setInvites([]);
        }
      } finally {
        if (isMounted()) setIsLoading(false);
      }
    },
    [isMounted],
  );

  const inviteMember = useCallback(
    async (data: { email: string; roleName: OrgRole; notes?: string }) => {
      setError(null);
      try {
        await createOrgInvite(data);
      } catch (err) {
        if (isMounted()) setError(messageOf(err, 'Failed to send the invitation'));
        throw err;
      }
      await fetchInvites();
    },
    [fetchInvites, isMounted],
  );

  const revokeInvite = useCallback(
    async (id: string) => {
      setError(null);
      try {
        await revokeOrgInvite(id);
      } catch (err) {
        if (isMounted()) setError(messageOf(err, 'Failed to revoke the invitation'));
        throw err;
      }
      await fetchInvites();
    },
    [fetchInvites, isMounted],
  );

  return { invites, total, isLoading, error, fetchInvites, inviteMember, revokeInvite };
}
