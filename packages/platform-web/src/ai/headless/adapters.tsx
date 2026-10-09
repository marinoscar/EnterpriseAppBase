// =============================================================================
// The AI slice's app adapters (issue #890)
// =============================================================================
//
// What the AI pages need from the app beyond the platform host: the app's
// spinner and table (the app owns appearance). The jobs slice's
// `JobsWebAdaptersProvider` is the model.
//
// Without a provider every adapter has a default: an MUI spinner and a plain
// MUI table.
// =============================================================================

import { createContext, useContext } from 'react';
import type { ComponentType, ReactElement, ReactNode } from 'react';

import type { AiDataTableComponent } from './table.js';

/**
 * What {@link AiWebAdapters.Spinner} takes.
 *
 * @stability experimental
 */
export interface AiSpinnerProps {
  /** A whole-page wait. The AI pages never ask for one. */
  fullScreen?: boolean;
}

/**
 * What the AI pages take from the app. Every member is optional; keep the
 * object a module constant.
 *
 * @example
 * ```ts
 * // apps/web/src/platform/aiAdapters.ts
 * export const appAiAdapters: AiWebAdapters = { Spinner: LoadingSpinner, DataTable };
 * ```
 *
 * @extensionPoint option
 * @stability experimental
 */
export interface AiWebAdapters {
  /** The app's loading spinner. Default an MUI `CircularProgress`. */
  Spinner?: ComponentType<AiSpinnerProps>;
  /** The app's table for the model catalogue and the usage breakdowns. Default a plain MUI table. */
  DataTable?: AiDataTableComponent;
}

const NO_ADAPTERS: AiWebAdapters = Object.freeze({});

const AiWebAdaptersContext = createContext<AiWebAdapters>(NO_ADAPTERS);
AiWebAdaptersContext.displayName = 'AiWebAdaptersContext';

/**
 * Hands the app's {@link AiWebAdapters} to every AI page below it. Mount it
 * once, around the signed-in shell.
 *
 * @param props - `adapters`: the app's adapters (a module constant); `children`: the routed tree.
 * @returns the provider element.
 *
 * @example
 * ```tsx
 * <AiWebAdaptersProvider adapters={appAiAdapters}>{shell}</AiWebAdaptersProvider>
 * ```
 *
 * @extensionPoint component
 * @stability experimental
 */
export function AiWebAdaptersProvider(props: {
  adapters: AiWebAdapters;
  children: ReactNode;
}): ReactElement {
  return (
    <AiWebAdaptersContext.Provider value={props.adapters}>
      {props.children}
    </AiWebAdaptersContext.Provider>
  );
}

/**
 * The adapters in context (an empty object without a provider).
 *
 * @returns the app's AI adapters.
 *
 * @stability experimental
 */
export function useAiWebAdapters(): AiWebAdapters {
  return useContext(AiWebAdaptersContext);
}
