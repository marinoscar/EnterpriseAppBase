// The transport every AI hook calls through (issue #890): the platform host's
// `api`, or one handed to the hook. Without either, the calls reject with a
// sentence the page can show instead of the hook throwing while it renders.

import { useOptionalPlatformHost } from '../../core/index.js';
import type { PlatformApiClient } from '../../core/index.js';

const NO_TRANSPORT =
  'No platform transport is available. Mount PlatformHostProvider (@marinoscar/platform-web/core).';

function missing(): Promise<never> {
  return Promise.reject(new Error(NO_TRANSPORT));
}

/** A transport whose every call rejects; what a hook uses when no host is mounted. */
const NO_API: PlatformApiClient = Object.freeze({
  get: missing,
  post: missing,
  put: missing,
  patch: missing,
  delete: missing,
});

/**
 * The transport an AI hook calls through: `explicit` when given, else the
 * `PlatformHostProvider`'s `api`, else a transport whose calls reject with
 * "No platform transport is available".
 *
 * @param explicit - a transport to use instead (keep its identity stable).
 * @returns the transport.
 *
 * @stability experimental
 */
export function useAiApi(explicit?: PlatformApiClient): PlatformApiClient {
  const hostApi = useOptionalPlatformHost()?.api;
  return explicit ?? hostApi ?? NO_API;
}

/**
 * What every AI hook takes as its (last, optional) argument.
 *
 * @stability experimental
 */
export interface AiHookOptions {
  /** The transport. Default: the `PlatformHostProvider`'s (keep its identity stable). */
  api?: PlatformApiClient;
}
