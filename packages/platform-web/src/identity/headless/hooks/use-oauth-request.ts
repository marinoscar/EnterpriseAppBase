// The consent page's data and its two decisions (PP-15.7, #1185;
// docs/specs/oauth-server.md §2.8 and §2.19).

import type { OAuthConsentRequest } from '@marinoscar/platform-contract/identity';
import { useCallback, useEffect, useState } from 'react';

import { isPlatformApiError } from '../../../core/index.js';
import { useIsMounted } from '../../internal/use-is-mounted.js';
import { useOAuthServerApi } from '../adapters.js';
import type { OAuthServerApi } from '../oauth-api.js';

/**
 * Where the consent request stands.
 *
 * - `loading`: the first read is in flight.
 * - `ready`: `request` holds what to show.
 * - `expired`: `404` or `410`, on the read or on the decision (unknown, another
 *   user's, already decided, past its 10 minutes, or the server is off).
 * - `error`: anything else; `error` holds the message.
 *
 * @stability experimental
 */
export type OAuthRequestStatus = 'loading' | 'ready' | 'expired' | 'error';

/**
 * What {@link useOAuthRequest} returns.
 *
 * @stability experimental
 */
export interface UseOAuthRequestReturn {
  /** Where the request stands. */
  status: OAuthRequestStatus;
  /** The request while `status` is `ready`, else `null`. */
  request: OAuthConsentRequest | null;
  /** The last failure's message (a read or a decision), or `null`. */
  error: string | null;
  /** A decision is in flight. */
  isSubmitting: boolean;
  /**
   * Approve with exactly these scopes and, in multi-organization mode, this
   * organization. Resolves to the URL to navigate to, or `null` when the
   * request expired (`status` becomes `expired`) or failed (`error` is set).
   */
  approve: (scopes: string[], orgId?: string) => Promise<string | null>;
  /** Deny. Resolves like {@link UseOAuthRequestReturn.approve}. */
  deny: () => Promise<string | null>;
}

const isGone = (error: unknown): boolean => isPlatformApiError(error) && (error.status === 404 || error.status === 410);

const messageOf = (error: unknown, fallback: string): string =>
  isPlatformApiError(error) || error instanceof Error ? error.message || fallback : fallback;

/**
 * Reads the pending authorization request `id` (the opaque id from
 * `/oauth/consent?request=<id>`, the only thing the page takes from its URL)
 * and decides it. A `null` id is `expired` at once.
 *
 * @param id - the request id, or `null` when the URL carries none.
 * @param api - the OAuth client; default {@link useOAuthServerApi}'s.
 * @returns see {@link UseOAuthRequestReturn}.
 *
 * @extensionPoint hook
 * @stability experimental
 */
export function useOAuthRequest(id: string | null, api?: OAuthServerApi): UseOAuthRequestReturn {
  const oauth = useOAuthServerApi(api);
  const isMounted = useIsMounted();
  const [status, setStatus] = useState<OAuthRequestStatus>(id ? 'loading' : 'expired');
  const [request, setRequest] = useState<OAuthConsentRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!id) {
      setStatus('expired');
      setRequest(null);
      return;
    }
    let cancelled = false;
    setStatus('loading');
    setError(null);
    oauth.getRequest(id).then(
      (result) => {
        if (cancelled || !isMounted()) return;
        setRequest(result);
        setStatus('ready');
      },
      (err: unknown) => {
        if (cancelled || !isMounted()) return;
        setRequest(null);
        if (isGone(err)) {
          setStatus('expired');
        } else {
          setStatus('error');
          setError(messageOf(err, 'Could not load this request.'));
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [id, oauth, isMounted]);

  const decide = useCallback(
    async (call: () => Promise<{ redirectTo: string }>): Promise<string | null> => {
      setIsSubmitting(true);
      setError(null);
      try {
        const { redirectTo } = await call();
        return redirectTo;
      } catch (err) {
        if (isMounted()) {
          if (isGone(err)) {
            setStatus('expired');
            setRequest(null);
          } else {
            setError(messageOf(err, 'Could not send your decision. Try again.'));
          }
        }
        return null;
      } finally {
        if (isMounted()) setIsSubmitting(false);
      }
    },
    [isMounted],
  );

  const approve = useCallback(
    (scopes: string[], orgId?: string) =>
      id ? decide(() => oauth.approveRequest(id, orgId ? { scopes, orgId } : { scopes })) : Promise.resolve(null),
    [id, oauth, decide],
  );
  const deny = useCallback(() => (id ? decide(() => oauth.denyRequest(id)) : Promise.resolve(null)), [id, oauth, decide]);

  return { status, request, error, isSubmitting, approve, deny };
}
