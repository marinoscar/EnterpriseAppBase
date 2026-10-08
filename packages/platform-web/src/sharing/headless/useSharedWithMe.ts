// What is shared with the viewer (issue #731; `GET /grants/shared-with-me`, #729).

import type { SharedWithMeList } from '@marinoscar/platform-contract/sharing';

import { useAsyncResource } from '../internal/use-async-resource.js';
import { useSharingClient } from '../internal/use-sharing-client.js';
import type { SharingClient, SharingPageQuery } from './client.js';
import type { SharingResource } from './types.js';

/**
 * Records shared with the viewer, directly or through a group, newest first,
 * with `title` and `path` when the resource type describes its records.
 *
 * @param resourceType - only records of this type; omit for every type.
 * @param options - the page (default 1, page size 100) and `client`.
 * @returns `{ data, loading, error, refresh }`.
 *
 * @example
 * ```tsx
 * const { data } = useSharedWithMe('transcript');
 * ```
 *
 * @stability experimental
 */
export function useSharedWithMe(
  resourceType?: string,
  options: SharingPageQuery & { client?: SharingClient } = {},
): SharingResource<SharedWithMeList> {
  const client = useSharingClient(options.client, 'useSharedWithMe');
  const page = options.page ?? 1;
  const pageSize = options.pageSize ?? 100;
  return useAsyncResource(
    (signal) => client.sharedWithMe({ ...(resourceType === undefined ? {} : { resourceType }), page, pageSize }, { signal }),
    `${resourceType ?? '*'}:${page}:${pageSize}`,
    { fallbackMessage: 'Could not load what is shared with you.' },
  );
}
