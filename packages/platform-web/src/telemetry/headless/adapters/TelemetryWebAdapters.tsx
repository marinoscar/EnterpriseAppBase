// =============================================================================
// The telemetry slice's app adapters (issue #704)
// =============================================================================
//
// What the telemetry pages need from the app that the platform host
// (`@marinoscar/platform-web/core`) does not carry: whether AI is switched on,
// the AI model catalogue for the assistant's model picker, and the app's
// spinner. The AI slice is not packaged yet, so the app keeps owning those
// hooks and hands them in here; copying them into this package would fork
// the AI slice.
//
// Without a provider every adapter answers "off": AI disabled, no models, no
// app spinner. The telemetry UI then hides the assistant (fail closed).
// =============================================================================

import { createContext, useContext } from 'react';
import type { ComponentType, ReactElement, ReactNode } from 'react';

/**
 * One enabled AI model, as the telemetry assistant's model picker shows it:
 * only the fields the picker reads.
 *
 * @stability experimental
 */
export interface TelemetryAssistantModelOption {
  /** A stable id for the option (the catalogue row's id). */
  id: string;
  /** The provider id, e.g. `openai`. The stored key is `<provider>:<modelId>`. */
  provider: string;
  /** The provider's model id. */
  modelId: string;
  /** What the picker shows (the catalogue's display name, else the model id). */
  label: string;
  /** Whether the model declares tool calling (the assistant needs it). */
  supportsToolCalling: boolean;
}

/**
 * What {@link TelemetryWebAdapters.useAiEnabled} returns.
 *
 * @stability experimental
 */
export interface TelemetryAiEnabledState {
  /** AI is switched on for this deployment. */
  enabled: boolean;
  /** The first answer is still in flight. */
  isLoading: boolean;
}

/**
 * What {@link TelemetryWebAdapters.useAssistantModels} returns.
 *
 * @stability experimental
 */
export interface TelemetryAssistantModelsState {
  /** The enabled models, in the catalogue's order. */
  models: TelemetryAssistantModelOption[];
  /** The catalogue is still loading. */
  isLoading: boolean;
  /** Why the catalogue could not be read, or `null`. */
  error: string | null;
}

/**
 * The app hooks the telemetry pages call. Each `use*` member is a React hook:
 * keep the object a module constant so the same hooks run on every render.
 *
 * @example
 * ```ts
 * // apps/web/src/platform/telemetryAdapters.ts
 * export const appTelemetryAdapters: TelemetryWebAdapters = {
 *   useAiEnabled: () => { const { config, isLoading } = useAiConfig(); return { enabled: config.enabled, isLoading }; },
 *   useAssistantModels: () => ...,
 *   Spinner: LoadingSpinner,
 * };
 * ```
 *
 * @extensionPoint option
 * @stability experimental
 */
export interface TelemetryWebAdapters {
  /** AI switched on for this deployment (the reference app: `useAiConfig().config.enabled`). */
  useAiEnabled(): TelemetryAiEnabledState;
  /**
   * Enabled models for the assistant picker (the reference app:
   * `useAiModels({ enabled: true, pageSize: 100 })`). Called only for a viewer
   * holding `ai_config:read`, which the catalogue route requires.
   */
  useAssistantModels(): TelemetryAssistantModelsState;
  /** Optional spinner for loading states; the pages default to an MUI `CircularProgress`. */
  Spinner?: ComponentType;
}

const AI_OFF: TelemetryAiEnabledState = Object.freeze({ enabled: false, isLoading: false });
const NO_MODELS: TelemetryAssistantModelsState = Object.freeze({ models: [], isLoading: false, error: null });

/**
 * The adapters in force without a provider: AI off, no models, no spinner.
 *
 * @stability experimental
 */
export const DEFAULT_TELEMETRY_WEB_ADAPTERS: TelemetryWebAdapters = Object.freeze({
  useAiEnabled: () => AI_OFF,
  useAssistantModels: () => NO_MODELS,
});

const TelemetryWebAdaptersContext = createContext<TelemetryWebAdapters>(DEFAULT_TELEMETRY_WEB_ADAPTERS);
TelemetryWebAdaptersContext.displayName = 'TelemetryWebAdaptersContext';

/**
 * Hands the app's {@link TelemetryWebAdapters} to every telemetry page below
 * it. Mount it once, next to the `TelemetryConfigProvider`.
 *
 * @param props - `adapters`: the app's adapters (a module constant); `children`: the routed tree.
 * @returns the provider element.
 *
 * @stability experimental
 */
export function TelemetryWebAdaptersProvider(props: {
  adapters: TelemetryWebAdapters;
  children: ReactNode;
}): ReactElement {
  return (
    <TelemetryWebAdaptersContext.Provider value={props.adapters}>{props.children}</TelemetryWebAdaptersContext.Provider>
  );
}

/**
 * The adapters in context, or {@link DEFAULT_TELEMETRY_WEB_ADAPTERS}.
 *
 * @returns the app's telemetry adapters.
 *
 * @stability experimental
 */
export function useTelemetryWebAdapters(): TelemetryWebAdapters {
  return useContext(TelemetryWebAdaptersContext);
}
