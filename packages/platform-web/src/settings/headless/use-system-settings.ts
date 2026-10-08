// `GET` / `PATCH` / `PUT /system-settings` (issue #733; moved from the
// reference app's `hooks/useSystemSettings.ts`, behaviour unchanged).
//
// The house fetch-hook contract: a mounted guard on every `setState` past an
// `await`; an API error becomes its message, with 403 named explicitly; a 409
// on save refetches and throws a message asking the user to review.

import type { SystemSettingsResponseBase } from '@marinoscar/platform-contract/settings';
import { useCallback, useEffect, useState } from 'react';

import { isPlatformApiError, useOptionalPlatformHost } from '../../core/index.js';
import type { PlatformApiClient } from '../../core/index.js';
import { useIsMounted } from '../internal/use-is-mounted.js';

/**
 * Options of {@link useSystemSettings} and its siblings.
 *
 * @stability experimental
 */
export interface SettingsHookOptions {
  /**
   * The transport. Default: the `PlatformHostProvider`'s. Pass the app's own
   * when the hook runs outside the provider (keep its identity stable).
   */
  api?: PlatformApiClient;
}

/**
 * What {@link useSystemSettings} returns.
 *
 * @typeParam T - the app's settings document type (any shape with the row `version`).
 *
 * @stability experimental
 */
export interface UseSystemSettingsResult<T extends { version: number }> {
  /** The document, or `null` until loaded (or when the load failed). */
  settings: T | null;
  /** Whether the first load (or a refresh) is in flight. */
  isLoading: boolean;
  /** The last error's message, or `null`. */
  error: string | null;
  /** Whether a save is in flight. */
  isSaving: boolean;
  /** `PATCH` with the loaded version as `If-Match`; a 409 refetches and throws. */
  updateSettings: (updates: Partial<T>) => Promise<void>;
  /** `PUT` the whole document. */
  replaceSettings: (settings: Omit<T, 'updatedAt' | 'updatedBy' | 'version'>) => Promise<void>;
  /** Reloads the document. */
  refresh: () => Promise<void>;
}

/**
 * The transport from the options, or the host's.
 *
 * @internal
 */
export function useSettingsApi(options: SettingsHookOptions | undefined): PlatformApiClient {
  const host = useOptionalPlatformHost();
  const api = options?.api ?? host?.api;
  if (!api) {
    throw new Error(
      'Settings hooks need a transport: mount PlatformHostProvider (@marinoscar/platform-web/core) or pass { api }.',
    );
  }
  return api;
}

/**
 * The deployment-wide settings document (`system_settings:read` to load,
 * `system_settings:write` to save).
 *
 * @param options - see {@link SettingsHookOptions}.
 * @returns the document and its actions.
 *
 * @example
 * ```ts
 * const { settings, updateSettings } = useSystemSettings<AppSystemSettings>();
 * await updateSettings({ maintenance: { enabled: true } });
 * ```
 *
 * @extensionPoint hook
 * @stability experimental
 */
export function useSystemSettings<T extends { version: number } = SystemSettingsResponseBase>(
  options?: SettingsHookOptions,
): UseSystemSettingsResult<T> {
  const api = useSettingsApi(options);
  const [settings, setSettings] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const isMounted = useIsMounted();

  const fetchSettings = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await api.get<T>('/system-settings');
      if (isMounted()) setSettings(data);
    } catch (err) {
      if (isMounted()) {
        if (isPlatformApiError(err) && err.status === 403) {
          setError('You do not have permission to view system settings');
        } else {
          setError(isPlatformApiError(err) ? err.message : 'Failed to load settings');
        }
      }
    } finally {
      if (isMounted()) setIsLoading(false);
    }
  }, [api, isMounted]);

  useEffect(() => {
    void fetchSettings();
  }, [fetchSettings]);

  const updateSettings = useCallback(
    async (updates: Partial<T>) => {
      if (!settings) return;
      try {
        setIsSaving(true);
        setError(null);
        const data = await api.patch<T>('/system-settings', updates, { ifMatch: settings.version.toString() });
        if (isMounted()) setSettings(data);
      } catch (err) {
        if (isPlatformApiError(err) && err.status === 409) {
          await fetchSettings();
          throw new Error('Settings were updated elsewhere. Please review and try again.');
        }
        if (isMounted()) setError(isPlatformApiError(err) ? err.message : 'Failed to save settings');
        throw err;
      } finally {
        if (isMounted()) setIsSaving(false);
      }
    },
    [api, settings, fetchSettings, isMounted],
  );

  const replaceSettings = useCallback(
    async (next: Omit<T, 'updatedAt' | 'updatedBy' | 'version'>) => {
      try {
        setIsSaving(true);
        setError(null);
        const data = await api.put<T>('/system-settings', next);
        if (isMounted()) setSettings(data);
      } catch (err) {
        if (isMounted()) setError(isPlatformApiError(err) ? err.message : 'Failed to save settings');
        throw err;
      } finally {
        if (isMounted()) setIsSaving(false);
      }
    },
    [api, isMounted],
  );

  return { settings, isLoading, error, isSaving, updateSettings, replaceSettings, refresh: fetchSettings };
}
