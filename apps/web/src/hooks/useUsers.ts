/**
 * Packaged (#727, PP-6.6): `useUsers` lives in
 * `@marinoscar/platform-web/identity/headless`. This binding runs it over the
 * app's identity client (`platform/identityAdapters.ts`) so it works with or
 * without the identity adapters provider; it goes away when the imports point
 * at the package directly (PP-6.6 part 5).
 */
import { useUsers as platformUseUsers } from '@marinoscar/platform-web/identity/headless';
import type { UseUsersReturn } from '@marinoscar/platform-web/identity/headless';
import { appIdentityApi } from '../platform/identityAdapters';

export function useUsers(): UseUsersReturn {
  return platformUseUsers(appIdentityApi);
}
