/**
 * Route guard: render `children` only while telemetry is available AND switched
 * on in this deployment — issue #537, epic #528. Modelled on the app's
 * `RequireAiEnabled`.
 *
 * The FEATURE half of a telemetry route's gate; the app's permission gate is
 * the permission half, and the app nests this inside it. The Telemetry
 * settings page does NOT use it: that page is where telemetry is switched on.
 *
 * While the first answer is in flight this renders the loading element rather
 * than the fallback, so a deep link is not bounced home on the provisional
 * "off".
 */
import { createElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { Navigate } from 'react-router-dom';

import { useTelemetryWebAdapters } from '../adapters/TelemetryWebAdapters.js';
import { isTelemetryOn, useTelemetryConfig } from '../context/telemetryConfig.js';

/**
 * What {@link RequireTelemetryEnabled} takes.
 *
 * @stability experimental
 */
export interface RequireTelemetryEnabledProps {
  /** The guarded route element. */
  children: ReactNode;
  /** Rendered when telemetry is off. Defaults to a replace-redirect to `/`. */
  fallback?: ReactNode;
  /**
   * Rendered while the first answer is in flight. Defaults to the app's
   * spinner adapter (`TelemetryWebAdapters.Spinner`), else nothing.
   */
  loading?: ReactNode;
}

/**
 * Renders `children` only while the `telemetry` feature is on (a store is
 * deployed AND collection is switched on).
 *
 * @param props - see {@link RequireTelemetryEnabledProps}.
 * @returns the children, the loading element or the fallback.
 *
 * @example
 * ```tsx
 * <RequirePermission permission="telemetry:query">
 *   <RequireTelemetryEnabled><TelemetryExplorerPage /></RequireTelemetryEnabled>
 * </RequirePermission>
 * ```
 *
 * @stability experimental
 */
export function RequireTelemetryEnabled({
  children,
  fallback = <Navigate to="/" replace />,
  loading,
}: RequireTelemetryEnabledProps): ReactElement {
  const { config, isLoading } = useTelemetryConfig();
  const { Spinner } = useTelemetryWebAdapters();

  if (isLoading) return <>{loading ?? (Spinner ? createElement(Spinner) : null)}</>;
  if (!isTelemetryOn(config)) return <>{fallback}</>;
  return <>{children}</>;
}
