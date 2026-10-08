// =============================================================================
// The auth context (issue #727, PP-6.6)
// =============================================================================
//
// Moved from the reference app's `contexts/AuthContext.tsx`. The session lives
// in the app's HTTP client (`client` prop: the access-token holder and its
// refresh); this provider asks it on boot whether a session exists, reads
// `GET /auth/me`, and exposes the user, the providers and the actions. What is
// app-specific is a prop: the work to do before signing out (the reference
// app drops this device's push subscription) and the login and callback paths.
//
// The browser only carries the API's answers: `switchOrg` asks the API for a
// token bound to another organization, and permissions follow the new
// `/auth/me`. Nothing here decides access.
// =============================================================================

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import type {
  AuthContextValue,
  AuthProviderInfo,
  AuthSessionClient,
  AuthUser,
  LoginOptions,
  OrgMembershipSummary,
} from './types.js';

/** What `POST /api/auth/switch-org` returns (the same shape as a refresh). */
interface SwitchOrgResponse {
  accessToken: string;
  expiresIn: number;
}

const NO_MEMBERSHIPS: OrgMembershipSummary[] = [];

/**
 * The auth context object. Read it with {@link useAuth}; a test or a custom
 * shell may provide a value directly (`<AuthContext.Provider value={...}>`).
 * `null` outside an {@link AuthProvider}.
 *
 * @stability stable
 */
export const AuthContext = createContext<AuthContextValue | null>(null);
AuthContext.displayName = 'AuthContext';

/**
 * What {@link AuthProvider} takes.
 *
 * @stability stable
 */
export interface AuthProviderProps {
  /** The app's HTTP client (a `PlatformHttpClient`); keep its identity stable. */
  client: AuthSessionClient;
  /**
   * Work to finish while the access token is still valid, before
   * `POST /auth/logout` (the reference app drops this device's push
   * subscription). Should not throw; an error is logged and sign-out continues.
   */
  onBeforeLogout?: () => Promise<unknown>;
  /**
   * The login route, where sign-out lands.
   *
   * @defaultValue `'/login'`
   */
  loginPath?: string;
  /**
   * The sign-in callback route: the boot-time session probe is skipped there
   * (the callback page sets the token from the URL).
   *
   * @defaultValue `'/auth/callback'`
   */
  callbackPath?: string;
  /** The routed tree. */
  children: ReactNode;
}

/**
 * Holds the session for everything below it: probes for an existing session
 * on mount (one refresh from the HttpOnly cookie), reads the user, lists the
 * sign-in providers, and clears the session when the client reports that the
 * server refused to refresh it. Mount it once, inside the router.
 *
 * @param props - see {@link AuthProviderProps}.
 * @returns the provider element.
 *
 * @example
 * ```tsx
 * <AuthProvider client={api} onBeforeLogout={removePushSubscription}>
 *   <AppRoutes />
 * </AuthProvider>
 * ```
 *
 * @extensionPoint component
 * @stability stable
 */
export function AuthProvider({
  client,
  onBeforeLogout,
  loginPath = '/login',
  callbackPath = '/auth/callback',
  children,
}: AuthProviderProps): ReactElement {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [providers, setProviders] = useState<AuthProviderInfo[]>([]);
  const [sessionExpired, setSessionExpired] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const initRef = useRef(false);

  // Fetch auth providers on mount
  useEffect(() => {
    const fetchProviders = async () => {
      try {
        const response = await client.get<{ providers: AuthProviderInfo[] }>('/auth/providers', {
          skipAuth: true,
        });
        setProviders(response.providers);
      } catch (error) {
        console.error('Failed to fetch auth providers:', error);
      }
    };
    void fetchProviders();
  }, [client]);

  // When a refresh the client attempted while holding an access token is
  // refused (401/403), the session is gone for good: clear it so `RequireAuth`
  // sends the user to the login page (with `from`, so they come back) instead
  // of every widget rendering its own "Unauthorized". The client only fires
  // this for a page that HELD a token, so the boot-time probe on the login
  // page or a public page never triggers it, and once the token is cleared
  // here it cannot fire again until the next sign-in: no loop.
  useEffect(() => {
    return client.onSessionExpired(() => {
      client.setAccessToken(null);
      setUser(null);
      setSessionExpired(true);
    });
  }, [client]);

  const fetchUser = useCallback(async () => {
    try {
      const userData = await client.get<AuthUser>('/auth/me');
      setUser(userData);
      setSessionExpired(false);
    } catch (error) {
      if (isUnauthorized(error)) {
        setUser(null);
        client.setAccessToken(null);
      }
      throw error;
    }
  }, [client]);

  // Check for an existing session on mount (runs only once)
  useEffect(() => {
    // Skip if already initialized or on the auth callback page
    // (the callback page sets the token directly from URL params)
    if (initRef.current || location.pathname === callbackPath) {
      setIsLoading(false);
      return;
    }
    initRef.current = true;

    const initAuth = async () => {
      try {
        // Try to refresh the token (uses the httpOnly cookie)
        const refreshed = await client.refreshToken();
        if (refreshed) {
          await fetchUser();
        }
      } catch (error) {
        console.error('Auth initialization failed:', error);
      } finally {
        setIsLoading(false);
      }
    };
    void initAuth();
    // `fetchUser` and `client` are stable for a stable client; the probe runs once.
  }, [location.pathname]);

  const login = useCallback(
    (provider: string, options?: LoginOptions) => {
      // Store the return URL for the redirect after login (including query params)
      const fromLocation = (location.state as { from?: { pathname: string; search?: string } } | null)?.from;
      if (fromLocation) {
        sessionStorage.setItem('auth_return_url', `${fromLocation.pathname}${fromLocation.search || ''}`);
      } else if (location.pathname !== callbackPath || sessionStorage.getItem('auth_return_url') === null) {
        sessionStorage.setItem('auth_return_url', '/');
      }
      // else: retrying from the sign-in error screen (the callback route),
      // which carries no `from` state. Keep the return URL stored by the
      // original attempt instead of resetting it to '/'.

      // Redirect to the OAuth provider
      const query = options?.selectAccount ? '?select_account=1' : '';
      window.location.href = `/api/auth/${provider}${query}`;
    },
    [location.state, location.pathname, callbackPath],
  );

  const logout = useCallback(async () => {
    try {
      // Finish what needs the access token (the reference app drops this
      // device's push subscription) while it is still valid.
      if (onBeforeLogout) await onBeforeLogout();
      await client.post('/auth/logout');
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      setUser(null);
      setSessionExpired(false);
      client.setAccessToken(null);
      navigate(loginPath);
    }
  }, [client, navigate, onBeforeLogout, loginPath]);

  const refreshUser = useCallback(async () => {
    await fetchUser();
  }, [fetchUser]);

  const setAccessToken = useCallback((token: string | null) => client.setAccessToken(token), [client]);

  const switchOrg = useCallback(
    async (orgId: string) => {
      // The API decides whether the caller may act in `orgId`; the browser
      // only carries the answer (a new token bound to it) and re-reads `me`.
      const tokens = await client.post<SwitchOrgResponse>('/auth/switch-org', { orgId });
      client.setAccessToken(tokens.accessToken);
      await fetchUser();
    },
    [client, fetchUser],
  );

  const value: AuthContextValue = {
    user,
    isLoading,
    isAuthenticated: !!user,
    providers,
    sessionExpired,
    login,
    logout,
    refreshUser,
    setAccessToken,
    activeOrg: user?.activeOrg ?? null,
    memberships: user?.memberships ?? NO_MEMBERSHIPS,
    switchOrg,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** A 401 from the API, from any client whose errors carry a numeric `status`. */
function isUnauthorized(error: unknown): boolean {
  return (
    error !== null && typeof error === 'object' && (error as { status?: unknown }).status === 401
  );
}

/**
 * The auth context.
 *
 * @returns the session, the providers and the actions.
 * @throws Error outside an {@link AuthProvider}.
 *
 * @extensionPoint hook
 * @stability stable
 */
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

/**
 * The auth context, or `null` outside an {@link AuthProvider}. For chrome that
 * must render (and fail closed) without one.
 *
 * @returns the context value, or `null`.
 *
 * @stability stable
 */
export function useOptionalAuth(): AuthContextValue | null {
  return useContext(AuthContext);
}
