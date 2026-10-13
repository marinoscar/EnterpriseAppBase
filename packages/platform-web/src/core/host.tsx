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
  /**
   * Ports an installed extension package declares for itself, keyed by a string
   * or a `Symbol.for(...)` the package exports. The app supplies them next to
   * the platform's own ports; the package reads one with
   * {@link usePlatformPort}. Keep the record (and each port) stable across
   * renders.
   *
   * @extensionPoint option
   * @stability experimental
   * @example
   * ```tsx
   * const host = { api, viewer, extensions: { [TRANSCRIPTS_PORT]: transcriptsPort } };
   * ```
   */
  extensions?: Readonly<Record<string | symbol, unknown>>;
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

/**
 * A port an extension package declared on the host's `extensions` record.
 *
 * Throws a clear error when the app did not supply it, so a package that needs
 * a port fails at the first render with the key and the fix, not later with a
 * `undefined is not a function`. Use {@link useOptionalPlatformPort} for a port
 * that is genuinely optional.
 *
 * The type parameter is a promise by the caller: nothing checks the port's
 * shape. Export the key and the type from your package, and validate in the
 * package if the app is untrusted code.
 *
 * @typeParam T - the port's type, as the package declares it.
 * @param key - the key the package exports (`'acme.transcripts'` or `Symbol.for('@acme/transcripts/port')`).
 * @returns the port the app supplied.
 * @throws Error outside a {@link PlatformHostProvider}, or when `host.extensions` has no entry for `key`.
 *
 * @extensionPoint option
 * @stability experimental
 * @example
 * ```tsx
 * export const TRANSCRIPTS_PORT = Symbol.for('@acme/transcripts/port');
 * const port = usePlatformPort<TranscriptsPort>(TRANSCRIPTS_PORT);
 * ```
 */
export function usePlatformPort<T>(key: string | symbol): T {
  const extensions = usePlatformHost().extensions;
  if (extensions === undefined || !Object.prototype.hasOwnProperty.call(extensions, key) || extensions[key] === undefined) {
    throw new Error(
      `usePlatformPort: the host has no extension port ${String(key)}. Supply it in the app's PlatformWebHost ` +
        `(host.extensions[${typeof key === 'symbol' ? String(key) : JSON.stringify(key)}] = ...) before mounting the package that needs it.`,
    );
  }
  return extensions[key] as T;
}

/**
 * Like {@link usePlatformPort}, but `undefined` when the app did not supply the
 * port (or there is no provider), for a package whose port is optional.
 *
 * @typeParam T - the port's type, as the package declares it.
 * @param key - the key the package exports.
 * @returns the port, or `undefined`.
 *
 * @extensionPoint option
 * @stability experimental
 */
export function useOptionalPlatformPort<T>(key: string | symbol): T | undefined {
  const extensions = useOptionalPlatformHost()?.extensions;
  if (extensions === undefined || !Object.prototype.hasOwnProperty.call(extensions, key)) return undefined;
  return extensions[key] as T | undefined;
}
