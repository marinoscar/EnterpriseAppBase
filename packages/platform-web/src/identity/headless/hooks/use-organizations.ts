// Organization administration (issue #727, PP-6.6; built in #726): the
// active organization's members and invitations, and the deployment's
// organizations. Moved from the reference app's `hooks/useOrgMembers.ts`,
// `useOrgInvites.ts` and `useOrganizations.ts`. The organization of the first
// two is the one the session's token is bound to; nothing here names it. The
// API decides every write (last-admin and self rules included); a refusal
// lands in `error` and is rethrown to the caller.

import { useCallback, useRef, useState } from 'react';

import { useIsMounted } from '../../internal/use-is-mounted.js';
import { useIdentityApi } from '../adapters.js';
import type {
  IdentityApi,
  OrgInvite,
  OrgInviteListParams,
  OrgMember,
  OrgMemberListParams,
  OrgMemberStatus,
  OrgRole,
  Organization,
  OrganizationListParams,
} from '../api.js';

/** Error text for the page: the API's message when it gave one. */
function messageOf(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/**
 * What {@link useOrgMembers} returns.
 *
 * @stability stable
 */
export interface UseOrgMembersReturn {
  /** This page's members. */
  members: OrgMember[];
  /** Members across all pages. */
  total: number;
  /** A list request is in flight. */
  isLoading: boolean;
  /** The last failure's message, or `null`. */
  error: string | null;
  /** Read members (re-using the last query when called without one). */
  fetchMembers: (params?: OrgMemberListParams) => Promise<void>;
  /** Change a member's org role and/or status, then re-read the list. Rethrows on failure. */
  updateMember: (userId: string, data: { roleName?: OrgRole; status?: OrgMemberStatus }) => Promise<void>;
  /** Remove a member, then re-read the list. Rethrows on failure. */
  removeMember: (userId: string) => Promise<void>;
}

/**
 * The ACTIVE organization's members, over `/api/org/members`.
 *
 * @param api - the identity client; default {@link useIdentityApi}'s.
 * @returns see {@link UseOrgMembersReturn}.
 *
 * @extensionPoint hook
 * @stability stable
 */
export function useOrgMembers(api?: IdentityApi): UseOrgMembersReturn {
  const identity = useIdentityApi(api);
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
        const response = await identity.getOrgMembers(effective);
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
    [identity, isMounted],
  );

  const updateMember = useCallback(
    async (userId: string, data: { roleName?: OrgRole; status?: OrgMemberStatus }) => {
      setError(null);
      try {
        await identity.updateOrgMember(userId, data);
      } catch (err) {
        if (isMounted()) setError(messageOf(err, 'Failed to update the member'));
        throw err;
      }
      await fetchMembers();
    },
    [identity, fetchMembers, isMounted],
  );

  const removeMember = useCallback(
    async (userId: string) => {
      setError(null);
      try {
        await identity.removeOrgMember(userId);
      } catch (err) {
        if (isMounted()) setError(messageOf(err, 'Failed to remove the member'));
        throw err;
      }
      await fetchMembers();
    },
    [identity, fetchMembers, isMounted],
  );

  return { members, total, isLoading, error, fetchMembers, updateMember, removeMember };
}

/**
 * What {@link useOrgInvites} returns.
 *
 * @stability stable
 */
export interface UseOrgInvitesReturn {
  /** This page's invitations. */
  invites: OrgInvite[];
  /** Invitations across all pages. */
  total: number;
  /** A list request is in flight. */
  isLoading: boolean;
  /** The last failure's message, or `null`. */
  error: string | null;
  /** Read invitations (re-using the last query when called without one). */
  fetchInvites: (params?: OrgInviteListParams) => Promise<void>;
  /** Invite (or re-invite) an address, then re-read the list. Rethrows on failure. */
  inviteMember: (data: { email: string; roleName: OrgRole; notes?: string }) => Promise<void>;
  /** Revoke a pending invitation, then re-read the list. Rethrows on failure. */
  revokeInvite: (id: string) => Promise<void>;
}

/**
 * The ACTIVE organization's invitations, over `/api/org/invites`.
 *
 * @param api - the identity client; default {@link useIdentityApi}'s.
 * @returns see {@link UseOrgInvitesReturn}.
 *
 * @extensionPoint hook
 * @stability stable
 */
export function useOrgInvites(api?: IdentityApi): UseOrgInvitesReturn {
  const identity = useIdentityApi(api);
  const [invites, setInvites] = useState<OrgInvite[]>([]);
  const [total, setTotal] = useState(0);
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
        const response = await identity.getOrgInvites(effective);
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
    [identity, isMounted],
  );

  const inviteMember = useCallback(
    async (data: { email: string; roleName: OrgRole; notes?: string }) => {
      setError(null);
      try {
        await identity.createOrgInvite(data);
      } catch (err) {
        if (isMounted()) setError(messageOf(err, 'Failed to send the invitation'));
        throw err;
      }
      await fetchInvites();
    },
    [identity, fetchInvites, isMounted],
  );

  const revokeInvite = useCallback(
    async (id: string) => {
      setError(null);
      try {
        await identity.revokeOrgInvite(id);
      } catch (err) {
        if (isMounted()) setError(messageOf(err, 'Failed to revoke the invitation'));
        throw err;
      }
      await fetchInvites();
    },
    [identity, fetchInvites, isMounted],
  );

  return { invites, total, isLoading, error, fetchInvites, inviteMember, revokeInvite };
}

/**
 * What {@link useOrganizations} returns.
 *
 * @stability stable
 */
export interface UseOrganizationsReturn {
  /** This page's organizations. */
  organizations: Organization[];
  /** Organizations across all pages. */
  total: number;
  /** A list request is in flight. */
  isLoading: boolean;
  /** The last failure's message, or `null`. */
  error: string | null;
  /** Read organizations (re-using the last query when called without one). */
  fetchOrganizations: (params?: OrganizationListParams) => Promise<void>;
  /** Create an organization and its first-admin invitation, then re-read. Rethrows on failure. */
  createOrg: (data: { name: string; slug: string; firstAdminEmail: string }) => Promise<void>;
  /** Rename an organization, then re-read. Rethrows on failure. */
  renameOrg: (id: string, name: string) => Promise<void>;
}

/**
 * The deployment's organizations, over `/api/admin/organizations` (system
 * `organizations:*`). The API refuses creation in single-org mode.
 *
 * @param api - the identity client; default {@link useIdentityApi}'s.
 * @returns see {@link UseOrganizationsReturn}.
 *
 * @extensionPoint hook
 * @stability stable
 */
export function useOrganizations(api?: IdentityApi): UseOrganizationsReturn {
  const identity = useIdentityApi(api);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [total, setTotal] = useState(0);
  const paramsRef = useRef<OrganizationListParams>({});
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isMounted = useIsMounted();

  const fetchOrganizations = useCallback(
    async (next?: OrganizationListParams) => {
      const effective = next ?? paramsRef.current;
      paramsRef.current = effective;
      setIsLoading(true);
      setError(null);
      try {
        const response = await identity.getOrganizations(effective);
        if (isMounted()) {
          setOrganizations(response.items);
          setTotal(response.total);
        }
      } catch (err) {
        if (isMounted()) {
          setError(messageOf(err, 'Failed to load organizations'));
          setOrganizations([]);
        }
      } finally {
        if (isMounted()) setIsLoading(false);
      }
    },
    [identity, isMounted],
  );

  const createOrg = useCallback(
    async (data: { name: string; slug: string; firstAdminEmail: string }) => {
      setError(null);
      try {
        await identity.createOrganization(data);
      } catch (err) {
        if (isMounted()) setError(messageOf(err, 'Failed to create the organization'));
        throw err;
      }
      await fetchOrganizations();
    },
    [identity, fetchOrganizations, isMounted],
  );

  const renameOrg = useCallback(
    async (id: string, name: string) => {
      setError(null);
      try {
        await identity.renameOrganization(id, name);
      } catch (err) {
        if (isMounted()) setError(messageOf(err, 'Failed to rename the organization'));
        throw err;
      }
      await fetchOrganizations();
    },
    [identity, fetchOrganizations, isMounted],
  );

  return { organizations, total, isLoading, error, fetchOrganizations, createOrg, renameOrg };
}
