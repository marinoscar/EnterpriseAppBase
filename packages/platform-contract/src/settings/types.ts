// The settings slice's response envelopes as plain types (issue #733). Zod-free:
// the web hooks take these as the default type of their documents, and an app
// that registers its own namespaces passes a wider type of its own.

import type { ProfileImageSource, ThemePreference } from './constants.js';

/**
 * The core fields of `GET /api/system-settings`: the session policy (derived
 * configuration, never stored), the audit fields and the row version for
 * `If-Match`. Every registered system namespace is a further property; an
 * app types them by extending this interface.
 *
 * @stability experimental
 */
export interface SystemSettingsResponseBase {
  /** The session policy the token signer uses (read only). */
  security: { jwtAccessTtlMinutes: number; refreshTtlDays: number };
  /** When the row last changed (ISO 8601). */
  updatedAt: string;
  /** Who last changed it, or `null`. */
  updatedBy: { id: string; email: string } | null;
  /** The row version; send it back as `If-Match`. */
  version: number;
}

/**
 * The core fields of `GET /api/user-settings`. Every optional user namespace
 * the user has stored something for is a further property (absent means
 * "apply the built-in defaults").
 *
 * @stability experimental
 */
export interface UserSettingsResponseBase {
  /** The theme preference. */
  theme: ThemePreference;
  /** The profile preferences; `imageObjectId` is `null` when nothing is uploaded. */
  profile: {
    displayName?: string | null;
    imageSource: ProfileImageSource;
    imageObjectId: string | null;
  };
  /** When the row last changed (ISO 8601). */
  updatedAt: string;
  /** The row version; send it back as `If-Match`. */
  version: number;
}
