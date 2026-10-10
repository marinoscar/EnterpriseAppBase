// The sharing API calls over the app's transport (issue #731, PP-7.4).
//
// Routes (`@marinoscar/platform-contract/sharing`): groups, members and
// invites (#728), grants and "shared with me" (#729), link grants and the
// public resolution (#730). Paths are relative to the API base, like every
// `PlatformApiClient` call.

import { LINK_TOKEN_HEADER } from '@marinoscar/platform-contract/sharing';
import type {
  CreateGroupInput,
  GrantDto,
  GrantList,
  GroupDto,
  GroupInviteDto,
  GroupInviteList,
  GroupList,
  GroupMemberDto,
  GroupMemberList,
  GroupMembershipDto,
  GroupRole,
  LinkGrantView,
  MyGroupInviteList,
  PublicLinkResolution,
  SharedWithMeList,
} from '@marinoscar/platform-contract/sharing';

import type { PlatformApiClient, PlatformRequestOptions } from '../../core/index.js';
import type { ResourceRef } from './types.js';

/**
 * Where the sharing routes live, relative to the API base. The defaults are
 * the paths `@marinoscar/platform-api/sharing` mounts.
 *
 * @stability experimental
 */
export interface SharingClientPaths {
  /** Default `'/groups'`. */
  groups?: string;
  /** Default `'/grants'`. Link grants live under `${grants}/links`. */
  grants?: string;
  /** Default `'/public/links'`. The resolution is `GET ${publicLinks}/current`. */
  publicLinks?: string;
}

/**
 * A page request: 1-based page and page size (at most 100).
 *
 * @stability experimental
 */
export interface SharingPageQuery {
  /** 1-based page. */
  page?: number;
  /** Items per page, at most 100. */
  pageSize?: number;
}

/**
 * Who `createGrant` shares with: a user by e-mail or id, or a group.
 *
 * @stability experimental
 */
export type ShareTarget =
  | {
      /** A person. */
      kind: 'user';
      /** Their e-mail, looked up among the organization's members. */
      email: string;
    }
  | {
      /** A person. */
      kind: 'user';
      /** Their user id. */
      userId: string;
    }
  | {
      /** A group of the organization. */
      kind: 'group';
      /** The group. */
      groupId: string;
    };

/**
 * What creating a link grant returns: the grant, its share URL and the token,
 * the last two only in this one response (#730).
 *
 * @stability experimental
 */
export interface IssuedLinkGrant {
  /** The link grant. */
  grant: LinkGrantView;
  /** `…/s#lnk_…`, or `null` when the API sent none. */
  url: string | null;
  /** The token, or `null` when the API sent none. Never store it. */
  token: string | null;
}

/**
 * The input of `createLinkGrant`.
 *
 * @stability experimental
 */
export interface CreateLinkInput {
  /** The role anyone holding the link gets. Absent: the type's weakest link role. */
  role?: string;
  /** When the link stops working (ISO 8601), or `null` for never. Absent: the deployment default. */
  expiresAt?: string | null;
  /** A label for the sharer's list. */
  label?: string;
}

/**
 * Every sharing call the hooks make. Each method resolves to the response's
 * data and rejects with the transport's error.
 *
 * @stability experimental
 */
export interface SharingClient {
  /** `GET /groups?scope=…`. */
  listGroups(query: { scope: 'mine' | 'all' } & SharingPageQuery, options?: PlatformRequestOptions): Promise<GroupList>;
  /** `GET /groups/:id`. */
  getGroup(id: string, options?: PlatformRequestOptions): Promise<GroupDto>;
  /** `POST /groups`. */
  createGroup(input: CreateGroupInput): Promise<GroupDto>;
  /** `PATCH /groups/:id` with `If-Match: <version>`. */
  updateGroup(id: string, input: { name?: string; description?: string | null }, version: number): Promise<GroupDto>;
  /** `DELETE /groups/:id`. */
  deleteGroup(id: string): Promise<void>;
  /** `GET /groups/:id/members`. */
  listMembers(id: string, query?: SharingPageQuery, options?: PlatformRequestOptions): Promise<GroupMemberList>;
  /** `POST /groups/:id/members`. */
  addMember(id: string, input: { email: string; role?: GroupRole } | { userId: string; role?: GroupRole }): Promise<GroupMemberDto>;
  /** `PATCH /groups/:id/members/:userId`. */
  updateMember(id: string, userId: string, role: GroupRole): Promise<GroupMemberDto>;
  /** `DELETE /groups/:id/members/:userId` (your own id: leave). */
  removeMember(id: string, userId: string): Promise<void>;
  /** `GET /groups/:id/invites?status=…`. */
  listInvites(id: string, query?: { status?: 'pending' | 'all' } & SharingPageQuery, options?: PlatformRequestOptions): Promise<GroupInviteList>;
  /** `POST /groups/:id/invites`. */
  createInvite(id: string, input: { email: string; role?: GroupRole }): Promise<GroupInviteDto>;
  /** `DELETE /groups/:id/invites/:inviteId`. */
  revokeInvite(id: string, inviteId: string): Promise<void>;
  /** `GET /groups/invites/mine`. */
  myInvites(options?: PlatformRequestOptions): Promise<MyGroupInviteList>;
  /** `POST /groups/invites/:inviteId/accept`. */
  acceptInvite(inviteId: string): Promise<GroupMembershipDto>;
  /** `POST /groups/invites/:inviteId/decline`. */
  declineInvite(inviteId: string): Promise<void>;
  /** `GET /grants?resourceType&resourceId`. */
  listGrants(resource: ResourceRef, query?: SharingPageQuery, options?: PlatformRequestOptions): Promise<GrantList>;
  /** `POST /grants`. */
  createGrant(resource: ResourceRef, target: ShareTarget, role: string, expiresAt?: string | null): Promise<GrantDto>;
  /** `PATCH /grants/:id`. */
  updateGrant(id: string, input: { role?: string; expiresAt?: string | null }): Promise<GrantDto>;
  /** `DELETE /grants/:id` (a user, group or link grant). */
  revokeGrant(id: string): Promise<void>;
  /** `GET /grants/shared-with-me`. */
  sharedWithMe(query?: { resourceType?: string } & SharingPageQuery, options?: PlatformRequestOptions): Promise<SharedWithMeList>;
  /** `GET /grants/links?resourceType&resourceId` (#730): the record's active link grants. */
  listLinkGrants(resource: ResourceRef, options?: PlatformRequestOptions): Promise<LinkGrantView[]>;
  /** `POST /grants/links` (#730). */
  createLinkGrant(resource: ResourceRef, input?: CreateLinkInput): Promise<IssuedLinkGrant>;
  /** `GET /public/links/current` with the token in `x-link-token` (#730); never in the path or query. */
  resolvePublicLink(token: string, options?: PlatformRequestOptions): Promise<PublicLinkResolution>;
}

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

const enc = encodeURIComponent;

/**
 * The active links of a `linkGrantListSchema` page (#730: newest first, a
 * revoked link included with `url: null`). An array is accepted too.
 */
function linkItems(body: unknown): LinkGrantView[] {
  const items = Array.isArray(body)
    ? (body as LinkGrantView[])
    : body !== null && typeof body === 'object' && Array.isArray((body as { items?: unknown }).items)
      ? ((body as { items: LinkGrantView[] }).items)
      : [];
  return items.filter((link) => link.revokedAt === null || link.revokedAt === undefined);
}

/** `issuedLinkGrantSchema` (`{ grant, url, token }`, #730); a bare view is accepted too. */
function issued(body: unknown): IssuedLinkGrant {
  const value = (body ?? {}) as Partial<IssuedLinkGrant> & Partial<LinkGrantView> & { token?: string | null };
  if (value.grant && typeof value.grant === 'object') {
    return { grant: value.grant, url: value.url ?? value.grant.url ?? null, token: value.token ?? null };
  }
  const grant = value as LinkGrantView;
  return { grant, url: grant.url ?? null, token: value.token ?? null };
}

/**
 * The sharing client over the app's transport.
 *
 * @param api - the app's transport (`usePlatformApi()`).
 * @param paths - where the routes live, when the app moved them.
 * @returns the client.
 *
 * @example
 * ```ts
 * const client = createSharingClient(usePlatformApi());
 * const groups = await client.listGroups({ scope: 'mine' });
 * ```
 *
 * @stability experimental
 */
export function createSharingClient(api: PlatformApiClient, paths: SharingClientPaths = {}): SharingClient {
  const groups = paths.groups ?? '/groups';
  const grants = paths.grants ?? '/grants';
  const publicLinks = paths.publicLinks ?? '/public/links';

  return {
    listGroups: (q, options) => api.get<GroupList>(`${groups}${query({ scope: q.scope, page: q.page, pageSize: q.pageSize })}`, options),
    getGroup: (id, options) => api.get<GroupDto>(`${groups}/${enc(id)}`, options),
    createGroup: (input) => api.post<GroupDto>(groups, input),
    updateGroup: (id, input, version) => api.patch<GroupDto>(`${groups}/${enc(id)}`, input, { ifMatch: String(version) }),
    deleteGroup: (id) => api.delete<void>(`${groups}/${enc(id)}`),
    listMembers: (id, q = {}, options) =>
      api.get<GroupMemberList>(`${groups}/${enc(id)}/members${query({ page: q.page, pageSize: q.pageSize })}`, options),
    addMember: (id, input) => api.post<GroupMemberDto>(`${groups}/${enc(id)}/members`, input),
    updateMember: (id, userId, role) => api.patch<GroupMemberDto>(`${groups}/${enc(id)}/members/${enc(userId)}`, { role }),
    removeMember: (id, userId) => api.delete<void>(`${groups}/${enc(id)}/members/${enc(userId)}`),
    listInvites: (id, q = {}, options) =>
      api.get<GroupInviteList>(
        `${groups}/${enc(id)}/invites${query({ status: q.status, page: q.page, pageSize: q.pageSize })}`,
        options,
      ),
    createInvite: (id, input) => api.post<GroupInviteDto>(`${groups}/${enc(id)}/invites`, input),
    revokeInvite: (id, inviteId) => api.delete<void>(`${groups}/${enc(id)}/invites/${enc(inviteId)}`),
    myInvites: (options) => api.get<MyGroupInviteList>(`${groups}/invites/mine`, options),
    acceptInvite: (inviteId) => api.post<GroupMembershipDto>(`${groups}/invites/${enc(inviteId)}/accept`),
    declineInvite: (inviteId) => api.post<void>(`${groups}/invites/${enc(inviteId)}/decline`),
    listGrants: (resource, q = {}, options) =>
      api.get<GrantList>(
        `${grants}${query({ resourceType: resource.type, resourceId: resource.id, page: q.page, pageSize: q.pageSize })}`,
        options,
      ),
    createGrant: (resource, target, role, expiresAt) =>
      api.post<GrantDto>(grants, {
        resourceType: resource.type,
        resourceId: resource.id,
        grantee: target,
        role,
        ...(expiresAt === undefined ? {} : { expiresAt }),
      }),
    updateGrant: (id, input) => api.patch<GrantDto>(`${grants}/${enc(id)}`, input),
    revokeGrant: (id) => api.delete<void>(`${grants}/${enc(id)}`),
    sharedWithMe: (q = {}, options) =>
      api.get<SharedWithMeList>(
        `${grants}/shared-with-me${query({ resourceType: q.resourceType, page: q.page, pageSize: q.pageSize })}`,
        options,
      ),
    listLinkGrants: async (resource, options) =>
      linkItems(
        await api.get<unknown>(
          `${grants}/links${query({ resourceType: resource.type, resourceId: resource.id, pageSize: 100 })}`,
          options,
        ),
      ),
    createLinkGrant: async (resource, input = {}) =>
      issued(
        await api.post<unknown>(`${grants}/links`, {
          resourceType: resource.type,
          resourceId: resource.id,
          ...(input.role === undefined ? {} : { role: input.role }),
          ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
          ...(input.label === undefined ? {} : { label: input.label }),
        }),
      ),
    resolvePublicLink: (token, options) =>
      api.get<PublicLinkResolution>(`${publicLinks}/current`, {
        ...(options?.signal === undefined ? {} : { signal: options.signal }),
        headers: { ...(options?.headers ?? {}), [LINK_TOKEN_HEADER]: token },
      }),
  };
}
