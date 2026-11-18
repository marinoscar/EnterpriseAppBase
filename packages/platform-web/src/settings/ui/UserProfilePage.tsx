/**
 * Settings → Profile (`/settings/profile`).
 *
 * Issue #96, epic #90. The Profile card of the stacked `UserSettingsPage`, now
 * an addressable route. THIN BY DESIGN: `ProfileSettings` is not touched, not
 * copied, and not re-styled — this issue moves where the component is reached
 * from, nothing about what it renders. Every line of shared page chrome (the
 * hook, the spinner, the fetch-error alert, the snackbars) lives in
 * `UserSettingsSection`.
 *
 * The title and description mirror the `Profile` card in
 * `config/userSettingsSections.tsx` so the hub card, the compact AppBar title
 * (#95) and the page's own `h1` all name the page identically.
 */

import type { PageSlotsBase } from '../../core/index.js';
import { ProfileSettings } from './ProfileSettings.js';
import type { ProfileSettingsSlots } from './ProfileSettings.js';
import { UserSettingsSection } from './UserSettingsSection.js';

/**
 * The slots of {@link UserProfilePage}: the page-slot contract, and the profile
 * card's own part overrides ({@link ProfileSettingsSlots}: `ExtraFields`, the
 * fields an app added with `extendUserProfile`). `Sections` is where an app
 * adds a section of its own (a public handle) above or below the profile card.
 *
 * @example
 * ```tsx
 * <UserProfilePage slots={{ Sections: ({ position }) => (position === 'bottom' ? <PublicHandleCard /> : null) }} />
 * ```
 *
 * @extensionPoint slot
 * @stability experimental
 */
export interface UserProfilePageSlots extends PageSlotsBase, ProfileSettingsSlots {}

/**
 * Props of {@link UserProfilePage}.
 *
 * @stability experimental
 */
export interface UserProfilePageProps {
  /** The page-slot contract's slots and the profile card's part overrides (`ExtraFields`). */
  slots?: UserProfilePageSlots;
}

/**
 * Settings, Profile (`/settings/profile`): the display name, the profile
 * picture and the time zone every time is shown in, and the fields an app added with `extendUserProfile` when it passes
 * the `ExtraFields` slot. Every user edits their own; the API grants it to all
 * roles, so the page carries no permission gate.
 *
 * @param props - see {@link UserProfilePageProps}.
 * @returns the page.
 *
 * @example
 * ```tsx
 * <Route path="/settings/profile" element={<UserProfilePage />} />
 * ```
 *
 * @extensionPoint component
 * @stability experimental
 */
export function UserProfilePage({ slots }: UserProfilePageProps = {}) {
  return (
    <UserSettingsSection
      slots={slots}
      title="Profile"
      description="Your display name, profile image and time zone, and the email you signed in with."
    >
      {({ settings, isSaving, save, replaceSettings }) => (
        <ProfileSettings
          profile={settings.profile}
          // The stacked page's `handleProfileSave`, message for message.
          onSave={(profile) =>
            save(
              { profile },
              { success: 'Profile updated', failure: 'Failed to update profile' },
            )
          }
          // Upload/remove return the new settings document (#367); adopting it
          // keeps the stored `version` current for the next PATCH.
          onSettingsReplaced={replaceSettings}
          disabled={isSaving}
          slots={slots}
        />
      )}
    </UserSettingsSection>
  );
}
