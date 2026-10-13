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

import type { PageSlotsBase } from '../../core/index.js';
import { ThemeSettings } from './ThemeSettings.js';
import { UserSettingsSection } from './UserSettingsSection.js';

/**
 * The slots of {@link UserAppearancePage}: the page-slot contract. `Sections`
 * is where an app adds a section of its own (a public handle, a timezone)
 * above or below the profile card.
 *
 * @example
 * ```tsx
 * <UserAppearancePage slots={{ Sections: ({ position }) => (position === 'bottom' ? <DensityCard /> : null) }} />
 * ```
 *
 * @extensionPoint slot
 * @stability experimental
 */
export type UserAppearancePageSlots = PageSlotsBase;

/**
 * The props of {@link UserAppearancePage}.
 *
 * @stability experimental
 */
export interface UserAppearancePageProps {
  /** Optional extension slots; omitted, the page renders exactly as it always did. */
  slots?: UserAppearancePageSlots;
}

/**
 * Settings, Appearance (`/settings/appearance`): light, dark or system. The
 * stored preference reaches the app's theme through the host's `applyTheme`.
 *
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
export function UserAppearancePage(props: UserAppearancePageProps = {}) {
  return (
    <UserSettingsSection
      slots={props.slots}
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
        />
      )}
    </UserSettingsSection>
  );
}
