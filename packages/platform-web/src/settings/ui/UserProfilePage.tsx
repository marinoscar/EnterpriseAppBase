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
import { UserSettingsSection } from './UserSettingsSection.js';

/**
 * The slots of {@link UserProfilePage}: the page-slot contract. `Sections`
 * is where an app adds a section of its own (a public handle, a timezone)
 * above or below the profile card.
 *
 * @example
 * ```tsx
 * <UserProfilePage slots={{ Sections: ({ position }) => (position === 'bottom' ? <PublicHandleCard /> : null) }} />
 * ```
 *
 * @extensionPoint slot
 * @stability experimental
 */
export type UserProfilePageSlots = PageSlotsBase;

/**
 * The props of {@link UserProfilePage}.
 *
 * @stability experimental
 */
export interface UserProfilePageProps {
  /** Optional extension slots; omitted, the page renders exactly as it always did. */
  slots?: UserProfilePageSlots;
}

/**
 * Settings, Profile (`/settings/profile`): the display name and the profile
 * picture. Every user edits their own; the API grants it to all roles, so the
 * page carries no permission gate.
 *
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
export function UserProfilePage(props: UserProfilePageProps = {}) {
  return (
    <UserSettingsSection
      slots={props.slots}
      title="Profile"
      description="Your display name and profile image, and the email you signed in with."
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
        />
      )}
    </UserSettingsSection>
  );
}
