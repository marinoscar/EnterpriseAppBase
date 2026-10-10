/**
 * The telemetry store section's data (PP-14.11).
 *
 * Loads `GET /admin/telemetry/store` (the active store, its generated-form
 * descriptor and settings) and saves with `PUT`, `If-Match: <the stored
 * settings' version>`. A stale version answers 409, surfaced as `conflict` so
 * the page can offer a reload. Secrets are write-only: they are sent, never read
 * back, and a secret nobody retyped is not sent at all.
 *
 * Writes resolve `true`/`false` and never throw.
 */
import { useCallback, useEffect, useState } from 'react';
import { isPlatformApiError } from '../../../core/index.js';
import type { TelemetryStoreConfig, TelemetryStoreInput } from '../services/telemetry.js';
import { useTelemetryClient } from '../services/client.js';
import { useIsMounted } from '../../internal/useIsMounted.js';

/**
 * What {@link useTelemetryStore} returns.
 *
 * @stability experimental
 */
export interface UseTelemetryStoreReturn {
  /** The store and its settings, or `null` before the first load. */
  store: TelemetryStoreConfig | null;
  /** A (re)load is in flight. */
  isLoading: boolean;
  /** Why the store could not be loaded, or `null`. */
  loadError: string | null;
  /** A save is in flight. */
  isSaving: boolean;
  /** Why the last save failed (other than a 409), or `null`. */
  saveError: string | null;
  /** True after a save was refused with 409: someone else changed it first. */
  conflict: boolean;
  /** Load the store again. */
  reload: () => Promise<void>;
  /** Save settings and secrets; resolves `true` on success. */
  save: (input: TelemetryStoreInput) => Promise<boolean>;
}

function message(err: unknown, fallback: string): string {
  return isPlatformApiError(err) || err instanceof Error ? err.message : fallback;
}

/**
 * The telemetry store section's data: `GET` and `PUT /admin/telemetry/store`
 * (with `If-Match`; a 409 sets `conflict`). Secrets are write-only.
 *
 * @returns the store and its actions.
 * @throws Error outside a `PlatformHostProvider`.
 *
 * @stability experimental
 */
export function useTelemetryStore(): UseTelemetryStoreReturn {
  const client = useTelemetryClient();
  const [store, setStore] = useState<TelemetryStoreConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const isMounted = useIsMounted();

  const reload = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    setSaveError(null);
    setConflict(false);
    try {
      const next = await client.getTelemetryStore();
      if (isMounted()) setStore(next);
    } catch (err) {
      if (isMounted()) setLoadError(message(err, 'Failed to load the telemetry store'));
    } finally {
      if (isMounted()) setIsLoading(false);
    }
  }, [client, isMounted]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const version = store?.version;

  const save = useCallback(
    async (input: TelemetryStoreInput) => {
      setIsSaving(true);
      setSaveError(null);
      setConflict(false);
      try {
        const next = await client.updateTelemetryStore(input, version);
        if (isMounted()) setStore(next);
        return true;
      } catch (err) {
        if (isMounted()) {
          if (isPlatformApiError(err) && err.status === 409) setConflict(true);
          else setSaveError(message(err, 'Failed to save the telemetry store'));
        }
        return false;
      } finally {
        if (isMounted()) setIsSaving(false);
      }
    },
    [client, isMounted, version],
  );

  return { store, isLoading, loadError, isSaving, saveError, conflict, reload, save };
}
