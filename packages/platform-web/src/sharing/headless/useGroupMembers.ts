// The members of one group (issue #731; `GET /groups/:id/members`, #728).

import type { GroupMemberList } from '@marinoscar/platform-contract/sharing';

import { useAsyncResource } from '../internal/use-async-resource.js';
import { useSharingClient } from '../internal/use-sharing-client.js';
import type { SharingClient, SharingPageQuery } from './client.js';
import type { SharingResource } from './types.js';

/**
 * Lists a group's members, admins first. For a member of the group or a
 * `groups:admin` holder.
 *
 * @param id - the group id; `undefined` skips the request.
 * @param options - the page (default 1, page size 100) and `client`.
 * @returns `{ data, loading, error, refresh }`.
 *
 * @example
 * ```tsx
 * const members = useGroupMembers(groupId);
 * ```
 *
 * @stability experimental
 */
export function useGroupMembers(
  id: string | undefined,
  options: SharingPageQuery & { client?: SharingClient } = {},
): SharingResource<GroupMemberList> {
  const client = useSharingClient(options.client, 'useGroupMembers');
  const page = options.page ?? 1;
  const pageSize = options.pageSize ?? 100;
  return useAsyncResource((signal) => client.listMembers(id ?? '', { page, pageSize }, { signal }), `${id ?? ''}:${page}:${pageSize}`, {
    enabled: id !== undefined && id !== '',
    fallbackMessage: 'Could not load the members.',
  });
}
