// The organization AI keys hook (issue #739): `/api/admin/ai/org-keys`, the
// active organization's own provider keys. Write-only: the hook never holds a
// stored key, only the masked views the API answers with; a key typed into
// `set` is sent once and dropped.

import type { OrgAiKeyView } from '@marinoscar/platform-contract/ai';
import { useCallback, useEffect, useRef, useState } from 'react';

import { isPlatformApiError, useOptionalPlatformHost } from '../../core/index.js';
import type { PlatformApiClient } from '../../core/index.js';

/**
 * Options of {@link useOrgAiKeys}.
 *
 * @stability experimental
 */
export interface UseOrgAiKeysOptions {
  /** The transport. Default: the `PlatformHostProvider`'s (keep its identity stable). */
  api?: PlatformApiClient;
}

/**
 * What {@link useOrgAiKeys} returns.
 *
 * @stability experimental
 */
export interface UseOrgAiKeysResult {
  /** One masked entry per registered provider, or `null` before the first load. */
  keys: OrgAiKeyView[] | null;
  /** The last load or write failure, as a sentence the page renders. */
  error: string | null;
  /** True while the first load runs. */
  isLoading: boolean;
  /** The provider whose key is being set or removed, if any. */
  pendingProvider: string | null;
  /** Reloads the list. */
  refresh: () => Promise<void>;
  /**
   * Verifies, then stores the organization's key for `provider`. Resolves
   * `true` when stored; `false` (with `error` set) when refused.
   */
  set: (provider: string, apiKey: string) => Promise<boolean>;
  /** Removes the organization's key for `provider`. Resolves `true` when done. */
  remove: (provider: string) => Promise<boolean>;
}

const BASE = '/admin/ai/org-keys';

function messageOf(error: unknown): string {
  if (isPlatformApiError(error)) {
    const reason = (error.details as { reason?: unknown } | undefined)?.reason;
    if (reason === 'AI_KEY_INVALID') return 'The provider rejected this key. Nothing was saved.';
    return error.message;
  }
  return error instanceof Error ? error.message : 'Something went wrong.';
}

/**
 * The active organization's own AI provider keys, masked, with set and
 * remove. The organization is the caller's ACTIVE one (the API decides it
 * from the session, never from this hook).
 *
 * @param options - the transport.
 * @returns the keys, the state and the actions.
 *
 * @stability experimental
 */
export function useOrgAiKeys(options: UseOrgAiKeysOptions = {}): UseOrgAiKeysResult {
  const host = useOptionalPlatformHost();
  const api = options.api ?? host?.api;
  const [keys, setKeys] = useState<OrgAiKeyView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [pendingProvider, setPendingProvider] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!api) {
      setError('No platform transport is available.');
      setIsLoading(false);
      return;
    }
    try {
      const next = await api.get<OrgAiKeyView[]>(BASE);
      if (!mounted.current) return;
      setKeys(next);
      setError(null);
    } catch (err) {
      if (mounted.current) setError(messageOf(err));
    } finally {
      if (mounted.current) setIsLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const set = useCallback(
    async (provider: string, apiKey: string) => {
      if (!api) return false;
      setPendingProvider(provider);
      try {
        const view = await api.put<OrgAiKeyView>(`${BASE}/${encodeURIComponent(provider)}`, { apiKey });
        if (!mounted.current) return true;
        setKeys((current) => (current ?? []).map((entry) => (entry.provider === provider ? view : entry)));
        setError(null);
        return true;
      } catch (err) {
        if (mounted.current) setError(messageOf(err));
        return false;
      } finally {
        if (mounted.current) setPendingProvider(null);
      }
    },
    [api],
  );

  const remove = useCallback(
    async (provider: string) => {
      if (!api) return false;
      setPendingProvider(provider);
      try {
        await api.delete<void>(`${BASE}/${encodeURIComponent(provider)}`);
        if (!mounted.current) return true;
        setKeys((current) =>
          (current ?? []).map((entry) =>
            entry.provider === provider ? { ...entry, configured: false, hint: null, verifiedAt: null } : entry,
          ),
        );
        setError(null);
        return true;
      } catch (err) {
        if (mounted.current) setError(messageOf(err));
        return false;
      } finally {
        if (mounted.current) setPendingProvider(null);
      }
    },
    [api],
  );

  return { keys, error, isLoading, pendingProvider, refresh, set, remove };
}
