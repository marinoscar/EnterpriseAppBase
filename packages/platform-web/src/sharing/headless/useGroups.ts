// Groups: the list, one group, and every write on groups, members and invites
// (issue #731; routes from #728).

import type { CreateGroupInput, GroupDto, GroupInviteDto, GroupList, GroupMemberDto, GroupMembershipDto, GroupRole } from '@marinoscar/platform-contract/sharing';
import { useMemo } from 'react';

import { useActionRunner } from '../internal/use-action-runner.js';
import { useAsyncResource } from '../internal/use-async-resource.js';
import { useSharingClient } from '../internal/use-sharing-client.js';
import type { SharingClient } from './client.js';
import type { SharingResource } from './types.js';

/**
 * What {@link useGroups} takes.
 *
 * @stability experimental
 */
export interface UseGroupsOptions {
  /** `mine` (default): groups the viewer belongs to. `all`: every group of the organization (`groups:admin`). */
  scope?: 'mine' | 'all';
  /** 1-based page. Default 1. */
  page?: number;
  /** Page size, at most 100. Default 100 (a picker wants them all). */
  pageSize?: number;
  /** `false` skips the request (e.g. `all` without `groups:admin`). Default `true`. */
  enabled?: boolean;
  /** The client to use. Default: one over the host's transport. */
  client?: SharingClient;
}

/**
 * Lists groups: the viewer's (`mine`) or, for a `groups:admin` holder, every
 * group of the organization (`all`).
 *
 * @param options - the scope, the page, or just `'mine'` / `'all'`.
 * @returns `{ data, loading, error, refresh }`; `data` is the page.
 * @throws Error when no `client` is given and no `PlatformHostProvider` is mounted.
 *
 * @example
 * ```tsx
 * const { data, loading, error } = useGroups('mine');
 * ```
 *
 * @stability experimental
 */
export function useGroups(options: UseGroupsOptions | 'mine' | 'all' = {}): SharingResource<GroupList> {
  const opts: UseGroupsOptions = typeof options === 'string' ? { scope: options } : options;
  const client = useSharingClient(opts.client, 'useGroups');
  const scope = opts.scope ?? 'mine';
  const page = opts.page ?? 1;
  const pageSize = opts.pageSize ?? 100;
  return useAsyncResource(
    (signal) => client.listGroups({ scope, page, pageSize }, { signal }),
    `${scope}:${page}:${pageSize}:${String(opts.enabled ?? true)}`,
    { enabled: opts.enabled ?? true, fallbackMessage: 'Could not load the groups.' },
  );
}

/**
 * Loads one group (`GET /groups/:id`). A group the viewer may not see is a
 * `404`, never a `403`.
 *
 * @param id - the group id; `undefined` skips the request.
 * @param options - `client`: the client to use.
 * @returns `{ data, loading, error, refresh }`.
 *
 * @stability experimental
 */
export function useGroup(id: string | undefined, options: { client?: SharingClient } = {}): SharingResource<GroupDto> {
  const client = useSharingClient(options.client, 'useGroup');
  return useAsyncResource((signal) => client.getGroup(id ?? '', { signal }), id ?? '', {
    enabled: id !== undefined && id !== '',
    fallbackMessage: 'Could not load the group.',
  });
}

/**
 * Every write on groups, their members and their invites. Each action
 * rejects with a `SharingError` (show `message`, branch on `reason`:
 * `VERSION_CONFLICT`, `GROUP_OWNS_RESOURCES`, `LAST_GROUP_ADMIN`, ...).
 *
 * @stability experimental
 */
export interface GroupActions {
  /** A call is in flight. */
  pending: boolean;
  /** Create a group; the viewer becomes its admin. */
  create(input: CreateGroupInput): Promise<GroupDto>;
  /** Rename or re-describe a group; `version` is sent as `If-Match` (a stale one is `VERSION_CONFLICT`). */
  update(id: string, input: { name?: string; description?: string | null }, version: number): Promise<GroupDto>;
  /** Delete a group (`GROUP_OWNS_RESOURCES` while it still owns records). */
  remove(id: string): Promise<void>;
  /** Add a member directly, by e-mail or user id. */
  addMember(id: string, input: { email: string; role?: GroupRole } | { userId: string; role?: GroupRole }): Promise<GroupMemberDto>;
  /** Change a member's role (`LAST_GROUP_ADMIN` for the last admin). */
  updateMember(id: string, userId: string, role: GroupRole): Promise<GroupMemberDto>;
  /** Remove a member; with the viewer's own id, leave the group (`LAST_GROUP_ADMIN` for the last admin). */
  removeMember(id: string, userId: string): Promise<void>;
  /** Invite an address. */
  invite(id: string, input: { email: string; role?: GroupRole }): Promise<GroupInviteDto>;
  /** Revoke a pending invite. */
  revokeInvite(id: string, inviteId: string): Promise<void>;
  /** Accept one of the viewer's invites. */
  accept(inviteId: string): Promise<GroupMembershipDto>;
  /** Decline one of the viewer's invites. */
  decline(inviteId: string): Promise<void>;
}

/**
 * The group writes. Pair it with the read hooks and call their `refresh`
 * after a write.
 *
 * @param options - `client`: the client to use.
 * @returns the actions and a `pending` flag.
 *
 * @example
 * ```tsx
 * const actions = useGroupActions();
 * await actions.update(group.id, { name }, group.version);
 * ```
 *
 * @stability experimental
 */
export function useGroupActions(options: { client?: SharingClient } = {}): GroupActions {
  const client = useSharingClient(options.client, 'useGroupActions');
  const { pending, run } = useActionRunner();
  const actions = useMemo(
    () => ({
      create: (input: CreateGroupInput) => run(() => client.createGroup(input), 'Could not create the group.'),
      update: (id: string, input: { name?: string; description?: string | null }, version: number) =>
        run(() => client.updateGroup(id, input, version), 'Could not save the group.'),
      remove: (id: string) => run(() => client.deleteGroup(id), 'Could not delete the group.'),
      addMember: (id: string, input: { email: string; role?: GroupRole } | { userId: string; role?: GroupRole }) =>
        run(() => client.addMember(id, input), 'Could not add the member.'),
      updateMember: (id: string, userId: string, role: GroupRole) =>
        run(() => client.updateMember(id, userId, role), "Could not change the member's role."),
      removeMember: (id: string, userId: string) => run(() => client.removeMember(id, userId), 'Could not remove the member.'),
      invite: (id: string, input: { email: string; role?: GroupRole }) =>
        run(() => client.createInvite(id, input), 'Could not send the invitation.'),
      revokeInvite: (id: string, inviteId: string) =>
        run(() => client.revokeInvite(id, inviteId), 'Could not revoke the invitation.'),
      accept: (inviteId: string) => run(() => client.acceptInvite(inviteId), 'Could not accept the invitation.'),
      decline: (inviteId: string) => run(() => client.declineInvite(inviteId), 'Could not decline the invitation.'),
    }),
    [client, run],
  );
  return { pending, ...actions };
}
