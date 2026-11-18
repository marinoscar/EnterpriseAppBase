// The caller's storage objects client for the AI media pages (issue #890): an
// upload goes to storage first, the AI route names it by id.

import { useMemo } from 'react';

import { createStorageObjectsClient } from '../../storage/index.js';
import type { StorageObjectsClient } from '../../storage/index.js';
import type { PlatformApiClient } from '../../core/index.js';
import { useAiApi } from './use-ai-api.js';

/**
 * The storage objects client over the AI transport (`upload`, `uploadAndWait`,
 * `downloadUrl`, ...). Stable while the transport is.
 *
 * @param explicit - a transport to use instead of the host's.
 * @returns the client.
 *
 * @stability experimental
 */
export function useAiStorageObjects(explicit?: PlatformApiClient): StorageObjectsClient {
  const api = useAiApi(explicit);
  return useMemo(() => createStorageObjectsClient(api), [api]);
}
