// =============================================================================
// Example: a field in the core user `profile`, and an extra theme (PP-14.21)
// =============================================================================
//
// `profile` and `theme` are core fields of a user's settings document, outside
// the namespace registries. `extendUserProfile` adds an optional, bounded field
// to the profile (`timezone`); `registerThemePreference` adds a theme id the
// API accepts and lists in `themeOptions`. Both are called at import time,
// before `SettingsModule.forRoot()` composes the request bodies; the reference
// app does not call them, so its documents are unchanged. The web side of the
// timezone is `apps/web/src/platform-extensions/settings/TimezoneField.example.tsx`.
//
// The module augmentation types the added profile field for every reader of
// `UserSettingsValue['profile']`.
// =============================================================================

import { extendUserProfile, registerThemePreference } from '@marinoscar/platform-api/settings';
import { z } from 'zod';

/** An IANA time zone name; bounded because the user writes it themselves. */
export const PROFILE_TIMEZONE_FIELDS = z.object({ timezone: z.string().max(64).optional() });

/** Adds `profile.timezone`. Call once, at import time. */
export function registerProfileTimezone(): void {
  extendUserProfile({ fields: PROFILE_TIMEZONE_FIELDS });
}

/** Adds the `high-contrast` theme id. Call once, at import time. */
export function registerHighContrastTheme(): void {
  registerThemePreference({ id: 'high-contrast', label: 'High contrast' });
}

declare module '@marinoscar/platform-api/settings' {
  interface UserProfileSettingsExtensions {
    /** The user's IANA time zone (`Europe/Paris`), when they chose one. */
    timezone?: string;
  }
}
