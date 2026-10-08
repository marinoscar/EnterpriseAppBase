/**
 * The signed-in user's own settings, bound to this app (#733).
 *
 * The hook is the settings slice's (`useUserSettings` of
 * `@marinoscar/platform-web/settings/headless`); this binding supplies the
 * app's document and update types, its transport (`appPlatformApi`) and its
 * theme context (`ThemeContext.setMode`), which the package cannot know.
 *
 * `syncTheme` (default `true`): whether loading/saving pushes the stored
 * theme into ThemeContext. Pass `false` when mounting this hook from
 * always-present chrome (AppBar, navigation rail, layout shells). There,
 * syncing would make the STORED theme authoritative on every page load: the
 * moment the user flips the AppBar's light/dark toggle, any refetch — or
 * simply navigating to a route that remounts the chrome — calls setMode()
 * with the persisted value and stamps the toggle right back. Do not
 * "simplify" this option away.
 */
import { useUserSettings as usePlatformUserSettings } from '@marinoscar/platform-web/settings/headless';
import type { UseUserSettingsResult } from '@marinoscar/platform-web/settings/headless';

import { useThemeContext } from '../contexts/ThemeContext';
import { appPlatformApi } from '../platform/platformHost';
import type { UserSettings, UserSettingsUpdate } from '../types';

interface UseUserSettingsOptions {
  syncTheme?: boolean;
}

export function useUserSettings(
  options: UseUserSettingsOptions = {},
): UseUserSettingsResult<UserSettings, UserSettingsUpdate> {
  const { setMode } = useThemeContext();
  return usePlatformUserSettings<UserSettings, UserSettingsUpdate>({
    api: appPlatformApi,
    syncTheme: options.syncTheme ?? true,
    applyTheme: setMode,
  });
}
