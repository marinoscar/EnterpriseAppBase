/**
 * The org administration API, as the web app sees it (#726, PP-6.7).
 *
 * One module for the three surfaces, following `services/broadcasts.ts`:
 *
 *   - `/api/org/members`        the ACTIVE organization's members
 *   - `/api/org/invites`        the ACTIVE organization's invitations
 *   - `/api/admin/organizations` the deployment's organizations (operators)
 *
 * NO ORG ID IS EVER SENT for the first two: the API acts on the org the
 * session's token is bound to, and switching org is `POST /api/auth/switch-org`
 * (`AuthContext.switchOrg`). Everything goes through the shared `api` client,
 * so these calls inherit the token refresh and the maintenance interception.
 *
 * The types mirror the API's zod schemas in `apps/api/src/organizations/dto/`.
 */
import { api } from './api';

/** The org roles an org administrator may assign, highest first (`ASSIGNABLE_ORG_ROLES`). */
export const ORG_ROLES = ['org_admin', 'contributor', 'viewer'] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

export type OrgMemberStatus = 'active' | 'suspended';
export type OrgInviteStatus = 'pending' | 'accepted' | 'revoked' | 'expired';

/** `orgMemberResponseSchema`. */
export interface OrgMember {
  userId: string;
  email: string;
  displayName: string | null;
  role: string;
  status: OrgMemberStatus;
  lastActiveAt: string | null;
  joinedAt: string;
}

/** `orgInviteResponseSchema`. */
export interface OrgInvite {
  id: string;
  email: string;
  role: string;
  status: OrgInviteStatus;
  notes: string | null;
  expiresAt: string | null;
  createdAt: string;
  acceptedAt: string | null;
  invitedBy: { id: string; email: string } | null;
  acceptedBy: { id: string; email: string } | null;
}

/** `organizationResponseSchema`. */
export interface Organization {
  id: string;
  name: string;
  slug: string;
  isDefault: boolean;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
}

/** The flat pagination shape every list here returns (docs/API.md). */
export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface OrgMemberListParams {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: 'all' | OrgMemberStatus;
}

export interface OrgInviteListParams {
  page?: number;
  pageSize?: number;
  status?: 'all' | OrgInviteStatus;
}

export interface OrganizationListParams {
  page?: number;
  pageSize?: number;
  search?: string;
}

function query(params: object | undefined): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

// ---- Members of the active organization ------------------------------------

export function getOrgMembers(params?: OrgMemberListParams): Promise<Paginated<OrgMember>> {
  return api.get<Paginated<OrgMember>>(`/org/members${query(params)}`);
}

export function updateOrgMember(
  userId: string,
  data: { roleName?: OrgRole; status?: OrgMemberStatus },
): Promise<OrgMember> {
  return api.patch<OrgMember>(`/org/members/${encodeURIComponent(userId)}`, data);
}

export async function removeOrgMember(userId: string): Promise<void> {
  await api.delete<void>(`/org/members/${encodeURIComponent(userId)}`);
}

// ---- Invitations to the active organization --------------------------------

export function getOrgInvites(params?: OrgInviteListParams): Promise<Paginated<OrgInvite>> {
  return api.get<Paginated<OrgInvite>>(`/org/invites${query(params)}`);
}

export function createOrgInvite(data: { email: string; roleName: OrgRole; notes?: string }): Promise<OrgInvite> {
  return api.post<OrgInvite>('/org/invites', data);
}

export async function revokeOrgInvite(id: string): Promise<void> {
  await api.delete<void>(`/org/invites/${encodeURIComponent(id)}`);
}

// ---- The deployment's organizations (system administrators) ----------------

export function getOrganizations(params?: OrganizationListParams): Promise<Paginated<Organization>> {
  return api.get<Paginated<Organization>>(`/admin/organizations${query(params)}`);
}

export function createOrganization(data: {
  name: string;
  slug: string;
  firstAdminEmail: string;
}): Promise<Organization> {
  return api.post<Organization>('/admin/organizations', data);
}

export function renameOrganization(id: string, name: string): Promise<Organization> {
  return api.patch<Organization>(`/admin/organizations/${encodeURIComponent(id)}`, { name });
}
