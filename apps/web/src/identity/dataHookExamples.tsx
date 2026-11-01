/**
 * Reference examples of the identity slice's data hooks (#727, PP-6.6): the
 * hooks the packaged Users, Access Tokens and Organization pages are built
 * on, used for "another view" of the same records. The extension-point
 * catalog of `@marinoscar/platform-web/identity` links each hook here.
 *
 * Not mounted by this app: each is a small summary chip a fork could drop
 * into a page or a dashboard card. They read through the identity client the
 * app hands `IdentityWebAdaptersProvider` (`platform/identityAdapters.ts`),
 * so they carry the app's bearer token, refresh and maintenance handling,
 * and the API enforces the same permissions it enforces for the packaged
 * pages (`users:read`, `allowlist:read`, `org_members:read`,
 * `org_invites:read`, `organizations:read`; tokens are the caller's own).
 */
import { useEffect } from 'react';
import { Chip } from '@mui/material';
import {
  useAllowlist,
  useOrgInvites,
  useOrgMembers,
  useOrganizations,
  usePersonalAccessTokens,
  useUsers,
} from '@marinoscar/platform-web/identity/headless';

function SummaryChip({ label, isLoading, error }: { label: string; isLoading: boolean; error: string | null }) {
  return <Chip size="small" color={error ? 'error' : 'default'} label={isLoading ? '…' : (error ?? label)} />;
}

/** The deployment's active users, counted (`useUsers`). */
export function ActiveUsersSummary() {
  const { total, isLoading, error, fetchUsers } = useUsers();
  useEffect(() => {
    void fetchUsers({ isActive: true, pageSize: 1 });
  }, [fetchUsers]);
  return <SummaryChip label={`${total} active users`} isLoading={isLoading} error={error} />;
}

/** Allowlist entries nobody has signed in with yet (`useAllowlist`). */
export function PendingAllowlistSummary() {
  const { total, isLoading, error, fetchAllowlist } = useAllowlist();
  useEffect(() => {
    void fetchAllowlist({ status: 'pending', pageSize: 1 });
  }, [fetchAllowlist]);
  return <SummaryChip label={`${total} pending invitations to sign in`} isLoading={isLoading} error={error} />;
}

/** The caller's personal access tokens that are still usable (`usePersonalAccessTokens`). */
export function LiveTokensSummary() {
  const { tokens, isLoading, error, fetchTokens } = usePersonalAccessTokens();
  useEffect(() => {
    void fetchTokens();
  }, [fetchTokens]);
  const now = Date.now();
  const live = tokens.filter((token) => !token.revokedAt && Date.parse(token.expiresAt) > now).length;
  return <SummaryChip label={`${live} live access tokens`} isLoading={isLoading} error={error} />;
}

/** The current organization's members (`useOrgMembers`). */
export function OrgMembersSummary() {
  const { total, isLoading, error, fetchMembers } = useOrgMembers();
  useEffect(() => {
    void fetchMembers();
  }, [fetchMembers]);
  return <SummaryChip label={`${total} members`} isLoading={isLoading} error={error} />;
}

/** The current organization's invitations (`useOrgInvites`). */
export function OrgInvitesSummary() {
  const { total, isLoading, error, fetchInvites } = useOrgInvites();
  useEffect(() => {
    void fetchInvites();
  }, [fetchInvites]);
  return <SummaryChip label={`${total} invitations`} isLoading={isLoading} error={error} />;
}

/** The deployment's organizations (`useOrganizations`; system administrators). */
export function OrganizationsSummary() {
  const { total, isLoading, error, fetchOrganizations } = useOrganizations();
  useEffect(() => {
    void fetchOrganizations();
  }, [fetchOrganizations]);
  return <SummaryChip label={`${total} organizations`} isLoading={isLoading} error={error} />;
}
