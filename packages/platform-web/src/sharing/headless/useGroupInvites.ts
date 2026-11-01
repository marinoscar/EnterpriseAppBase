// Invitations: a group's (for its admins) and the viewer's own (issue #731;
// routes from #728).

import type { GroupInviteList, MyGroupInviteList } from '@marinoscar/platform-contract/sharing';

import { useAsyncResource } from '../internal/use-async-resource.js';
import { useSharingClient } from '../internal/use-sharing-client.js';
import type { SharingClient, SharingPageQuery } from './client.js';
import type { SharingResource } from './types.js';

/**
 * Lists a group's invitations, newest first. Only a group admin may read
 * them: pass `enabled: false` for anyone else.
 *
 * @param id - the group id; `undefined` skips the request.
 * @param options - `status` (`pending`, default, or `all`), the page, `enabled` and `client`.
 * @returns `{ data, loading, error, refresh }`.
 *
 * @stability experimental
 */
export function useGroupInvites(
  id: string | undefined,
  options: SharingPageQuery & { status?: 'pending' | 'all'; enabled?: boolean; client?: SharingClient } = {},
): SharingResource<GroupInviteList> {
  const client = useSharingClient(options.client, 'useGroupInvites');
  const status = options.status ?? 'pending';
  const page = options.page ?? 1;
  const pageSize = options.pageSize ?? 100;
  const enabled = (options.enabled ?? true) && id !== undefined && id !== '';
  return useAsyncResource(
    (signal) => client.listInvites(id ?? '', { status, page, pageSize }, { signal }),
    `${id ?? ''}:${status}:${page}:${pageSize}:${String(enabled)}`,
    { enabled, fallbackMessage: 'Could not load the invitations.' },
  );
}

/**
 * The viewer's own pending group invitations (`GET /groups/invites/mine`).
 * Accept or decline them with `useGroupActions()`.
 *
 * @param options - `client`: the client to use.
 * @returns `{ data, loading, error, refresh }`.
 *
 * @example
 * ```tsx
 * const { data } = useMyGroupInvites();
 * ```
 *
 * @stability experimental
 */
export function useMyGroupInvites(options: { client?: SharingClient } = {}): SharingResource<MyGroupInviteList> {
  const client = useSharingClient(options.client, 'useMyGroupInvites');
  return useAsyncResource((signal) => client.myInvites({ signal }), 'mine', {
    fallbackMessage: 'Could not load your invitations.',
  });
}
