// =============================================================================
// The web host ports (issue #696, PP-2.7)
// =============================================================================
//
// Every packaged page reaches the app through ONE context: the app's
// transport, the signed-in viewer and optional formatting hooks. The app
// builds the host once (`apps/web/src/platform/platformHost.tsx`) and mounts
// `PlatformHostProvider` inside its auth provider; a packaged page never
// imports app context, layout or navigation.
// =============================================================================

import { createContext, useContext } from 'react';
import type { ReactElement, ReactNode } from 'react';

import type { PlatformApiClient } from './api-client.js';
import type { PlatformViewer } from './viewer.js';

/**
 * Everything a packaged page needs from the app.
 *
 * @stability experimental
 */
export interface PlatformWebHost {
  /** The app's transport. Keep its identity stable across renders. */
  api: PlatformApiClient;
  /** Who is looking. */
  viewer: PlatformViewer;
  /** Optional formatting hooks so packaged pages match the app's conventions. */
  formatRelativeTime?(iso: string): string;
  /**
   * Applies a theme preference (`light`, `dark`, `system`) to the app's theme
   * context. The Appearance page calls it when the stored preference loads or
   * is saved; without it the preference is stored and the app's theme is left
   * alone. Keep its identity stable.
   */
  applyTheme?(theme: 'light' | 'dark' | 'system'): void;
}

const PlatformHostContext = createContext<PlatformWebHost | null>(null);
PlatformHostContext.displayName = 'PlatformHostContext';

/**
 * Makes the app's {@link PlatformWebHost} available to every packaged page
 * below it. Mount it once, inside the app's auth provider.
 *
 * @param props - `host`: the app's host (memoise it); `children`: the routed tree.
 * @returns the provider element.
 *
 * @example
 * ```tsx
 * <PlatformHostProvider host={host}>
 *   <Layout />
 * </PlatformHostProvider>
 * ```
 *
 * @extensionPoint option
 * @stability experimental
 */
export function PlatformHostProvider(props: { host: PlatformWebHost; children: ReactNode }): ReactElement {
  return <PlatformHostContext.Provider value={props.host}>{props.children}</PlatformHostContext.Provider>;
}

/**
 * The host in context, or `null` outside any {@link PlatformHostProvider}.
 * For hooks that also accept an explicit dependency (`useDoctor(client)`).
 *
 * @returns the host, or `null`.
 *
 * @stability experimental
 */
export function useOptionalPlatformHost(): PlatformWebHost | null {
  return useContext(PlatformHostContext);
}

/**
 * The host in context.
 *
 * @returns the host.
 * @throws Error outside a {@link PlatformHostProvider}.
 *
 * @stability experimental
 */
export function usePlatformHost(): PlatformWebHost {
  const host = useContext(PlatformHostContext);
  if (host === null) {
    throw new Error(
      'usePlatformHost: no PlatformHostProvider above this component. Packaged pages read the app ' +
        "through @marinoscar/platform-web/core's PlatformHostProvider; mount it inside the app's auth provider.",
    );
  }
  return host;
}

/**
 * The app's transport from the host in context.
 *
 * @returns the host's {@link PlatformApiClient}.
 * @throws Error outside a {@link PlatformHostProvider}.
 *
 * @stability experimental
 */
export function usePlatformApi(): PlatformApiClient {
  return usePlatformHost().api;
}

/**
 * The viewer from the host in context.
 *
 * @returns the host's {@link PlatformViewer}.
 * @throws Error outside a {@link PlatformHostProvider}.
 *
 * @stability experimental
 */
export function usePlatformViewer(): PlatformViewer {
  return usePlatformHost().viewer;
}
