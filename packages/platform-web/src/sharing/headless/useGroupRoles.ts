// The group roles the API offers (PP-14.15b; `GET /sharing/group-roles`).

import type { GroupRoleList } from '@marinoscar/platform-contract/sharing';

import { useAsyncResource } from '../internal/use-async-resource.js';
import { useSharingClient } from '../internal/use-sharing-client.js';
import type { SharingClient } from './client.js';
import type { SharingResource } from './types.js';

/**
 * Loads the registered group roles: `admin`, `editor`, `viewer` and any the app
 * registered on the API with `registerGroupRole`, strongest first, each with
 * its label and actions. A member role picker lists these.
 *
 * @param options - `enabled` (default `true`) and `client`.
 * @returns `{ data, loading, error, refresh }`.
 *
 * @example
 * ```tsx
 * const roles = useGroupRoles();
 * const options = (roles.data?.items ?? []).map((role) => ({ value: role.id, label: role.label }));
 * ```
 *
 * @extensionPoint hook
 * @stability experimental
 */
export function useGroupRoles(options: { enabled?: boolean; client?: SharingClient } = {}): SharingResource<GroupRoleList> {
  const client = useSharingClient(options.client, 'useGroupRoles');
  const enabled = options.enabled ?? true;
  return useAsyncResource((signal) => client.listGroupRoles({ signal }), `group-roles:${String(enabled)}`, {
    enabled,
    fallbackMessage: 'Could not load the group roles.',
  });
}
