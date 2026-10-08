// =============================================================================
// usePublicLink: resolve the link token of the public `/s` page (issue #731)
// =============================================================================
//
// A share URL is `${APP_URL}/s#lnk_…` (`buildLinkUrl`): the token rides in the
// FRAGMENT, which a browser never sends to a server, so it never reaches an
// access log, a span or a `Referer`. This hook keeps it that way in the
// browser:
//
//   1. it reads the token from `window.location.hash`;
//   2. it removes the fragment from the address bar AT ONCE, with
//      `history.replaceState` (keeping the router's history state), before any
//      request, so the token survives in neither the history, a screenshot, a
//      bookmark nor a later `Referer`;
//   3. it keeps the token in memory only (a ref and state): NEVER
//      `localStorage`, `sessionStorage`, a cookie or IndexedDB, which any
//      script on the origin could read. A reload after the fragment is gone
//      shows the neutral message; the recipient opens the original link again;
//   4. it calls `GET /public/links/current` with the token in `x-link-token`
//      (`LINK_TOKEN_HEADER`), never in a path or a query string;
//   5. it never logs the token.
//
// Every failure (unknown, expired, revoked, malformed, throttled, network) is
// the same `unavailable` status, matching the API's uniform 404.
// =============================================================================

import type { PublicLinkResolution } from '@marinoscar/platform-contract/sharing';
import { useEffect, useMemo, useRef, useState } from 'react';

import { useOptionalPlatformHost } from '../../core/index.js';
import type { PlatformApiClient } from '../../core/index.js';
import { createSharingClient } from './client.js';
import type { SharingClient } from './client.js';
import { toSharingError } from './errors.js';
import type { SharingError } from './types.js';

/** A link token: `lnk_` plus base64url today; any base64url-ish string up to 256 characters is passed on. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{8,256}$/;

/**
 * The token in a URL fragment (`#lnk_…`), or `null` when the fragment is
 * empty or cannot be a token. Pure: it neither reads nor changes the location.
 *
 * @param hash - `location.hash`, with or without the leading `#`.
 * @returns the token, or `null`.
 *
 * @stability experimental
 */
export function parseLinkTokenFromHash(hash: string): string | null {
  let raw = hash.startsWith('#') ? hash.slice(1) : hash;
  try {
    raw = decodeURIComponent(raw);
  } catch {
    return null;
  }
  raw = raw.trim();
  return TOKEN_PATTERN.test(raw) ? raw : null;
}

/**
 * Where the public link resolution stands.
 *
 * @stability experimental
 */
export type PublicLinkStatus = 'loading' | 'ready' | 'unavailable';

/**
 * What {@link usePublicLink} returns.
 *
 * @stability experimental
 */
export interface UsePublicLinkReturn {
  /** `loading` until the API answers; `ready` with a resolution; `unavailable` for EVERY failure. */
  status: PublicLinkStatus;
  /** What the token resolved to, or `null`. */
  resolution: PublicLinkResolution | null;
  /** The token, in memory only, for a renderer's own `x-link-token` calls; `null` when there is none. */
  token: string | null;
  /** The failure, or `null`. Show the neutral message whatever it is; never the token. */
  error: SharingError | null;
  /** `status === 'loading'`. */
  loading: boolean;
}

/**
 * What {@link usePublicLink} takes.
 *
 * @stability experimental
 */
export interface UsePublicLinkOptions {
  /** The transport, for a page outside the app's `PlatformHostProvider` (the public route usually is). */
  apiClient?: PlatformApiClient;
  /** A sharing client, instead of `apiClient` (moved routes, tests). */
  client?: SharingClient;
}

const NO_TOKEN: SharingError = {
  message: 'This link is not available.',
  status: null,
  reason: null,
  retryAfterSeconds: null,
  details: undefined,
};

/** Removes the fragment from the address bar without a navigation, keeping the history state. */
function clearHash(): void {
  const { pathname, search } = window.location;
  window.history.replaceState(window.history.state, '', `${pathname}${search}`);
}

/**
 * Resolves the link token in the page's URL fragment. See the module header
 * for the token handling rules (fragment removed at once, memory only, header
 * only, never logged).
 *
 * @param options - `apiClient` or `client`; default the host's transport.
 * @returns `{ status, resolution, token, error, loading }`.
 * @throws Error when neither is given and no `PlatformHostProvider` is mounted.
 *
 * @example
 * ```tsx
 * const { status, resolution, token } = usePublicLink({ apiClient });
 * ```
 *
 * @stability experimental
 */
export function usePublicLink(options: UsePublicLinkOptions = {}): UsePublicLinkReturn {
  const hostApi = useOptionalPlatformHost()?.api;
  const api = options.apiClient ?? hostApi;
  const client = useMemo(() => {
    if (options.client) return options.client;
    if (!api) {
      throw new Error(
        'usePublicLink: no apiClient, no client and no PlatformHostProvider. Pass the app transport as `apiClient`.',
      );
    }
    return createSharingClient(api);
  }, [options.client, api]);

  // The token survives a StrictMode effect re-run in this ref: the second run
  // finds the fragment already gone and reuses it.
  const tokenRef = useRef<string | null>(null);
  const [state, setState] = useState<Omit<UsePublicLinkReturn, 'loading'>>({
    status: 'loading',
    resolution: null,
    token: null,
    error: null,
  });

  useEffect(() => {
    let controller: AbortController | null = null;

    const capture = (): boolean => {
      const hash = window.location.hash;
      if (hash === '' || hash === '#') return false;
      clearHash();
      tokenRef.current = parseLinkTokenFromHash(hash);
      return true;
    };

    const resolve = () => {
      controller?.abort();
      const current = new AbortController();
      controller = current;
      const token = tokenRef.current;
      if (token === null) {
        setState({ status: 'unavailable', resolution: null, token: null, error: NO_TOKEN });
        return;
      }
      setState({ status: 'loading', resolution: null, token, error: null });
      client.resolvePublicLink(token, { signal: current.signal }).then(
        (resolution) => {
          if (!current.signal.aborted) setState({ status: 'ready', resolution, token, error: null });
        },
        (err: unknown) => {
          if (!current.signal.aborted) {
            setState({ status: 'unavailable', resolution: null, token, error: toSharingError(err, NO_TOKEN.message) });
          }
        },
      );
    };

    capture();
    resolve();

    // A second link pasted into the same tab changes only the fragment.
    const onHashChange = () => {
      if (capture()) resolve();
    };
    window.addEventListener('hashchange', onHashChange);
    return () => {
      window.removeEventListener('hashchange', onHashChange);
      controller?.abort();
    };
  }, [client]);

  return { ...state, loading: state.status === 'loading' };
}
