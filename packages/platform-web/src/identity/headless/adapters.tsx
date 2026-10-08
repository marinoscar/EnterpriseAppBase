// =============================================================================
// The identity slice's app adapters (issue #727, PP-6.6)
// =============================================================================
//
// What the identity pages need from the app beyond the platform host: the
// product name the sign-in copy uses, the app's spinner and table (the app
// owns appearance), and optionally the app's own identity API client. The
// telemetry slice's `TelemetryWebAdaptersProvider` is the model.
//
// Without a provider every adapter has a default: a generic product name, an
// MUI spinner, a plain MUI table, and `createIdentityApi(host.api)`.
// =============================================================================

import { createContext, useContext, useMemo } from 'react';
import type { ComponentType, ReactElement, ReactNode } from 'react';

import { useOptionalPlatformHost } from '../../core/index.js';
import { createIdentityApi } from './api.js';
import type { IdentityApi } from './api.js';
import type { IdentityDataTableComponent } from './table.js';

/**
 * What the identity pages take from the app. Every member is optional; keep
 * the object a module constant.
 *
 * @example
 * ```ts
 * // apps/web/src/platform/identityAdapters.ts
 * export const appIdentityAdapters: IdentityWebAdapters = {
 *   appName: APP_NAME,
 *   Spinner: LoadingSpinner,
 *   DataTable,
 * };
 * ```
 *
 * @extensionPoint option
 * @stability experimental
 */
export interface IdentityWebAdapters {
  /**
   * The product name the sign-in error copy names ("isn't approved to use
   * <appName> yet").
   *
   * @defaultValue `'this app'`
   */
  appName?: string;
  /** The app's loading spinner (`fullScreen` for a whole-page wait). Default an MUI `CircularProgress`. */
  Spinner?: ComponentType<{ fullScreen?: boolean }>;
  /** The app's table for the users, allowlist and token lists. Default a plain MUI table. */
  DataTable?: IdentityDataTableComponent;
  /** The identity calls. Default `createIdentityApi(usePlatformApi())`. */
  api?: IdentityApi;
}

const NO_ADAPTERS: IdentityWebAdapters = Object.freeze({});

const IdentityWebAdaptersContext = createContext<IdentityWebAdapters>(NO_ADAPTERS);
IdentityWebAdaptersContext.displayName = 'IdentityWebAdaptersContext';

/**
 * Hands the app's {@link IdentityWebAdapters} to every identity page below
 * it. Mount it once, around the routes (the login page renders outside the
 * signed-in shell, so above it).
 *
 * @param props - `adapters`: the app's adapters (a module constant); `children`: the routed tree.
 * @returns the provider element.
 *
 * @example
 * ```tsx
 * <IdentityWebAdaptersProvider adapters={appIdentityAdapters}>{routes}</IdentityWebAdaptersProvider>
 * ```
 *
 * @extensionPoint component
 * @stability experimental
 */
export function IdentityWebAdaptersProvider(props: {
  adapters: IdentityWebAdapters;
  children: ReactNode;
}): ReactElement {
  return (
    <IdentityWebAdaptersContext.Provider value={props.adapters}>{props.children}</IdentityWebAdaptersContext.Provider>
  );
}

/**
 * The adapters in context (an empty object without a provider).
 *
 * @returns the app's identity adapters.
 *
 * @stability experimental
 */
export function useIdentityWebAdapters(): IdentityWebAdapters {
  return useContext(IdentityWebAdaptersContext);
}

/**
 * The identity client the hooks use: `explicit` when given, else the
 * adapters' `api`, else `createIdentityApi` over the platform host's
 * transport.
 *
 * @param explicit - a client to use instead (keep its identity stable).
 * @returns the client.
 * @throws Error when none of the three is available.
 *
 * @stability experimental
 */
export function useIdentityApi(explicit?: IdentityApi): IdentityApi {
  const adapters = useIdentityWebAdapters();
  const hostApi = useOptionalPlatformHost()?.api;
  const fromHost = useMemo(() => (hostApi ? createIdentityApi(hostApi) : null), [hostApi]);
  const api = explicit ?? adapters.api ?? fromHost;
  if (!api) {
    throw new Error(
      'useIdentityApi: no identity client. Mount PlatformHostProvider (@marinoscar/platform-web/core) or ' +
        'IdentityWebAdaptersProvider with an `api`, or pass a client to the hook.',
    );
  }
  return api;
}
