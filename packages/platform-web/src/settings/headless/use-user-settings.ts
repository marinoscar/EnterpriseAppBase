// `GET` / `PATCH /user-settings` (issue #733; moved from the reference app's
// `hooks/useUserSettings.ts`, behaviour unchanged). The theme sync is the
// app's: it passes `applyTheme` (its theme context's setter).

import { THEME_PREFERENCES } from '@marinoscar/platform-contract/settings';
import type { ThemePreference, ThemePreferenceId, UserSettingsResponseBase } from '@marinoscar/platform-contract/settings';
import { useCallback, useEffect, useState } from 'react';

import { isPlatformApiError } from '../../core/index.js';
import { useIsMounted } from '../internal/use-is-mounted.js';
import { useSettingsApi, type SettingsHookOptions } from './use-system-settings.js';

/**
 * The least a user settings document carries for the hook: its theme, its
 * profile and the row version.
 *
 * @stability experimental
 */
export interface UserSettingsDocument {
  /** The theme preference: light, dark, system, or an id an app registered. */
  theme: ThemePreferenceId;
  /** The profile preferences. */
  profile: unknown;
  /** The row version. */
  version: number;
  /** The extra themes the API accepts (`registerThemePreference`); absent when none. */
  themeOptions?: readonly { id: string; label: string }[];
}

/**
 * The least a user settings PATCH body may carry for the hook.
 *
 * @stability experimental
 */
export interface UserSettingsUpdateBase {
  /** A new theme preference: light, dark, system, or an id an app registered. */
  theme?: ThemePreferenceId;
  /** New profile preferences. */
  profile?: unknown;
}

/**
 * Options of {@link useUserSettings}.
 *
 * @stability experimental
 */
export interface UseUserSettingsOptions extends SettingsHookOptions {
  /**
   * Whether loading and saving push the stored theme into `applyTheme`.
   * Light, dark and system are always pushed; a theme an app registered
   * (`registerThemePreference`) is pushed when the document lists it in
   * `themeOptions`, so an id the deployment no longer offers never reaches the
   * app's theme context. Default `true`. Pass `false` from always-present chrome
   * (the AppBar, the rail): there, syncing would stamp the stored theme back over
   * a toggle the user just flipped on every refetch.
   */
  syncTheme?: boolean;
  /** Applies a theme preference to the app (its theme context's setter). Keep it stable. */
  applyTheme?(theme: ThemePreferenceId): void;
}

/**
 * What {@link useUserSettings} returns.
 *
 * @typeParam T - the app's user settings document type.
 * @typeParam U - the PATCH body type.
 *
 * @stability experimental
 */
export interface UseUserSettingsResult<T extends UserSettingsDocument, U> {
  /** The document, or `null` until loaded. */
  settings: T | null;
  /** Whether a load is in flight. */
  isLoading: boolean;
  /** The last error's message, or `null`. */
  error: string | null;
  /** Whether a save is in flight. */
  isSaving: boolean;
  /** `PATCH` with the loaded version as `If-Match`; a 409 refetches and throws. */
  updateSettings: (updates: U) => Promise<void>;
  /** `PATCH { theme }`. */
  updateTheme: (theme: ThemePreferenceId) => Promise<void>;
  /** `PATCH { profile }`. */
  updateProfile: (profile: T['profile']) => Promise<void>;
  /** Reloads the document. */
  refresh: () => Promise<void>;
  /**
   * Adopts a document another endpoint already returned (the profile-image
   * upload), version included, so the next PATCH sends the current `If-Match`.
   */
  replaceSettings: (next: T) => void;
}

/** Whether `theme` is one of the three built-in preferences. */
function isBuiltinTheme(theme: unknown): theme is ThemePreference {
  return (THEME_PREFERENCES as readonly unknown[]).includes(theme);
}

/**
 * Whether `applyTheme` should receive `theme`: a built-in preference, or an id the
 * settings document lists in `themeOptions` (one the API registered and accepts).
 */
function isAppliableTheme(theme: unknown, document: { themeOptions?: readonly { id: string }[] } | null | undefined): theme is string {
  if (isBuiltinTheme(theme)) return true;
  return typeof theme === 'string' && (document?.themeOptions?.some((option) => option.id === theme) ?? false);
}

/**
 * The signed-in user's own settings (`user_settings:read|write`).
 *
 * @param options - see {@link UseUserSettingsOptions}.
 * @returns the document and its actions.
 *
 * @example
 * ```ts
 * const { setMode } = useThemeContext();
 * const { settings, updateTheme } = useUserSettings<AppUserSettings>({ applyTheme: setMode });
 * ```
 *
 * @extensionPoint hook
 * @stability experimental
 */
export function useUserSettings<
  T extends UserSettingsDocument = UserSettingsResponseBase,
  U extends UserSettingsUpdateBase = Partial<T>,
>(options: UseUserSettingsOptions = {}): UseUserSettingsResult<T, U> {
  const { syncTheme = true, applyTheme } = options;
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
      const data = await api.get<T>('/user-settings');
      if (isMounted()) {
        setSettings(data);
        if (syncTheme && applyTheme && isAppliableTheme(data.theme, data)) applyTheme(data.theme);
      }
    } catch (err) {
      if (isMounted()) setError(isPlatformApiError(err) ? err.message : 'Failed to load settings');
    } finally {
      if (isMounted()) setIsLoading(false);
    }
  }, [api, applyTheme, syncTheme, isMounted]);

  useEffect(() => {
    void fetchSettings();
  }, [fetchSettings]);

  const updateSettings = useCallback(
    async (updates: U) => {
      if (!settings) return;
      try {
        setIsSaving(true);
        setError(null);
        const data = await api.patch<T>('/user-settings', updates, { ifMatch: settings.version.toString() });
        if (isMounted()) {
          setSettings(data);
          if (syncTheme && applyTheme && isAppliableTheme(updates.theme, data)) applyTheme(updates.theme as string);
        }
      } catch (err) {
        if (isPlatformApiError(err) && err.status === 409) {
          await fetchSettings();
          throw new Error('Settings were updated elsewhere. Please try again.');
        }
        if (isMounted()) setError(isPlatformApiError(err) ? err.message : 'Failed to save settings');
        throw err;
      } finally {
        if (isMounted()) setIsSaving(false);
      }
    },
    [api, settings, applyTheme, syncTheme, fetchSettings, isMounted],
  );

  const updateTheme = useCallback(
    async (theme: ThemePreferenceId) => {
      await updateSettings({ theme } as U);
    },
    [updateSettings],
  );

  const updateProfile = useCallback(
    async (profile: T['profile']) => {
      await updateSettings({ profile } as U);
    },
    [updateSettings],
  );

  return {
    settings,
    isLoading,
    error,
    isSaving,
    updateSettings,
    updateTheme,
    updateProfile,
    refresh: fetchSettings,
    replaceSettings: setSettings,
  };
}
