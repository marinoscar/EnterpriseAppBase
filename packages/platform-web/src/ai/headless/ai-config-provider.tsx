// The one `GET /ai/config` fetch for the authenticated shell (issue #890,
// moved from the reference app's `contexts/AiConfigContext.tsx`).

import type { ReactElement, ReactNode } from 'react';

import { AiConfigContext, useAiConfigQuery } from './use-ai-config.js';
import type { AiHookOptions } from './use-ai-api.js';

/**
 * Fetches `GET /ai/config` once and shares the answer with every
 * {@link useAiConfig} and {@link useAiFeatures} below it, so the navigation
 * chrome and every routed page read one answer. Mount it inside the
 * authenticated shell (the endpoint needs a session) and around the layout.
 *
 * It usually sits ABOVE the `PlatformHostProvider` (the host reads the feature
 * map this provider holds), so give it the app's transport as `api`.
 *
 * @param props - `api`: the transport (a module constant); `children`: the shell.
 * @returns the provider element.
 *
 * @example
 * ```tsx
 * <AiConfigProvider api={appPlatformApi}>{shell}</AiConfigProvider>
 * ```
 *
 * @extensionPoint component
 * @stability experimental
 */
export function AiConfigProvider(props: AiHookOptions & { children: ReactNode }): ReactElement {
  const value = useAiConfigQuery(props.api === undefined ? {} : { api: props.api });
  return <AiConfigContext.Provider value={value}>{props.children}</AiConfigContext.Provider>;
}
