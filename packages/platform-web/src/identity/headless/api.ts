// =============================================================================
// The identity slice's API client (issue #727, PP-6.6)
// =============================================================================
//
// Every identity endpoint the packaged pages call, over the app's transport
// (`PlatformApiClient` of `@marinoscar/platform-web/core`), so the auth
// header, the token refresh and the app's error handling stay the app's.
// Moved from the reference app's `services/api.ts` (users, allowlist, device
// activation, personal access tokens) and `services/organizations.ts`; the
// paths and query strings are byte-identical.
//
// NO ORG ID IS EVER SENT for `/org/members` and `/org/invites`: the API acts
// on the organization the session's token is bound to.
// =============================================================================

import type { PatDurationUnitValue } from '@marinoscar/platform-contract/identity';

import type { PlatformApiClient } from '../../core/index.js';

// ---- Users and the allowlist -------------------------------------------------

/**
 * One row of `GET /api/users`.
 *
 * @stability stable
 */
export interface UserListItem {
  /** The user's id. */
  id: string;
  /** The user's email address. */
  email: string;
  /** The display-name override, or `null`. */
  displayName: string | null;
  /** The provider's display name, or `null`. */
  providerDisplayName: string | null;
  /** The resolved picture, or `null`. */
  profileImageUrl: string | null;
  /** The provider's picture, or `null`. */
  providerProfileImageUrl?: string | null;
  /** Whether the account is active. */
  isActive: boolean;
  /** The user's system role names. */
  roles: string[];
  /** ISO 8601 creation time. */
  createdAt: string;
  /** ISO 8601 last update. */
  updatedAt: string;
}

/**
 * A page of a list endpoint (`docs/API.md` pagination).
 *
 * @typeParam T - the row type.
 * @stability stable
 */
export interface Paginated<T> {
  /** The rows of this page. */
  items: T[];
  /** Rows across all pages. */
  total: number;
  /** This page, one-based. */
  page: number;
  /** The page size. */
  pageSize: number;
  /** The number of pages. */
  totalPages: number;
}

/**
 * `GET /api/users`.
 *
 * @stability stable
 */
export type UsersResponse = Paginated<UserListItem>;

/**
 * Sort keys `GET /api/users` accepts (`userListQuerySchema.sortBy`). Typed so
 * a table column declaring `sortable` against a field the endpoint rejects is
 * a compile error, not a 400.
 *
 * @stability stable
 */
export type UserSortField = 'email' | 'createdAt' | 'updatedAt';

/**
 * The query `GET /api/users` accepts.
 *
 * @stability stable
 */
export interface UserListParams {
  /** The page, one-based. */
  page?: number;
  /** The page size. */
  pageSize?: number;
  /** Matches email, display name and provider display name. */
  search?: string;
  /** Only users holding this role. */
  role?: string;
  /** Only active (`true`) or inactive (`false`) users. */
  isActive?: boolean;
  /** The sort key. */
  sortBy?: UserSortField;
  /** The sort direction. */
  sortOrder?: 'asc' | 'desc';
}

/**
 * One row of `GET /api/allowlist`.
 *
 * @stability stable
 */
export interface AllowedEmailEntry {
  /** The entry's id. */
  id: string;
  /** The allowed address. */
  email: string;
  /** Who added it, or `null`. */
  addedBy: { id: string; email: string } | null;
  /** ISO 8601 time it was added. */
  addedAt: string;
  /** Who signed in with it, or `null` while pending. */
  claimedBy: { id: string; email: string } | null;
  /** ISO 8601 time it was claimed, or `null`. */
  claimedAt: string | null;
  /** Free-text notes, or `null`. */
  notes: string | null;
}

/**
 * `GET /api/allowlist`.
 *
 * @stability stable
 */
export type AllowlistResponse = Paginated<AllowedEmailEntry>;

/**
 * Sort keys `GET /api/allowlist` accepts (`allowlistQuerySchema.sortBy`).
 *
 * @stability stable
 */
export type AllowlistSortField = 'email' | 'addedAt' | 'claimedAt';

/**
 * The query `GET /api/allowlist` accepts.
 *
 * @stability stable
 */
export interface AllowlistParams {
  /** The page, one-based. */
  page?: number;
  /** The page size. */
  pageSize?: number;
  /** Matches the address. */
  search?: string;
  /** Pending, claimed or all entries. */
  status?: 'all' | 'pending' | 'claimed';
  /** The sort key. */
  sortBy?: AllowlistSortField;
  /** The sort direction. */
  sortOrder?: 'asc' | 'desc';
}

// ---- Device activation -------------------------------------------------------

/**
 * What `GET /api/auth/device/activate?code=...` returns for a pending code.
 *
 * EVERY FIELD UNDER `clientInfo` IS ATTACKER-CHOSEN: `POST /auth/device/code`
 * is public and stores its body verbatim. The types describe what a
 * well-behaved client sends, not what will arrive; `readCredentialKind` is
 * the only place this object is interpreted.
 *
 * @stability stable
 */
export interface DeviceActivationInfo {
  /** The user code, `XXXX-XXXX`. */
  userCode: string;
  /** What the device said about itself; may be absent or `null`-filled. */
  clientInfo?: {
    /** The device's chosen name. */
    deviceName?: string;
    /** Its user agent. */
    userAgent?: string;
    /** The address it called from. */
    ipAddress?: string;
    /**
     * The credential it asked for. A `string`, not the `'session' | 'pat'`
     * union: older rows have none, and the column is not re-validated on read.
     */
    tokenType?: string;
  };
  /** ISO 8601 expiry of the code. */
  expiresAt: string;
}

/**
 * What `POST /api/auth/device/authorize` returns.
 *
 * @stability stable
 */
export interface DeviceAuthorizationResponse {
  /** Whether the decision was recorded. */
  success: boolean;
  /** The API's message. */
  message: string;
}

// ---- Personal access tokens --------------------------------------------------

/**
 * A personal access token's lifetime unit.
 *
 * @stability stable
 */
export type PatDurationUnit = PatDurationUnitValue;

/**
 * One row of `GET /api/pat`. Never carries the token value.
 *
 * @stability stable
 */
export interface PersonalAccessToken {
  /** The token's id. */
  id: string;
  /** Its name. */
  name: string;
  /** Its prefix, for identification. */
  tokenPrefix: string;
  /** The duration value used when creating it. */
  durationValue: number;
  /** The duration unit used when creating it. */
  durationUnit: PatDurationUnit;
  /** ISO 8601 expiry. */
  expiresAt: string;
  /** ISO 8601 time of last use, or `null`. */
  lastUsedAt: string | null;
  /** ISO 8601 creation time. */
  createdAt: string;
  /** ISO 8601 revocation time, or `null`. */
  revokedAt: string | null;
}

/**
 * `POST /api/pat` response: the raw token value, shown once.
 *
 * @stability stable
 */
export interface PatCreatedResponse {
  /** The raw token value (`pat_...`); shown only once. */
  token: string;
  /** The token's id. */
  id: string;
  /** Its name. */
  name: string;
  /** Its prefix. */
  tokenPrefix: string;
  /** ISO 8601 expiry. */
  expiresAt: string;
  /** ISO 8601 creation time. */
  createdAt: string;
}

/**
 * `POST /api/pat` body.
 *
 * @stability stable
 */
export interface CreatePatInput {
  /** A human-readable name. */
  name: string;
  /** The lifetime, in `durationUnit`. */
  durationValue: number;
  /** The unit of `durationValue`. */
  durationUnit: PatDurationUnit;
}

// ---- Organizations -----------------------------------------------------------

/**
 * The org roles an organization administrator may assign, highest first
 * (`ASSIGNABLE_ORG_ROLES` of the contract).
 *
 * @stability stable
 */
export const ORG_ROLES = ['org_admin', 'contributor', 'viewer'] as const;

/**
 * One assignable org role.
 *
 * @stability stable
 */
export type OrgRole = (typeof ORG_ROLES)[number];

/**
 * A membership status.
 *
 * @stability stable
 */
export type OrgMemberStatus = 'active' | 'suspended';

/**
 * An invitation status.
 *
 * @stability stable
 */
export type OrgInviteStatus = 'pending' | 'accepted' | 'revoked' | 'expired';

/**
 * One member of the active organization (`orgMemberResponseSchema`).
 *
 * @stability stable
 */
export interface OrgMember {
  /** The member's user id. */
  userId: string;
  /** Their email address. */
  email: string;
  /** Their display name, or `null`. */
  displayName: string | null;
  /** Their org role. */
  role: string;
  /** Their membership status. */
  status: OrgMemberStatus;
  /** ISO 8601 time of their last activity, or `null`. */
  lastActiveAt: string | null;
  /** ISO 8601 time they joined. */
  joinedAt: string;
}

/**
 * One invitation to the active organization (`orgInviteResponseSchema`).
 *
 * @stability stable
 */
export interface OrgInvite {
  /** The invitation's id. */
  id: string;
  /** The invited address. */
  email: string;
  /** The org role it grants. */
  role: string;
  /** Its status. */
  status: OrgInviteStatus;
  /** Free-text notes, or `null`. */
  notes: string | null;
  /** ISO 8601 expiry, or `null`. */
  expiresAt: string | null;
  /** ISO 8601 creation time. */
  createdAt: string;
  /** ISO 8601 acceptance time, or `null`. */
  acceptedAt: string | null;
  /** Who sent it, or `null`. */
  invitedBy: { id: string; email: string } | null;
  /** Who accepted it, or `null`. */
  acceptedBy: { id: string; email: string } | null;
}

/**
 * One organization of the deployment (`organizationResponseSchema`).
 *
 * @stability stable
 */
export interface Organization {
  /** The organization's id. */
  id: string;
  /** Its name. */
  name: string;
  /** Its slug. */
  slug: string;
  /** Whether it is the default organization. */
  isDefault: boolean;
  /** Its number of members. */
  memberCount: number;
  /** ISO 8601 creation time. */
  createdAt: string;
  /** ISO 8601 last update. */
  updatedAt: string;
}

/**
 * The query `GET /api/org/members` accepts.
 *
 * @stability stable
 */
export interface OrgMemberListParams {
  /** The page, one-based. */
  page?: number;
  /** The page size. */
  pageSize?: number;
  /** Matches email and display name. */
  search?: string;
  /** Only members with this status. */
  status?: 'all' | OrgMemberStatus;
}

/**
 * The query `GET /api/org/invites` accepts.
 *
 * @stability stable
 */
export interface OrgInviteListParams {
  /** The page, one-based. */
  page?: number;
  /** The page size. */
  pageSize?: number;
  /** Only invitations with this status. */
  status?: 'all' | OrgInviteStatus;
}

/**
 * The query `GET /api/admin/organizations` accepts.
 *
 * @stability stable
 */
export interface OrganizationListParams {
  /** The page, one-based. */
  page?: number;
  /** The page size. */
  pageSize?: number;
  /** Matches name and slug. */
  search?: string;
}

// ---- The client --------------------------------------------------------------

/**
 * Every identity call the packaged pages make. {@link createIdentityApi}
 * builds one over the app's transport; an app may hand its own through the
 * identity adapters (`IdentityWebAdapters.api`), for example to keep calling
 * its existing service functions.
 *
 * @extensionPoint option
 * @stability experimental
 */
export interface IdentityApi {
  /** `GET /users?...`. */
  getUsers(params?: UserListParams): Promise<UsersResponse>;
  /** `PATCH /users/:id`. */
  updateUser(id: string, data: { displayName?: string; isActive?: boolean }): Promise<UserListItem>;
  /** `PUT /users/:id/roles`. */
  updateUserRoles(id: string, roles: string[]): Promise<UserListItem>;
  /** `GET /allowlist?...`. */
  getAllowlist(params?: AllowlistParams): Promise<AllowlistResponse>;
  /** `POST /allowlist`. */
  addToAllowlist(email: string, notes?: string): Promise<AllowedEmailEntry>;
  /** `DELETE /allowlist/:id`. */
  removeFromAllowlist(id: string): Promise<void>;
  /** `GET /auth/device/activate?code=...`. */
  getDeviceActivationInfo(userCode: string): Promise<DeviceActivationInfo>;
  /** `POST /auth/device/authorize`. */
  authorizeDevice(userCode: string, approve: boolean): Promise<DeviceAuthorizationResponse>;
  /** `GET /pat`. */
  getPersonalAccessTokens(): Promise<PersonalAccessToken[]>;
  /** `POST /pat`. */
  createPersonalAccessToken(data: CreatePatInput): Promise<PatCreatedResponse>;
  /** `DELETE /pat/:id`. */
  revokePersonalAccessToken(id: string): Promise<void>;
  /** `GET /org/members?...` (the active organization). */
  getOrgMembers(params?: OrgMemberListParams): Promise<Paginated<OrgMember>>;
  /** `PATCH /org/members/:userId`. */
  updateOrgMember(userId: string, data: { roleName?: OrgRole; status?: OrgMemberStatus }): Promise<OrgMember>;
  /** `DELETE /org/members/:userId`. */
  removeOrgMember(userId: string): Promise<void>;
  /** `GET /org/invites?...` (the active organization). */
  getOrgInvites(params?: OrgInviteListParams): Promise<Paginated<OrgInvite>>;
  /** `POST /org/invites`. */
  createOrgInvite(data: { email: string; roleName: OrgRole; notes?: string }): Promise<OrgInvite>;
  /** `DELETE /org/invites/:id`. */
  revokeOrgInvite(id: string): Promise<void>;
  /** `GET /admin/organizations?...`. */
  getOrganizations(params?: OrganizationListParams): Promise<Paginated<Organization>>;
  /** `POST /admin/organizations`. */
  createOrganization(data: { name: string; slug: string; firstAdminEmail: string }): Promise<Organization>;
  /** `PATCH /admin/organizations/:id`. */
  renameOrganization(id: string, name: string): Promise<Organization>;
}

function query(params: object | undefined): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

/**
 * The identity calls over `api` (the app's transport). Paths are relative to
 * the API base, as every `PlatformApiClient` call.
 *
 * @param api - the app's transport (`usePlatformApi()`); keep its identity stable.
 * @returns the client.
 *
 * @example
 * ```ts
 * const identity = createIdentityApi(usePlatformApi());
 * const page = await identity.getUsers({ page: 1, pageSize: 10 });
 * ```
 *
 * @stability experimental
 */
export function createIdentityApi(api: PlatformApiClient): IdentityApi {
  return Object.freeze<IdentityApi>({
    getUsers(params) {
      const searchParams = new URLSearchParams();
      if (params?.page) searchParams.set('page', String(params.page));
      if (params?.pageSize) searchParams.set('pageSize', String(params.pageSize));
      if (params?.search) searchParams.set('search', params.search);
      if (params?.role) searchParams.set('role', params.role);
      if (params?.isActive !== undefined) searchParams.set('isActive', String(params.isActive));
      if (params?.sortBy) searchParams.set('sortBy', params.sortBy);
      if (params?.sortOrder) searchParams.set('sortOrder', params.sortOrder);
      return api.get<UsersResponse>(`/users?${searchParams}`);
    },
    updateUser: (id, data) => api.patch<UserListItem>(`/users/${id}`, data),
    updateUserRoles: (id, roles) => api.put<UserListItem>(`/users/${id}/roles`, { roles }),
    getAllowlist(params) {
      const searchParams = new URLSearchParams();
      if (params?.page) searchParams.set('page', String(params.page));
      if (params?.pageSize) searchParams.set('pageSize', String(params.pageSize));
      if (params?.search) searchParams.set('search', params.search);
      if (params?.status) searchParams.set('status', params.status);
      if (params?.sortBy) searchParams.set('sortBy', params.sortBy);
      if (params?.sortOrder) searchParams.set('sortOrder', params.sortOrder);
      return api.get<AllowlistResponse>(`/allowlist?${searchParams}`);
    },
    addToAllowlist: (email, notes) => api.post<AllowedEmailEntry>('/allowlist', { email, notes }),
    async removeFromAllowlist(id) {
      await api.delete<void>(`/allowlist/${id}`);
    },
    getDeviceActivationInfo: (userCode) =>
      api.get<DeviceActivationInfo>(`/auth/device/activate?code=${userCode}`),
    authorizeDevice: (userCode, approve) =>
      api.post<DeviceAuthorizationResponse>('/auth/device/authorize', { userCode, approve }),
    getPersonalAccessTokens: () => api.get<PersonalAccessToken[]>('/pat'),
    createPersonalAccessToken: (data) => api.post<PatCreatedResponse>('/pat', data),
    async revokePersonalAccessToken(id) {
      await api.delete<void>(`/pat/${id}`);
    },
    getOrgMembers: (params) => api.get<Paginated<OrgMember>>(`/org/members${query(params)}`),
    updateOrgMember: (userId, data) => api.patch<OrgMember>(`/org/members/${encodeURIComponent(userId)}`, data),
    async removeOrgMember(userId) {
      await api.delete<void>(`/org/members/${encodeURIComponent(userId)}`);
    },
    getOrgInvites: (params) => api.get<Paginated<OrgInvite>>(`/org/invites${query(params)}`),
    createOrgInvite: (data) => api.post<OrgInvite>('/org/invites', data),
    async revokeOrgInvite(id) {
      await api.delete<void>(`/org/invites/${encodeURIComponent(id)}`);
    },
    getOrganizations: (params) => api.get<Paginated<Organization>>(`/admin/organizations${query(params)}`),
    createOrganization: (data) => api.post<Organization>('/admin/organizations', data),
    renameOrganization: (id, name) =>
      api.patch<Organization>(`/admin/organizations/${encodeURIComponent(id)}`, { name }),
  });
}
