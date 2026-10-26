// =============================================================================
// Example: a field in the core user `profile`, and an extra theme (PP-14.21)
// =============================================================================
//
// `profile` and `theme` are core fields of a user's settings document, outside
// the namespace registries. `extendUserProfile` adds an optional, bounded field
// to the profile (`pronouns`); `registerThemePreference` adds a theme id the
// API accepts and lists in `themeOptions`. Both are called at import time,
// before `SettingsModule.forRoot()` composes the request bodies; the reference
// app does not call them, so its documents are unchanged. (The time zone is a
// core profile field, not an extension.)
//
// The module augmentation types the added profile field for every reader of
// `UserSettingsValue['profile']`.
// =============================================================================

import { extendUserProfile, registerThemePreference } from '@marinoscar/platform-api/settings';
import { z } from 'zod';

/** Free-text pronouns; bounded because the user writes them themselves. */
export const PROFILE_PRONOUNS_FIELDS = z.object({ pronouns: z.string().max(32).optional() });

/** Adds `profile.pronouns`. Call once, at import time. */
export function registerProfilePronouns(): void {
  extendUserProfile({ fields: PROFILE_PRONOUNS_FIELDS });
}

/** Adds the `high-contrast` theme id. Call once, at import time. */
export function registerHighContrastTheme(): void {
  registerThemePreference({ id: 'high-contrast', label: 'High contrast' });
}

declare module '@marinoscar/platform-api/settings' {
  interface UserProfileSettingsExtensions {
    /** The user's pronouns (`she/her`), when they chose to share them. */
    pronouns?: string;
  }
}
