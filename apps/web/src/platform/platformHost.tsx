/**
 * The app's web platform host: the ONE place the web app is bound to the
 * platform's packaged pages (issue #696, PP-2.7).
 *
 * Every packaged page (`@marinoscar/platform-web/<slice>/ui`) reads the app
 * through `usePlatformHost()`; this file builds that host from what the app
 * already has:
 *
 *   - `api`: the app's own transport (`services/api.ts`) through core's
 *     `createPlatformApiClient` (#868), so the auth header, the token refresh
 *     and the maintenance recogniser stay where they are. `getBlob`/`postBlob`
 *     use its `blobWithHeaders` response type for downloads, and `postSse` is
 *     `services/sse.ts`'s `postSse` (one POSTed request, one streamed answer)
 *     with the same bearer and refresh. The app's `ApiError` is mapped onto
 *     `PlatformApiError`; anything else (a network failure) passes through
 *     untouched. A MODULE-LEVEL constant, so its identity never changes and a
 *     packaged hook keyed on it never refetches on a re-render.
 *   - `viewer`: `usePermissions().hasPermission` and the auth context's user
 *     id, plus the feature map the settings hubs already read
 *     (`useAiFeatures`, `useTelemetryFeatures`: context only, never fetched).
 *   - `formatRelativeTime`: `utils/relativeTime`, so packaged pages date
 *     things the way the rest of the app does.
 *   - `applyTheme`: the theme context's `setMode`, so the Appearance page
 *     (`@marinoscar/platform-web/settings/ui`) changes the app's theme.
 *
 * Mounted once, in `App.tsx`, inside the auth provider and the AI / telemetry
 * config providers (so the feature map is real), around the shell.
 */

import { useCallback, useMemo, useRef } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { PlatformHostProvider, createPlatformApiClient } from '@marinoscar/platform-web/core';
import { useTelemetryFeatures } from '@marinoscar/platform-web/telemetry/headless';
import type { PlatformApiClient, PlatformSseOptions, PlatformWebHost } from '@marinoscar/platform-web/core';

import { useAuth, usePermissions } from '@marinoscar/platform-web/identity/headless';
import { useThemeContext } from '../contexts/ThemeContext';
import { useAiFeatures } from '@marinoscar/platform-web/ai/headless';
import { API_BASE_URL, api } from '../services/api';
import { postSse } from '../services/sse';
import { formatRelativeTime } from '../utils/relativeTime';

/**
 * The app's `ApiError` as a `PlatformApiError`; anything else unchanged.
 * `@marinoscar/platform-web/core`'s mapping since #868, re-exported here.
 */
export { toPlatformApiError } from '@marinoscar/platform-web/core';

/**
 * The app's transport as a `PlatformApiClient`: core's adapter over the app's
 * one `PlatformHttpClient` (#868), plus `postSse`. Stable identity: a module
 * constant.
 *
 * `postSse` (one POSTed request, one streamed answer: the telemetry
 * assistant, #704) is `services/sse.ts`'s `postSse`, with the same bearer
 * token and the same single refresh-and-retry as every other call. The
 * adapter maps its errors like every other call's.
 */
export const appPlatformApi: PlatformApiClient = createPlatformApiClient(api, {
  postSse: (path: string, body: unknown, options: PlatformSseOptions) =>
    postSse<unknown>({
      url: `${API_BASE_URL}${path}`,
      body,
      authorization: () => {
        const token = api.getAccessToken();
        return token ? `Bearer ${token}` : null;
      },
      reauthenticate: () => api.refreshToken(),
      onFrame: (event, data) => options.onFrame(event, data),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    }),
});

/** The host for the signed-in viewer. Memoised on what it reads. */
export function useAppPlatformHost(): PlatformWebHost {
  const { user, refreshUser } = useAuth();
  const { hasPermission } = usePermissions();
  const { ai } = useAiFeatures();
  const { telemetry } = useTelemetryFeatures();
  const { setMode } = useThemeContext();
  // #726: org management exists only in multi-org mode.
  const orgs = user?.tenancyMode === 'multi';
  const userId = user?.id ?? null;
  const email = user?.email ?? null;
  // `refreshUser` changes identity between renders. The host must not: the
  // packaged hooks key on it, so a new host would refetch on every render. A
  // stable wrapper reads the latest function from a ref.
  const refreshUserRef = useRef(refreshUser);
  refreshUserRef.current = refreshUser;
  const refresh = useCallback(() => refreshUserRef.current(), []);

  return useMemo<PlatformWebHost>(() => {
    const features: Record<string, boolean> = { ai, telemetry, orgs };
    return {
      api: appPlatformApi,
      viewer: {
        userId,
        email,
        hasPermission,
        isFeatureEnabled: (feature) => features[feature] === true,
        // The user-data pages re-read the user after a deletion or a factory reset.
        refresh,
      },
      formatRelativeTime: (iso) => formatRelativeTime(iso),
      // The Appearance page pushes the stored theme into the app's theme context.
      applyTheme: setMode,
    };
  }, [userId, email, hasPermission, ai, telemetry, orgs, refresh, setMode]);
}

/** `PlatformHostProvider` bound to the app's host. Mount it once, inside the auth provider. */
export function AppPlatformHostProvider({ children }: { children: ReactNode }): ReactElement {
  const host = useAppPlatformHost();
  return <PlatformHostProvider host={host}>{children}</PlatformHostProvider>;
}
