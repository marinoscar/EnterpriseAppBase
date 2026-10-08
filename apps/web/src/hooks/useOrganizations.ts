/**
 * Packaged (#727, PP-6.6): `useOrganizations` lives in
 * `@marinoscar/platform-web/identity/headless`. This binding runs it over the
 * app's identity client (`platform/identityAdapters.ts`) so it works with or
 * without the identity adapters provider; it goes away when the imports point
 * at the package directly (PP-6.6 part 5).
 */
import { useOrganizations as platformUseOrganizations } from '@marinoscar/platform-web/identity/headless';
import type { UseOrganizationsReturn } from '@marinoscar/platform-web/identity/headless';
import { appIdentityApi } from '../platform/identityAdapters';

export function useOrganizations(): UseOrganizationsReturn {
  return platformUseOrganizations(appIdentityApi);
}
