// =============================================================================
// The themes an app registered, as the settings document lists them (PP-14.21)
// =============================================================================
//
// `registerThemePreference` of `@marinoscar/platform-api/settings` adds a theme
// id the API accepts, and `GET /api/user-settings` lists the registered ones in
// `themeOptions` (absent when there are none). The theme control offers them
// after light, dark and system. How a registered theme LOOKS, and how the app
// applies the stored id, is the app's theme registry; this is only the list of
// choices.
// =============================================================================

import type { ThemeOption } from '@marinoscar/platform-contract/settings';
import { useMemo } from 'react';

const NONE: readonly ThemeOption[] = Object.freeze([]);

/**
 * The extra themes a user settings document lists.
 *
 * @param settings - the document, or `null` while it loads.
 * @returns the registered themes, in registration order; the same empty array when there are none.
 *
 * @stability experimental
 */
export function themePreferenceOptions(settings: { themeOptions?: readonly ThemeOption[] } | null | undefined): readonly ThemeOption[] {
  const options = settings?.themeOptions;
  return options && options.length > 0 ? options : NONE;
}

/**
 * {@link themePreferenceOptions} as a hook, for a component that holds the
 * document in state. (A render-prop callback such as `UserSettingsSection`'s
 * `children` is not a place to call a hook: use the function.)
 *
 * @param settings - the document, or `null` while it loads.
 * @returns the registered themes.
 *
 * @example
 * ```tsx
 * const { settings } = useUserSettings();
 * <ThemeSettings currentTheme={settings.theme} onThemeChange={save} extraOptions={useThemePreferenceOptions(settings)} />
 * ```
 *
 * @extensionPoint hook
 * @stability experimental
 */
export function useThemePreferenceOptions(settings: { themeOptions?: readonly ThemeOption[] } | null | undefined): readonly ThemeOption[] {
  const options = settings?.themeOptions;
  return useMemo(() => themePreferenceOptions({ themeOptions: options }), [options]);
}
