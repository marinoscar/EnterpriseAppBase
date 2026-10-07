/**
 * The one `GET /api/telemetry/config` fetch for the authenticated shell —
 * issue #537, epic #528. Mounted beside the app's AI config provider, for the
 * same reasons: its endpoint is `@Auth()`, and one mount point means one
 * request shared by the chrome and every routed page. See `telemetryConfig.ts`.
 */
import type { ReactElement, ReactNode } from 'react';

import type { PlatformApiClient } from '../../../core/index.js';
import { TelemetryConfigContext, useTelemetryConfigQuery } from './telemetryConfig.js';

/**
 * What {@link TelemetryConfigProvider} takes.
 *
 * @stability experimental
 */
export interface TelemetryConfigProviderProps {
  /** The routed tree. */
  children: ReactNode;
  /**
   * The transport to read `GET /telemetry/config` with. Optional below a
   * `PlatformHostProvider` (its transport is used); required above one, which
   * is where the app mounts it: the host reads the `telemetry` feature this
   * provider answers. Keep its identity stable.
   */
  api?: PlatformApiClient;
}

/**
 * Fetches `GET /telemetry/config` once for everything below it; every
 * {@link useTelemetryConfig} and {@link useTelemetryFeatures} below reads that
 * copy. Mount it once, around the authenticated shell.
 *
 * @param props - see {@link TelemetryConfigProviderProps}.
 * @returns the provider element.
 *
 * @example
 * ```tsx
 * <TelemetryConfigProvider api={appPlatformApi}>
 *   <AppPlatformHostProvider>{shell}</AppPlatformHostProvider>
 * </TelemetryConfigProvider>
 * ```
 *
 * @stability experimental
 */
export function TelemetryConfigProvider({ children, api }: TelemetryConfigProviderProps): ReactElement {
  const value = useTelemetryConfigQuery(api === undefined ? {} : { api });
  return <TelemetryConfigContext.Provider value={value}>{children}</TelemetryConfigContext.Provider>;
}
