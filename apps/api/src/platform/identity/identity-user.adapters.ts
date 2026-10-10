import { Injectable } from '@nestjs/common';
import type { IdentityProfileImages, UserDefaults } from '@marinoscar/platform-api/identity';

import { normalizeProfileSettings, resolveProfileImageUrl } from '@marinoscar/platform-api/storage';
import { DEFAULT_USER_SETTINGS } from '../../common/types/settings.types';

// =============================================================================
// USER_DEFAULTS and IDENTITY_PROFILE_IMAGES -> the app's user settings (#727)
// =============================================================================
//
// A user's settings row and their picture belong to the settings and storage
// slices, which identity does not import. These two adapters hand identity the
// app's defaults (`DEFAULT_USER_SETTINGS`, written into a new user's
// `user_settings` row) and its picture rule (`profile.imageSource`, #367).
// =============================================================================

/** The reference app's {@link UserDefaults}: `DEFAULT_USER_SETTINGS`. */
@Injectable()
export class AppUserDefaults implements UserDefaults {
  userSettings(): Record<string, unknown> {
    return structuredClone(DEFAULT_USER_SETTINGS) as unknown as Record<string, unknown>;
  }
}

/** The reference app's {@link IdentityProfileImages}: the #367 picture rule. */
@Injectable()
export class AppProfileImages implements IdentityProfileImages {
  resolveImageUrl(user: { id: string; providerProfileImageUrl: string | null }, storedProfile: unknown): string | null {
    return resolveProfileImageUrl(user, storedProfile);
  }

  hasUploadedImage(storedProfile: unknown): boolean {
    return normalizeProfileSettings(storedProfile).imageObjectId !== null;
  }
}
