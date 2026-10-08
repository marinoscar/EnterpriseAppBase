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

// The shapes are defined ONCE, in `@marinoscar/platform-web/identity/headless`
// (#727, PP-6.6), which also holds the packaged client these functions mirror.
export { ORG_ROLES } from '@marinoscar/platform-web/identity/headless';
export type {
  OrgInvite,
  OrgInviteListParams,
  OrgInviteStatus,
  OrgMember,
  OrgMemberListParams,
  OrgMemberStatus,
  OrgRole,
  Organization,
  OrganizationListParams,
  Paginated,
} from '@marinoscar/platform-web/identity/headless';
import type {
  OrgInvite,
  OrgInviteListParams,
  OrgMember,
  OrgMemberListParams,
  OrgMemberStatus,
  OrgRole,
  Organization,
  OrganizationListParams,
  Paginated,
} from '@marinoscar/platform-web/identity/headless';

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
