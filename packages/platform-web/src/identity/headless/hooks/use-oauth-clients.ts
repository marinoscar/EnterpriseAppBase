// The admin "OAuth clients" page's data (PP-15.7, #1185): the client list and
// its writes (`/api/admin/oauth/clients`), the refused hosts, and the
// `oauthServer` settings namespace (`/api/system-settings`).

import type { OAuthClientView, OAuthClientWithSecret } from '@marinoscar/platform-contract/identity';
import { useCallback, useEffect, useRef, useState } from 'react';

import { isPlatformApiError } from '../../../core/index.js';
import { useIsMounted } from '../../internal/use-is-mounted.js';
import { useOAuthServerApi } from '../adapters.js';
import type { OAuthClientCreateInput, OAuthRefusedHost, OAuthServerApi, OAuthServerSettings } from '../oauth-api.js';

const messageOf = (error: unknown, fallback: string): string =>
  isPlatformApiError(error) || error instanceof Error ? error.message || fallback : fallback;

/**
 * What {@link useOAuthClients} returns.
 *
 * @stability experimental
 */
export interface UseOAuthClientsReturn {
  /** The current page of clients (never a secret). */
  clients: OAuthClientView[];
  /** Clients across all pages. */
  total: number;
  /** The page, 1-based. */
  page: number;
  /** The page size. */
  pageSize: number;
  /** The name-or-host search. */
  search: string;
  /** A list request is in flight. */
  isLoading: boolean;
  /** The last failure's message, or `null`. */
  error: string | null;
  /** Change the page or its size. */
  setPagination: (next: { page: number; pageSize: number }) => void;
  /** Change the search (back to page 1). */
  setSearch: (search: string) => void;
  /** Re-read the page. Never rejects. */
  refresh: () => Promise<void>;
  /** Pre-register a client; the answer carries its secret once. Rethrows. */
  createClient: (input: OAuthClientCreateInput) => Promise<OAuthClientWithSecret>;
  /** Disable (revokes its grants) or re-enable a client. Rethrows. */
  setDisabled: (id: string, disabled: boolean) => Promise<void>;
  /** A new secret, once; the old one stops working at once. Rethrows. */
  rotateSecret: (id: string) => Promise<OAuthClientWithSecret>;
  /** Delete a client with its grants and tokens. Rethrows. */
  deleteClient: (id: string) => Promise<void>;
}

/**
 * The admin list of OAuth clients and its writes. Reads need
 * `oauth_clients:read`, writes `oauth_clients:write`; the API enforces both.
 *
 * @param api - the OAuth client; default {@link useOAuthServerApi}'s.
 * @returns see {@link UseOAuthClientsReturn}.
 *
 * @extensionPoint hook
 * @stability experimental
 */
export function useOAuthClients(api?: OAuthServerApi): UseOAuthClientsReturn {
  const oauth = useOAuthServerApi(api);
  const isMounted = useIsMounted();
  const [clients, setClients] = useState<OAuthClientView[]>([]);
  const [total, setTotal] = useState(0);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 20 });
  const [search, setSearchState] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestSeq = useRef(0);

  const refresh = useCallback(async () => {
    const seq = ++requestSeq.current;
    setIsLoading(true);
    setError(null);
    try {
      const result = await oauth.listClients({
        page: pagination.page,
        pageSize: pagination.pageSize,
        ...(search ? { search } : {}),
      });
      if (isMounted() && seq === requestSeq.current) {
        setClients(result.items);
        setTotal(result.total);
      }
    } catch (err) {
      if (isMounted() && seq === requestSeq.current) setError(messageOf(err, 'Could not load the OAuth clients.'));
    } finally {
      if (isMounted() && seq === requestSeq.current) setIsLoading(false);
    }
  }, [oauth, pagination.page, pagination.pageSize, search, isMounted]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const write = useCallback(
    async <T>(call: () => Promise<T>, fallback: string): Promise<T> => {
      setError(null);
      try {
        const result = await call();
        await refresh();
        return result;
      } catch (err) {
        if (isMounted()) setError(messageOf(err, fallback));
        throw err;
      }
    },
    [refresh, isMounted],
  );

  const createClient = useCallback(
    (input: OAuthClientCreateInput) => write(() => oauth.createClient(input), 'Could not add the client.'),
    [oauth, write],
  );
  const setDisabled = useCallback(
    async (id: string, disabled: boolean) => {
      await write(() => oauth.setClientDisabled(id, disabled), 'Could not change the client.');
    },
    [oauth, write],
  );
  const rotateSecret = useCallback(
    (id: string) => write(() => oauth.rotateClientSecret(id), 'Could not rotate the secret.'),
    [oauth, write],
  );
  const deleteClient = useCallback(
    async (id: string) => {
      await write(() => oauth.deleteClient(id), 'Could not delete the client.');
    },
    [oauth, write],
  );
  const setSearch = useCallback((next: string) => {
    setSearchState(next);
    setPagination((current) => ({ ...current, page: 1 }));
  }, []);

  return {
    clients,
    total,
    page: pagination.page,
    pageSize: pagination.pageSize,
    search,
    isLoading,
    error,
    setPagination,
    setSearch,
    refresh,
    createClient,
    setDisabled,
    rotateSecret,
    deleteClient,
  };
}

/**
 * What {@link useOAuthRefusedHosts} returns.
 *
 * @stability experimental
 */
export interface UseOAuthRefusedHostsReturn {
  /** The refused hosts, most recent first. */
  hosts: OAuthRefusedHost[];
  /** A request is in flight. */
  isLoading: boolean;
  /** `false` when the API has no refused-hosts route (it answered `404`). */
  available: boolean;
  /** The last failure's message, or `null`. */
  error: string | null;
  /** Re-read. Never rejects. */
  refresh: () => Promise<void>;
}

/**
 * The client hosts the trust policy turned away in the last 30 days.
 *
 * @param api - the OAuth client; default {@link useOAuthServerApi}'s.
 * @returns see {@link UseOAuthRefusedHostsReturn}.
 *
 * @extensionPoint hook
 * @stability experimental
 */
export function useOAuthRefusedHosts(api?: OAuthServerApi): UseOAuthRefusedHostsReturn {
  const oauth = useOAuthServerApi(api);
  const isMounted = useIsMounted();
  const [hosts, setHosts] = useState<OAuthRefusedHost[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [available, setAvailable] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await oauth.listRefusedHosts();
      if (isMounted()) {
        setHosts([...result].sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt)));
        setAvailable(true);
      }
    } catch (err) {
      if (!isMounted()) return;
      setHosts([]);
      if (isPlatformApiError(err) && err.status === 404) setAvailable(false);
      else setError(messageOf(err, 'Could not load the refused attempts.'));
    } finally {
      if (isMounted()) setIsLoading(false);
    }
  }, [oauth, isMounted]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { hosts, isLoading, available, error, refresh };
}

/**
 * What {@link useOAuthServerSettings} returns.
 *
 * @stability experimental
 */
export interface UseOAuthServerSettingsReturn {
  /** The `oauthServer` namespace, or `null` until loaded (or when the load failed). */
  settings: OAuthServerSettings | null;
  /** The first load is in flight. */
  isLoading: boolean;
  /** A save is in flight. */
  isSaving: boolean;
  /** The last failure's message, or `null`. */
  error: string | null;
  /** Save some fields (`If-Match` on the loaded version; a `409` reloads and rejects). Rethrows. */
  update: (patch: Partial<OAuthServerSettings>) => Promise<void>;
  /** Reload. Never rejects. */
  refresh: () => Promise<void>;
}

/**
 * The `oauthServer` system-settings namespace: the switch, the client trust
 * policy and the token lifetimes. Reading needs `system_settings:read`, saving
 * `system_settings:write` (the `/api/system-settings` controller).
 *
 * @param api - the OAuth client; default {@link useOAuthServerApi}'s.
 * @returns see {@link UseOAuthServerSettingsReturn}.
 *
 * @extensionPoint hook
 * @stability experimental
 */
export function useOAuthServerSettings(api?: OAuthServerApi): UseOAuthServerSettingsReturn {
  const oauth = useOAuthServerApi(api);
  const isMounted = useIsMounted();
  const [settings, setSettings] = useState<OAuthServerSettings | null>(null);
  const [version, setVersion] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await oauth.getServerSettings();
      if (isMounted()) {
        setSettings(result.settings);
        setVersion(result.version);
      }
    } catch (err) {
      if (isMounted()) {
        setError(
          isPlatformApiError(err) && err.status === 403
            ? 'You do not have permission to view the OAuth server settings.'
            : messageOf(err, 'Could not load the OAuth server settings.'),
        );
      }
    } finally {
      if (isMounted()) setIsLoading(false);
    }
  }, [oauth, isMounted]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const update = useCallback(
    async (patch: Partial<OAuthServerSettings>) => {
      if (version === null) return;
      setIsSaving(true);
      setError(null);
      try {
        const result = await oauth.updateServerSettings(patch, version);
        if (isMounted()) {
          setSettings(result.settings);
          setVersion(result.version);
        }
      } catch (err) {
        if (isPlatformApiError(err) && err.status === 409) {
          await refresh();
          if (isMounted()) setError('The settings were changed elsewhere. Review them and try again.');
        } else if (isMounted()) {
          setError(messageOf(err, 'Could not save the OAuth server settings.'));
        }
        throw err;
      } finally {
        if (isMounted()) setIsSaving(false);
      }
    },
    [oauth, version, refresh, isMounted],
  );

  return { settings, isLoading, isSaving, error, update, refresh };
}
