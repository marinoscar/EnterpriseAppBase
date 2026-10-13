// The grantee kinds the API offers (PP-14.16; `GET /sharing/grantee-kinds`).

import type { GranteeKindList } from '@marinoscar/platform-contract/sharing';

import { useAsyncResource } from '../internal/use-async-resource.js';
import { useSharingClient } from '../internal/use-sharing-client.js';
import type { SharingClient } from './client.js';
import type { SharingResource } from './types.js';

/**
 * Loads the registered grantee kinds: `user`, `group`, `link` and any the app
 * registered on the API, each with its label, input type and whether a grant
 * of it can be stored.
 *
 * @param options - `enabled` (default `true`) and `client`.
 * @returns `{ data, loading, error, refresh }`.
 *
 * @example
 * ```tsx
 * const kinds = useGranteeKinds();
 * const extra = kinds.data?.items.filter((kind) => !kind.builtin && kind.persisted) ?? [];
 * ```
 *
 * @extensionPoint hook
 * @stability experimental
 */
export function useGranteeKinds(options: { enabled?: boolean; client?: SharingClient } = {}): SharingResource<GranteeKindList> {
  const client = useSharingClient(options.client, 'useGranteeKinds');
  const enabled = options.enabled ?? true;
  return useAsyncResource((signal) => client.listGranteeKinds({ signal }), `grantee-kinds:${String(enabled)}`, {
    enabled,
    fallbackMessage: 'Could not load the ways to share.',
  });
}
