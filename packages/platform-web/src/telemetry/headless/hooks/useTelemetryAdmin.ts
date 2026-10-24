/**
 * The Telemetry settings page's data — issue #537, epic #528.
 *
 * Loads `GET /admin/telemetry/config` and `GET /admin/telemetry/status`
 * together, and saves with `If-Match: <version>`. A stale version answers 409;
 * that is surfaced as `conflict` (not a generic error) so the page can offer a
 * reload rather than a retry that would fail the same way.
 */
import { useCallback, useEffect, useState } from 'react';
import { isPlatformApiError } from '../../../core/index.js';
import {
  type TelemetryAdminConfig,
  type TelemetrySettingsUpdate,
  type TelemetryStatus,
} from '../services/telemetry.js';
import { useTelemetryClient } from '../services/client.js';
import { useIsMounted } from '../../internal/useIsMounted.js';

/**
 * What {@link useTelemetryAdmin} returns.
 *
 * @stability experimental
 */
export interface UseTelemetryAdminReturn {
  /** The stored settings and their provenance, or `null` before the first load. */
  config: TelemetryAdminConfig | null;
  /** The latest diagnosis, or `null` before the first load. */
  status: TelemetryStatus | null;
  /** A (re)load is in flight. */
  isLoading: boolean;
  /** Why the config could not be loaded, or `null`. */
  loadError: string | null;
  /** Why the status could not be loaded, or `null`. */
  statusError: string | null;
  /** A save is in flight. */
  isSaving: boolean;
  /** Why the last save failed (other than a 409), or `null`. */
  saveError: string | null;
  /** True after a save was refused with 409 — someone else saved first. */
  conflict: boolean;
  /** Load the config and the status again. */
  reload: () => Promise<void>;
  /** Load the status again. */
  refreshStatus: () => Promise<void>;
  /** Resolves `true` on success. */
  save: (settings: TelemetrySettingsUpdate) => Promise<boolean>;
}

function message(err: unknown, fallback: string): string {
  return isPlatformApiError(err) || err instanceof Error ? err.message : fallback;
}

/**
 * The Telemetry settings page's data: `GET /admin/telemetry/config` and `GET /admin/telemetry/status` together, and a save with `If-Match: <version>` (a 409 sets `conflict`). Reads the platform host's transport.
 *
 * @returns the config, the status and the save action.
 * @throws Error outside a `PlatformHostProvider`.
 *
 * @stability experimental
 */
export function useTelemetryAdmin(): UseTelemetryAdminReturn {
  const client = useTelemetryClient();
  const [config, setConfig] = useState<TelemetryAdminConfig | null>(null);
  const [status, setStatus] = useState<TelemetryStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const isMounted = useIsMounted();

  const refreshStatus = useCallback(async () => {
    try {
      const next = await client.getTelemetryStatus();
      if (isMounted()) {
        setStatus(next);
        setStatusError(null);
      }
    } catch (err) {
      if (isMounted()) setStatusError(message(err, 'Failed to load telemetry status'));
    }
  }, [client, isMounted]);

  const reload = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    setSaveError(null);
    setConflict(false);
    try {
      const [next] = await Promise.all([client.getTelemetryAdminConfig(), refreshStatus()]);
      if (isMounted()) setConfig(next);
    } catch (err) {
      if (isMounted()) setLoadError(message(err, 'Failed to load telemetry configuration'));
    } finally {
      if (isMounted()) setIsLoading(false);
    }
  }, [client, isMounted, refreshStatus]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const save = useCallback(
    async (settings: TelemetrySettingsUpdate) => {
      setIsSaving(true);
      setSaveError(null);
      setConflict(false);
      try {
        const next = await client.updateTelemetryAdminConfig(settings, config?.version);
        if (isMounted()) setConfig(next);
        void refreshStatus();
        return true;
      } catch (err) {
        if (isMounted()) {
          if (isPlatformApiError(err) && err.status === 409) {
            setConflict(true);
          } else {
            setSaveError(message(err, 'Failed to save telemetry configuration'));
          }
        }
        return false;
      } finally {
        if (isMounted()) setIsSaving(false);
      }
    },
    [client, config?.version, isMounted, refreshStatus],
  );

  return {
    config,
    status,
    isLoading,
    loadError,
    statusError,
    isSaving,
    saveError,
    conflict,
    reload,
    refreshStatus,
    save,
  };
}
