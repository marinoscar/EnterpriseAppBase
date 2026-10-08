/**
 * The auth context, now packaged (#727, PP-6.6): `AuthProvider`, `useAuth`
 * and `AuthContext` live in `@marinoscar/platform-web/identity/headless`.
 *
 * This module is a compatibility shim so existing imports keep working until
 * they point at the package directly (PP-6.6 part 5). Its `AuthProvider` is
 * the package's, bound to this app's transport (`services/api.ts`) and to the
 * push-subscription clean-up that must run while the access token is still
 * valid (#365); `App.tsx` mounts the package's provider with the same props.
 */
import type { ReactElement, ReactNode } from 'react';
import { AuthProvider as PlatformAuthProvider } from '@marinoscar/platform-web/identity/headless';
import { api } from '../services/api';
import { removePushSubscription } from '../services/pushSubscription';

export { AuthContext, useAuth } from '@marinoscar/platform-web/identity/headless';
export type { AuthContextValue, LoginOptions } from '@marinoscar/platform-web/identity/headless';

interface AuthProviderProps {
  children: ReactNode;
}

/** The package's `AuthProvider`, bound to this app's transport and logout clean-up. */
export function AuthProvider({ children }: AuthProviderProps): ReactElement {
  return (
    <PlatformAuthProvider client={api} onBeforeLogout={removePushSubscription}>
      {children}
    </PlatformAuthProvider>
  );
}
