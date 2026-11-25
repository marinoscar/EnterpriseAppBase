/**
 * Route guard: render `children` only while AI is switched on in this
 * deployment (issue #899, moved from the reference app, issues #425 and #419).
 *
 * The FEATURE half of an AI route's gate; `RequirePermission` is the
 * permission half, and the app nests this inside it so a user without the
 * permission is redirected without the feature question mattering. Every AI
 * route uses it except `/admin/settings/ai`, which is where AI is switched on
 * and so must stay reachable while it is off.
 *
 * WHILE THE FIRST ANSWER IS IN FLIGHT this renders a spinner, not the
 * fallback: `useAiConfig` fails closed (`enabled: false`) until it knows, and
 * redirecting on that provisional answer would bounce every deep link to `/ai`
 * back home before the real answer arrived. Once the answer is in, a refresh
 * never flips `isLoading` again, so the guarded page is not unmounted by its
 * own re-read.
 */

import type { ReactElement, ReactNode } from 'react';
import { Navigate } from 'react-router-dom';

import { useAiConfig } from '../headless/use-ai-config.js';
import { AiSpinner } from './internal/AiSpinner.js';

/**
 * What {@link RequireAiEnabled} takes.
 *
 * @stability experimental
 */
export interface RequireAiEnabledProps {
  /** The guarded route element. */
  children: ReactNode;
  /** Rendered when AI is off. Defaults to a replace-redirect to `/`, like every settings route. */
  fallback?: ReactNode;
}

/**
 * Renders `children` only while AI is on; a spinner while the first answer of
 * `GET /ai/config` is in flight; the fallback once it says off.
 *
 * @param props - see {@link RequireAiEnabledProps}.
 * @returns the children, the spinner or the fallback.
 *
 * @example
 * ```tsx
 * <RequirePermission permission="ai:use">
 *   <RequireAiEnabled><AiPlaygroundPage /></RequireAiEnabled>
 * </RequirePermission>
 * ```
 *
 * @extensionPoint component
 * @stability experimental
 */
export function RequireAiEnabled({
  children,
  fallback = <Navigate to="/" replace />,
}: RequireAiEnabledProps): ReactElement {
  const { config, isLoading } = useAiConfig();

  if (isLoading) return <AiSpinner />;
  if (!config.enabled) return <>{fallback}</>;
  return <>{children}</>;
}
