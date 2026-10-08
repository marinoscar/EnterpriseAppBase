// The grants of one record and the writes on them (issue #731; `/grants`, #729).

import type { GrantDto, GrantList } from '@marinoscar/platform-contract/sharing';
import { useMemo } from 'react';

import { useActionRunner } from '../internal/use-action-runner.js';
import { useAsyncResource } from '../internal/use-async-resource.js';
import { useSharingClient } from '../internal/use-sharing-client.js';
import type { SharingClient } from './client.js';
import type { ResourceRef, SharingResource } from './types.js';

/**
 * Lists the active user and group grants of one record, oldest first. The
 * viewer must be allowed to share it; anyone else gets a `404`.
 *
 * @param resource - the record.
 * @param options - `enabled` (default `true`) and `client`.
 * @returns `{ data, loading, error, refresh }`.
 *
 * @example
 * ```tsx
 * const grants = useGrants({ type: 'transcript', id });
 * ```
 *
 * @stability experimental
 */
export function useGrants(resource: ResourceRef, options: { enabled?: boolean; client?: SharingClient } = {}): SharingResource<GrantList> {
  const client = useSharingClient(options.client, 'useGrants');
  const enabled = options.enabled ?? true;
  return useAsyncResource(
    (signal) => client.listGrants(resource, { pageSize: 100 }, { signal }),
    `${resource.type}:${resource.id}:${String(enabled)}`,
    { enabled, fallbackMessage: 'Could not load who this is shared with.' },
  );
}

/**
 * The share writes on one record. Each action rejects with a `SharingError`:
 * `NOT_AN_ORG_MEMBER` (`422`, the address is not a member), `ROLE_NOT_GRANTABLE`
 * (`422`), `LOOKUP_THROTTLED` (`429`, `retryAfterSeconds`), `SELF_GRANT`, ...
 *
 * @stability experimental
 */
export interface ShareActions {
  /** A call is in flight. */
  pending: boolean;
  /** Share with a person by e-mail; an existing grant to them gets the new role. */
  shareWithEmail(email: string, role: string, expiresAt?: string | null): Promise<GrantDto>;
  /** Share with a person by user id. */
  shareWithUser(userId: string, role: string, expiresAt?: string | null): Promise<GrantDto>;
  /** Share with a group of the organization. */
  shareWithGroup(groupId: string, role: string, expiresAt?: string | null): Promise<GrantDto>;
  /** Change a grant's role. */
  changeRole(grantId: string, role: string): Promise<GrantDto>;
  /** Change or remove (`null`) a grant's expiry. */
  changeExpiry(grantId: string, expiresAt: string | null): Promise<GrantDto>;
  /** Revoke a grant (user, group or link). */
  revoke(grantId: string): Promise<void>;
}

/**
 * The share writes for one record. Call `useGrants(...).refresh()` after a write.
 *
 * @param resource - the record.
 * @param options - `client`: the client to use.
 * @returns the actions and a `pending` flag.
 *
 * @example
 * ```tsx
 * const share = useShareActions(resource);
 * await share.shareWithEmail('ana@example.com', 'viewer');
 * ```
 *
 * @stability experimental
 */
export function useShareActions(resource: ResourceRef, options: { client?: SharingClient } = {}): ShareActions {
  const client = useSharingClient(options.client, 'useShareActions');
  const { pending, run } = useActionRunner();
  const { type, id } = resource;
  const actions = useMemo(() => {
    const ref = { type, id };
    return {
      shareWithEmail: (email: string, role: string, expiresAt?: string | null) =>
        run(() => client.createGrant(ref, { kind: 'user', email }, role, expiresAt), 'Could not share.'),
      shareWithUser: (userId: string, role: string, expiresAt?: string | null) =>
        run(() => client.createGrant(ref, { kind: 'user', userId }, role, expiresAt), 'Could not share.'),
      shareWithGroup: (groupId: string, role: string, expiresAt?: string | null) =>
        run(() => client.createGrant(ref, { kind: 'group', groupId }, role, expiresAt), 'Could not share with the group.'),
      changeRole: (grantId: string, role: string) => run(() => client.updateGrant(grantId, { role }), 'Could not change the role.'),
      changeExpiry: (grantId: string, expiresAt: string | null) =>
        run(() => client.updateGrant(grantId, { expiresAt }), 'Could not change the expiry.'),
      revoke: (grantId: string) => run(() => client.revokeGrant(grantId), 'Could not remove access.'),
    };
  }, [client, run, type, id]);
  return { pending, ...actions };
}
