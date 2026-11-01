/**
 * Whether telemetry exists in this deployment, as every authenticated user may
 * know it (`GET /api/telemetry/config`) — issue #537, epic #528.
 *
 * A deliberate mirror of `useAiConfig.ts`, for the same two reasons:
 *
 * 1. FAIL CLOSED. `config` is never `null`: until the first answer arrives,
 *    and whenever the first fetch fails, it is {@link TELEMETRY_CONFIG_DISABLED},
 *    so no telemetry surface is offered on a guess.
 *
 * 2. ONE FETCH PER SHELL. `TelemetryConfigProvider`
 *    (`contexts/TelemetryConfigContext.tsx`) fetches once around the
 *    authenticated shell; `useTelemetryConfig()` reads that when present and
 *    falls back to fetching for itself when rendered in isolation.
 *
 * The `telemetry` feature is ON when `available && enabled`: a store is
 * deployed AND collection is switched on. `refresh()` is what the Telemetry
 * settings page calls after a save.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { isPlatformApiError, useOptionalPlatformHost } from '../../../core/index.js';
import type { PlatformApiClient } from '../../../core/index.js';
import { createTelemetryClient } from '../services/client.js';
import type { TelemetryPublicConfig } from '../services/telemetry.js';
import { useIsMounted } from '../../internal/useIsMounted.js';

/**
 * The answer assumed before the API has given one, and after it failed to.
 *
 * @stability experimental
 */
export const TELEMETRY_CONFIG_DISABLED: TelemetryPublicConfig = Object.freeze({
  available: false,
  enabled: false,
  assistantEnabled: false,
});

/**
 * What {@link useTelemetryConfig} returns.
 *
 * @stability experimental
 */
export interface UseTelemetryConfigReturn {
  /** The answer; {@link TELEMETRY_CONFIG_DISABLED} until the first one arrives, and after the first fetch failed. */
  config: TelemetryPublicConfig;
  /** The first answer is in flight. */
  isLoading: boolean;
  /** Why the last fetch failed, or `null`. */
  error: string | null;
  /** Fetch again (the Telemetry settings page calls it after a save). */
  refresh: () => Promise<void>;
}

/**
 * The shell-wide answer; `null` means "no provider above this component".
 *
 * @stability experimental
 */
export const TelemetryConfigContext = createContext<UseTelemetryConfigReturn | null>(null);

/**
 * Whether the `telemetry` settings feature is on for this answer.
 *
 * @stability experimental
 */
export function isTelemetryOn(config: TelemetryPublicConfig): boolean {
  return config.available === true && config.enabled === true;
}

/**
 * The fetching implementation; `skip` makes it an inert stub.
 *
 * @stability experimental
 */
export function useTelemetryConfigQuery(options: { skip?: boolean; api?: PlatformApiClient } = {}): UseTelemetryConfigReturn {
  const { skip = false } = options;
  // The provider is mounted around the platform host (the host reads the
  // feature this answers), so it may take the transport as a prop; anywhere
  // else the host's transport is used.
  const hostApi = useOptionalPlatformHost()?.api;
  const api = options.api ?? hostApi;
  const client = useMemo(() => (api ? createTelemetryClient(api) : null), [api]);
  const [config, setConfig] = useState<TelemetryPublicConfig>(TELEMETRY_CONFIG_DISABLED);
  const [isLoading, setIsLoading] = useState(!skip);
  const [error, setError] = useState<string | null>(null);
  const loaded = useRef(false);
  const isMounted = useIsMounted();

  const fetchConfig = useCallback(async () => {
    try {
      if (!loaded.current && isMounted()) setIsLoading(true);
      setError(null);
      if (client === null) {
        throw new Error('No platform host transport to read the telemetry configuration with');
      }
      const data = await client.getTelemetryConfig();
      loaded.current = true;
      if (isMounted()) setConfig(data);
    } catch (err) {
      if (isMounted()) {
        if (!loaded.current) setConfig(TELEMETRY_CONFIG_DISABLED);
        setError(isPlatformApiError(err) ? err.message : 'Failed to load telemetry configuration');
      }
    } finally {
      if (isMounted()) setIsLoading(false);
    }
  }, [isMounted, client]);

  useEffect(() => {
    if (skip) return;
    void fetchConfig();
  }, [fetchConfig, skip]);

  return useMemo(
    () => ({ config, isLoading: skip ? false : isLoading, error, refresh: fetchConfig }),
    [config, isLoading, error, fetchConfig, skip],
  );
}

/**
 * The telemetry configuration — the shell's shared copy when there is one.
 *
 * @stability experimental
 */
export function useTelemetryConfig(): UseTelemetryConfigReturn {
  const shared = useContext(TelemetryConfigContext);
  const own = useTelemetryConfigQuery({ skip: shared !== null });
  return shared ?? own;
}

/**
 * The `telemetry` entry of a settings hub's feature map.
 *
 * @stability experimental
 */
export interface TelemetryFeatureFlags {
  /** A telemetry store is deployed AND collection is switched on. */
  telemetry: boolean;
}

/**
 * The `telemetry` entry of the registries' feature map — read from the shell's
 * provider ONLY, never fetched (the navigation chrome renders in many isolated
 * tests; without a provider it answers "off" with no request).
 *
 * @stability experimental
 */
export function useTelemetryFeatures(): TelemetryFeatureFlags {
  const shared = useContext(TelemetryConfigContext);
  return { telemetry: shared ? isTelemetryOn(shared.config) : false };
}
