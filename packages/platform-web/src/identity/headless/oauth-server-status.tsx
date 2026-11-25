// =============================================================================
// Is the OAuth server on? (PP-15.7, #1185)
// =============================================================================
//
// The `oauthServer` settings feature: the "Connected apps" card exists only
// while the deployment's OAuth server is on. The probe is the authorization
// server metadata document, `GET /api/oauth/.well-known/authorization-server`:
// public, cheap, `200` while the server is on and `404` while it is off (or not
// mounted at all), so EVERY signed-in user can ask, not only an administrator
// who may read the `oauthServer` system settings. It also carries the issuer
// the admin page shows.
//
// ONE fetch per signed-in user, in a provider the app mounts around its shell
// (the AI config provider is the model), so the hubs, the rail and the AppBar
// title resolver read the same answer and `registerSettingsFeature`'s resolver
// never fetches. Fail closed: until the probe answers, and on any error, the
// feature is off.
// =============================================================================

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';

import { AuthContext } from './auth-context.js';
import { useOAuthServerApi } from './adapters.js';
import type { OAuthServerApi } from './oauth-api.js';
import { useIsMounted } from '../internal/use-is-mounted.js';

/**
 * What {@link useOAuthServerStatus} returns.
 *
 * @stability experimental
 */
export interface OAuthServerStatus {
  /** `true` on, `false` off (or the probe failed), `null` while the first probe runs. */
  enabled: boolean | null;
  /** The issuer from the metadata document while the server is on, else `null`. */
  issuer: string | null;
  /** Probe again (after an administrator switched the server). Never rejects. */
  refresh: () => Promise<void>;
}

const OFF: OAuthServerStatus = Object.freeze({ enabled: false, issuer: null, refresh: async () => undefined });

const OAuthServerStatusContext = createContext<OAuthServerStatus | null>(null);
OAuthServerStatusContext.displayName = 'OAuthServerStatusContext';

/**
 * Probes once per signed-in user whether the OAuth server is on, and hands the
 * answer to {@link useOAuthServerStatus} and {@link useOAuthServerFeature} below
 * it. Mount it once, inside the auth provider, around the signed-in shell.
 *
 * @param props - `api`: the OAuth client (default {@link useOAuthServerApi}'s); `children`: the tree.
 * @returns the provider element.
 *
 * @example
 * ```tsx
 * <OAuthServerStatusProvider api={createOAuthServerApi(appPlatformApi)}>{shell}</OAuthServerStatusProvider>
 * ```
 *
 * @extensionPoint component
 * @stability experimental
 */
export function OAuthServerStatusProvider(props: { api?: OAuthServerApi; children: ReactNode }): ReactElement {
  const oauth = useOAuthServerApi(props.api);
  const userId = useContext(AuthContext)?.user?.id ?? null;
  const [state, setState] = useState<{ enabled: boolean | null; issuer: string | null }>({ enabled: null, issuer: null });
  const isMounted = useIsMounted();

  const probe = useCallback(async () => {
    if (userId === null) {
      if (isMounted()) setState({ enabled: false, issuer: null });
      return;
    }
    try {
      const metadata = await oauth.getServerMetadata();
      const issuer = typeof metadata?.issuer === 'string' ? metadata.issuer : null;
      if (isMounted()) setState({ enabled: true, issuer });
    } catch {
      if (isMounted()) setState({ enabled: false, issuer: null });
    }
  }, [oauth, userId, isMounted]);

  useEffect(() => {
    void probe();
  }, [probe]);

  const value = useMemo<OAuthServerStatus>(() => ({ ...state, refresh: probe }), [state, probe]);
  return <OAuthServerStatusContext.Provider value={value}>{props.children}</OAuthServerStatusContext.Provider>;
}

/**
 * The OAuth server's status from {@link OAuthServerStatusProvider}. Without a
 * provider: off (fail closed), and `refresh` does nothing.
 *
 * @returns the status.
 *
 * @stability experimental
 */
export function useOAuthServerStatus(): OAuthServerStatus {
  return useContext(OAuthServerStatusContext) ?? OFF;
}

/**
 * Whether the OAuth server is on: the resolver of the `oauthServer` settings
 * feature. Reads the provider only, never fetches; `false` until the probe
 * answered `200`.
 *
 * @returns `true` while the server is on.
 *
 * @example
 * ```ts
 * registerSettingsFeature('oauthServer', useOAuthServerFeature);
 * ```
 *
 * @extensionPoint hook
 * @stability experimental
 */
export function useOAuthServerFeature(): boolean {
  return useOAuthServerStatus().enabled === true;
}
