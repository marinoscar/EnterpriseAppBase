// `UserTimeZoneSync`: loads the signed-in user's `profile.timezone` once per
// sign-in and puts it in the display-zone store; clears it when the auth
// context reports nobody signed in. It reads `/user-settings` through the
// platform transport itself rather than through the settings slice's
// `useUserSettings`: the settings slice depends on this one (its profile card
// draws `TimeZoneField`, its hook pushes saves into the store), and the slice
// graph is acyclic.

import { useEffect } from 'react';
import type { ReactNode } from 'react';

import { useOptionalPlatformHost } from '../../core/index.js';
import type { PlatformApiClient } from '../../core/index.js';
import { useOptionalAuth } from '../../identity/index.js';
import { setPreferredTimeZone, timeZoneFromProfile } from './store.js';

/**
 * Props of {@link UserTimeZoneSync}.
 *
 * @stability experimental
 */
export interface UserTimeZoneSyncProps {
  /**
   * The transport. Default: the `PlatformHostProvider`'s. Pass the app's own
   * to mount the sync above the host (keep its identity stable).
   */
  api?: PlatformApiClient;
  /** Rendered as is, so the sync can sit in a provider list (`ShellProviders`). */
  children?: ReactNode;
}

/**
 * Keeps the display zone on the signed-in user's choice: one
 * `GET /user-settings` per signed-in user, then `setPreferredTimeZone(profile.timezone ?? null)`.
 * Inside an `AuthProvider`, a settled session with nobody signed in resets the
 * choice (sign-out on a shared device). A failed load (no API in a local host,
 * a viewer without `user_settings:read`) changes nothing. Renders its children.
 *
 * @param props - see {@link UserTimeZoneSyncProps}.
 * @returns the children.
 *
 * @example
 * ```tsx
 * <AuthProvider client={api}>
 *   <UserTimeZoneSync api={platformApi} />
 *   <AppRoutes />
 * </AuthProvider>
 * ```
 *
 * @extensionPoint component
 * @stability experimental
 */
export function UserTimeZoneSync({ api: apiProp, children }: UserTimeZoneSyncProps) {
  const host = useOptionalPlatformHost();
  const api = apiProp ?? host?.api;
  const auth = useOptionalAuth();
  const hasAuth = auth !== null;
  const settled = !auth?.isLoading;
  const userId = auth?.user?.id ?? null;

  useEffect(() => {
    if (!settled) return;
    if (hasAuth && userId === null) {
      setPreferredTimeZone(null);
      return;
    }
    if (!api) return;
    let cancelled = false;
    api
      .get<{ profile?: unknown }>('/user-settings')
      .then((document) => {
        if (!cancelled) setPreferredTimeZone(timeZoneFromProfile(document?.profile));
      })
      .catch(() => {
        // Keep whatever is cached; the device's zone is the fallback anyway.
      });
    return () => {
      cancelled = true;
    };
  }, [api, hasAuth, settled, userId]);

  return <>{children}</>;
}
