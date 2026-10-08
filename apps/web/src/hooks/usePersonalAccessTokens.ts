/**
 * Packaged (#727, PP-6.6): `usePersonalAccessTokens` lives in
 * `@marinoscar/platform-web/identity/headless`. This binding runs it over the
 * app's identity client (`platform/identityAdapters.ts`) so it works with or
 * without the identity adapters provider; it goes away when the imports point
 * at the package directly (PP-6.6 part 5).
 */
import { usePersonalAccessTokens as platformUsePersonalAccessTokens } from '@marinoscar/platform-web/identity/headless';
import type { UsePersonalAccessTokensReturn } from '@marinoscar/platform-web/identity/headless';
import { appIdentityApi } from '../platform/identityAdapters';

export function usePersonalAccessTokens(): UsePersonalAccessTokensReturn {
  return platformUsePersonalAccessTokens(appIdentityApi);
}
