import { useState, useEffect, useCallback } from 'react';
import { api, ApiError } from '../services/api';
import { UserSettings, UserSettingsUpdate } from '../types';
import { useThemeContext } from '../contexts/ThemeContext';

interface UseUserSettingsOptions {
  /**
   * Whether loading/saving settings should push the theme into ThemeContext.
   * Defaults to `true`, which is what the settings page wants.
   *
   * Pass `false` when mounting this hook from always-present chrome (AppBar,
   * navigation rail, layout shells). There, syncing would make the STORED
   * theme authoritative on every page load: the moment the user flips the
   * AppBar's light/dark toggle, any refetch — or simply navigating to a route
   * that remounts the chrome — calls setMode() with the persisted value and
   * stamps the toggle right back. Do not "simplify" this option away.
   */
  syncTheme?: boolean;
}

interface UseUserSettingsReturn {
  settings: UserSettings | null;
  isLoading: boolean;
  error: string | null;
  isSaving: boolean;
  updateSettings: (updates: UserSettingsUpdate) => Promise<void>;
  updateTheme: (theme: 'light' | 'dark' | 'system') => Promise<void>;
  updateProfile: (profile: UserSettings['profile']) => Promise<void>;
  refresh: () => Promise<void>;
}

export function useUserSettings(options: UseUserSettingsOptions = {}): UseUserSettingsReturn {
  const { syncTheme = true } = options;
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const { setMode } = useThemeContext();

  const fetchSettings = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await api.get<UserSettings>('/user-settings');
      setSettings(data);
      // Sync theme with settings (opt-out via syncTheme: false)
      if (syncTheme) {
        setMode(data.theme);
      }
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to load settings';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [setMode, syncTheme]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const updateSettings = useCallback(
    async (updates: UserSettingsUpdate) => {
      if (!settings) return;

      try {
        setIsSaving(true);
        setError(null);

        const data = await api.patch<UserSettings>('/user-settings', updates, {
          headers: {
            'If-Match': settings.version.toString(),
          },
        });

        setSettings(data);

        // Sync theme if changed (opt-out via syncTheme: false)
        if (syncTheme && updates.theme) {
          setMode(updates.theme);
        }
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          // Version conflict - refresh and retry
          await fetchSettings();
          throw new Error('Settings were updated elsewhere. Please try again.');
        }
        const message = err instanceof ApiError ? err.message : 'Failed to save settings';
        setError(message);
        throw err;
      } finally {
        setIsSaving(false);
      }
    },
    [settings, setMode, syncTheme, fetchSettings],
  );

  const updateTheme = useCallback(
    async (theme: 'light' | 'dark' | 'system') => {
      await updateSettings({ theme });
    },
    [updateSettings],
  );

  const updateProfile = useCallback(
    async (profile: UserSettings['profile']) => {
      await updateSettings({ profile });
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
  };
}
