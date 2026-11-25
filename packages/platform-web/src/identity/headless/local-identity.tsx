// =============================================================================
// Local identity (a host with no API session, e.g. a desktop shell)
// =============================================================================
//
// A local host has one user, known at start-up, with a fixed permission set.
// `LocalIdentityProvider` provides an `AuthContext` value for it
// (`mode: 'local'`) so the shell's chrome (`usePermissions`, the user menu) works
// unchanged. Nothing here calls the network; every session verb is a no-op.
// =============================================================================

import { useMemo } from 'react';
import type { ReactElement, ReactNode } from 'react';

import { AuthContext } from './auth-context.js';
import type { AuthContextValue, AuthUser } from './types.js';

/**
 * The one local user a {@link LocalIdentityProvider} presents.
 *
 * @stability experimental
 */
export interface LocalIdentityInput {
  /** The local user's id. */
  userId: string;
  /**
   * The name the user menu shows.
   *
   * @defaultValue `'You'`
   */
  displayName?: string;
  /** The email, or `null`/absent for none (shown as an empty string). */
  email?: string | null;
  /** The permissions the local user holds (the exact strings a destination or card names). */
  permissions: readonly string[];
  /** The role names the local user holds. */
  roles?: readonly string[];
}

const noop = (): void => undefined;
const resolved = (): Promise<void> => Promise.resolve();

/**
 * Builds the {@link AuthContextValue} of a local, always-signed-in user:
 * `isAuthenticated` is `true`, there are no sign-in providers, `mode` is
 * `'local'`, and `login`, `logout`, `refreshUser`, `switchOrg` and
 * `setAccessToken` do nothing.
 *
 * @param input - see {@link LocalIdentityInput}.
 * @returns the context value; give it a stable identity (memoize) when passing it to `AuthContext.Provider`.
 *
 * @stability experimental
 */
export function createLocalAuthContextValue(input: LocalIdentityInput): AuthContextValue {
  const user: AuthUser = {
    id: input.userId,
    email: input.email ?? '',
    displayName: input.displayName ?? 'You',
    profileImageUrl: null,
    roles: (input.roles ?? []).map((name) => ({ name })),
    permissions: [...input.permissions],
    isActive: true,
    createdAt: new Date(0).toISOString(),
  };
  return {
    user,
    isLoading: false,
    isAuthenticated: true,
    providers: [],
    sessionExpired: false,
    login: noop,
    logout: resolved,
    refreshUser: resolved,
    setAccessToken: noop,
    activeOrg: null,
    memberships: [],
    switchOrg: resolved,
    mode: 'local',
  };
}

/**
 * Props of {@link LocalIdentityProvider}: a {@link LocalIdentityInput} and the tree.
 *
 * @stability experimental
 */
export type LocalIdentityProviderProps = LocalIdentityInput & {
  /** The tree. */
  children: ReactNode;
};

/**
 * Provides a local, always-signed-in user as the auth context. For a host with
 * no API session; mount it where an `AuthProvider` would go.
 *
 * @param props - see {@link LocalIdentityProviderProps}.
 * @returns the provider element.
 *
 * @example
 * ```tsx
 * <LocalIdentityProvider userId="local" permissions={['notes:read', 'notes:write']}>
 *   <ShellLayout navigation={navigation} />
 * </LocalIdentityProvider>
 * ```
 *
 * @extensionPoint component
 * @stability experimental
 */
export function LocalIdentityProvider({
  children,
  userId,
  displayName,
  email,
  permissions,
  roles,
}: LocalIdentityProviderProps): ReactElement {
  const permissionKey = permissions.join('\u0000');
  const roleKey = (roles ?? []).join('\u0000');
  const value = useMemo(
    () =>
      createLocalAuthContextValue({
        userId,
        ...(displayName === undefined ? {} : { displayName }),
        ...(email === undefined ? {} : { email }),
        permissions,
        ...(roles === undefined ? {} : { roles }),
      }),
    // The arrays are compared by content so an inline literal does not rebuild the value every render.
    [userId, displayName, email, permissionKey, roleKey],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
