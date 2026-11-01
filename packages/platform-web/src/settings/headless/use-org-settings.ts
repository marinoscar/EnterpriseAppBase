// `GET` / `PATCH /org-settings` (issue #733): the active organization's
// settings overrides, the effective value of each org-overridable namespace,
// and the namespace descriptors a generated form renders. Same contract as
// the other settings hooks; `org_settings:read` to load, `org_settings:write`
// (and the namespace's own write permission) to save.

import type { OrgSettingsResponse, PatchOrgSettingsBody } from '@marinoscar/platform-contract/settings';
import { useCallback, useEffect, useState } from 'react';

import { isPlatformApiError } from '../../core/index.js';
import { useIsMounted } from '../internal/use-is-mounted.js';
import { useSettingsApi, type SettingsHookOptions } from './use-system-settings.js';

/**
 * What {@link useOrgSettings} returns.
 *
 * @stability experimental
 */
export interface UseOrgSettingsResult {
  /** The payload, or `null` until loaded. */
  settings: OrgSettingsResponse | null;
  /** Whether a load is in flight. */
  isLoading: boolean;
  /** The last error's message, or `null`. */
  error: string | null;
  /** Whether a save is in flight. */
  isSaving: boolean;
  /**
   * `PATCH` with the loaded version as `If-Match`. `null` clears a namespace
   * (or, inside one, a field). A 409 refetches and throws.
   */
  patch: (body: PatchOrgSettingsBody) => Promise<void>;
  /** Reloads the payload. */
  refresh: () => Promise<void>;
}

/**
 * The active organization's settings overrides.
 *
 * @param options - see {@link SettingsHookOptions}.
 * @returns the payload and its actions.
 *
 * @example
 * ```ts
 * const { settings, patch } = useOrgSettings();
 * await patch({ exportPolicy: { enabled: false } });
 * ```
 *
 * @extensionPoint hook
 * @stability experimental
 */
export function useOrgSettings(options?: SettingsHookOptions): UseOrgSettingsResult {
  const api = useSettingsApi(options);
  const [settings, setSettings] = useState<OrgSettingsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const isMounted = useIsMounted();

  const fetchSettings = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await api.get<OrgSettingsResponse>('/org-settings');
      if (isMounted()) setSettings(data);
    } catch (err) {
      if (isMounted()) {
        if (isPlatformApiError(err) && err.status === 403) {
          setError('You do not have permission to view the organization settings');
        } else {
          setError(isPlatformApiError(err) ? err.message : 'Failed to load the organization settings');
        }
      }
    } finally {
      if (isMounted()) setIsLoading(false);
    }
  }, [api, isMounted]);

  useEffect(() => {
    void fetchSettings();
  }, [fetchSettings]);

  const patch = useCallback(
    async (body: PatchOrgSettingsBody) => {
      if (!settings) return;
      try {
        setIsSaving(true);
        setError(null);
        const data = await api.patch<OrgSettingsResponse>('/org-settings', body, { ifMatch: settings.version.toString() });
        if (isMounted()) setSettings(data);
      } catch (err) {
        if (isPlatformApiError(err) && err.status === 409) {
          await fetchSettings();
          throw new Error('The organization settings were updated elsewhere. Please review and try again.');
        }
        if (isMounted()) setError(isPlatformApiError(err) ? err.message : 'Failed to save the organization settings');
        throw err;
      } finally {
        if (isMounted()) setIsSaving(false);
      }
    },
    [api, settings, fetchSettings, isMounted],
  );

  return { settings, isLoading, error, isSaving, patch, refresh: fetchSettings };
}
