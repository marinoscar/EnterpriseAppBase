/**
 * Settings → Appearance (`/settings/appearance`).
 *
 * Issue #96, epic #90. The Theme card of the stacked `UserSettingsPage`, now an
 * addressable route. THIN BY DESIGN: `ThemeSettings` is not touched, not
 * copied, and not re-styled. Every line of shared page chrome lives in
 * `UserSettingsSection`.
 *
 * This edits the signed-in user's own theme, never a deployment-wide default —
 * there is no admin-side equivalent. The `User` filename prefix follows the
 * same convention as this page's siblings (`UserSettingsPage.tsx`,
 * `UserNotificationsPage.tsx`, ...), keeping every per-user settings page
 * distinct from admin pages in `App.tsx`'s lazy imports.
 *
 * The title and description mirror the `Appearance` card in
 * `config/userSettingsSections.tsx` so the hub card, the compact AppBar title
 * (#95) and the page's own `h1` all name the page identically.
 */

import { themePreferenceOptions } from '../headless/theme-options.js';
import { ThemeSettings } from './ThemeSettings.js';
import type { ThemeSettingsSlots } from './ThemeSettings.js';
import { UserSettingsSection } from './UserSettingsSection.js';

/**
 * Props of {@link UserAppearancePage}.
 *
 * @stability experimental
 */
export interface UserAppearancePageProps {
  /** Part overrides of the theme card (`ExtraFields`). */
  slots?: ThemeSettingsSlots;
}

/**
 * Settings, Appearance (`/settings/appearance`): light, dark or system, and
 * any theme an app registered with `registerThemePreference` (listed in the
 * settings document's `themeOptions`). The stored preference reaches the app's
 * theme through the host's `applyTheme` (light, dark and system; an app applies
 * a theme it registered itself).
 *
 * @param props - see {@link UserAppearancePageProps}.
 * @returns the page.
 *
 * @example
 * ```tsx
 * <Route path="/settings/appearance" element={<UserAppearancePage />} />
 * ```
 *
 * @extensionPoint component
 * @stability experimental
 */
export function UserAppearancePage({ slots }: UserAppearancePageProps = {}) {
  return (
    <UserSettingsSection
      title="Appearance"
      description="Choose a light, dark, or system-matched theme for this account."
    >
      {({ settings, isSaving, save }) => (
        <ThemeSettings
          currentTheme={settings.theme}
          // The stacked page's `handleThemeChange`, message for message. The
          // returned promise is intentionally dropped: `onThemeChange` is typed
          // `void`, and `save` reports its own failures through the snackbar
          // rather than rejecting.
          onThemeChange={(theme) => {
            void save(
              { theme },
              { success: 'Theme updated', failure: 'Failed to update theme' },
            );
          }}
          disabled={isSaving}
          extraOptions={themePreferenceOptions(settings)}
          slots={slots}
        />
      )}
    </UserSettingsSection>
  );
}
