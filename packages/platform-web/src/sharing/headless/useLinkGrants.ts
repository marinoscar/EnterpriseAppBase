// Link shares of one record (issue #731; routes from #730): list, create,
// revoke, copy.

import type { LinkGrantView } from '@marinoscar/platform-contract/sharing';
import { useCallback } from 'react';

import { copyText } from '../internal/clipboard.js';
import { useActionRunner } from '../internal/use-action-runner.js';
import { useAsyncResource } from '../internal/use-async-resource.js';
import { useSharingClient } from '../internal/use-sharing-client.js';
import type { CreateLinkInput, IssuedLinkGrant, SharingClient } from './client.js';
import type { ResourceRef, SharingResource } from './types.js';

/**
 * What {@link useLinkGrants} returns: the record's active links and the link writes.
 *
 * @stability experimental
 */
export interface UseLinkGrantsReturn extends SharingResource<LinkGrantView[]> {
  /** A write is in flight. */
  pending: boolean;
  /** Create a link. The token is in the result's `url` once; never store it. Rejects with a `SharingError`. */
  create(input?: CreateLinkInput): Promise<IssuedLinkGrant>;
  /** Revoke a link: the next resolution of its token is a `404`. Rejects with a `SharingError`. */
  revoke(grantId: string): Promise<void>;
  /**
   * Copy a share URL to the clipboard. Resolves `true` when it was copied,
   * `false` when the browser refused (show the URL as text to copy by hand).
   */
  copyUrl(url: string): Promise<boolean>;
}

/**
 * The link grants of one record. The links route arrives with #730: until it
 * is deployed the list fails with a `404`, which a component shows as "links
 * are not available".
 *
 * @param resource - the record.
 * @param options - `enabled` (default `true`) and `client`.
 * @returns the active links, `{ loading, error, refresh }` and `create`, `revoke`, `copyUrl`.
 *
 * @example
 * ```tsx
 * const links = useLinkGrants(resource);
 * const { url } = await links.create({ expiresAt: null });
 * ```
 *
 * @stability experimental
 */
export function useLinkGrants(resource: ResourceRef, options: { enabled?: boolean; client?: SharingClient } = {}): UseLinkGrantsReturn {
  const client = useSharingClient(options.client, 'useLinkGrants');
  const enabled = options.enabled ?? true;
  const { type, id } = resource;
  const list = useAsyncResource(
    (signal) => client.listLinkGrants({ type, id }, { signal }),
    `${type}:${id}:${String(enabled)}`,
    { enabled, fallbackMessage: 'Could not load the links.' },
  );
  const { pending, run } = useActionRunner();
  const create = useCallback(
    (input?: CreateLinkInput) => run(() => client.createLinkGrant({ type, id }, input), 'Could not create the link.'),
    [client, run, type, id],
  );
  const revoke = useCallback((grantId: string) => run(() => client.revokeGrant(grantId), 'Could not revoke the link.'), [client, run]);
  return { ...list, pending, create, revoke, copyUrl: copyText };
}
