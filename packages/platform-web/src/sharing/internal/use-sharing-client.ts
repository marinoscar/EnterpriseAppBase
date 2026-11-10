// The client a hook uses: the one passed in, else one over the host's
// transport. Not exported; each public hook takes an optional `client`.

import { useMemo } from 'react';

import { useOptionalPlatformHost } from '../../core/index.js';
import { createSharingClient } from '../headless/client.js';
import type { SharingClient } from '../headless/client.js';

export function useSharingClient(client: SharingClient | undefined, hook: string): SharingClient {
  const api = useOptionalPlatformHost()?.api;
  return useMemo(() => {
    if (client) return client;
    if (!api) {
      throw new Error(
        `${hook}: no PlatformHostProvider above this component and no client was passed. ` +
          'Mount PlatformHostProvider (from @marinoscar/platform-web/core) or pass createSharingClient(api).',
      );
    }
    return createSharingClient(api);
  }, [client, api, hook]);
}
