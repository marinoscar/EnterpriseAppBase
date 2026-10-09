// The caller's own profile picture (`/user-settings/profile-image`, issue
// #367), over the platform host's transport. Moved from the reference app's
// `services/api.ts` (#892), behaviour unchanged: the server validates the
// bytes (JPEG, PNG, GIF, WebP, 5 MB) and answers 400 or 413 with a message.

import type { UserSettingsResponseBase } from '@marinoscar/platform-contract/settings';
import { useMemo } from 'react';

import { usePlatformApi } from '../../core/index.js';
import type { PlatformApiClient } from '../../core/index.js';

/**
 * What the upload and delete endpoints answer: the new settings document and
 * the resolved picture. The caller MUST adopt `settings` (its `version` moved)
 * or its next `If-Match` PATCH answers 409.
 *
 * @typeParam T - the app's user settings document type.
 *
 * @stability experimental
 */
export interface ProfileImageMutationResponse<T = UserSettingsResponseBase> {
  /** The settings document after the change. */
  settings: T;
  /** The resolved picture (same meaning as the user's `profileImageUrl`). */
  profileImageUrl: string | null;
}

/**
 * The profile picture calls.
 *
 * @stability experimental
 */
export interface ProfileImageClient {
  /**
   * `POST /user-settings/profile-image`: one multipart `file` part. The server
   * switches `profile.imageSource` to `upload` and deletes any previous upload.
   * Rejects when the transport has no `postFormData`.
   */
  upload(file: File): Promise<ProfileImageMutationResponse>;
  /** `DELETE /user-settings/profile-image`: an `upload` source falls back to `provider` server-side. */
  remove(): Promise<ProfileImageMutationResponse>;
  /**
   * `GET /user-settings/profile-image`: the stored picture, whatever
   * `profile.imageSource` selects (authenticated on purpose: the public avatar
   * route serves only the selected source). Rejects with a 404 when none
   * exists, or when the transport has no `getBlob`.
   */
  preview(): Promise<Blob>;
}

const PROFILE_IMAGE = '/user-settings/profile-image';

/**
 * Builds the profile picture client over a transport.
 *
 * @param api - the app's transport (the host's `api`).
 * @returns the client.
 *
 * @example
 * ```ts
 * const { settings } = await createProfileImageClient(api).upload(file);
 * ```
 *
 * @stability experimental
 */
export function createProfileImageClient(api: PlatformApiClient): ProfileImageClient {
  return {
    upload: async (file) => {
      if (typeof api.postFormData !== 'function') {
        throw new Error('This transport cannot send multipart/form-data: pass a client with postFormData.');
      }
      const formData = new FormData();
      formData.append('file', file);
      return api.postFormData<ProfileImageMutationResponse>(PROFILE_IMAGE, formData);
    },
    remove: () => api.delete<ProfileImageMutationResponse>(PROFILE_IMAGE),
    preview: async () => {
      if (typeof api.getBlob !== 'function') {
        throw new Error('This transport cannot download files: pass a client with getBlob.');
      }
      return (await api.getBlob(PROFILE_IMAGE)).blob;
    },
  };
}

/**
 * {@link createProfileImageClient} over the platform host's transport.
 *
 * @returns a client whose identity is stable while the host's `api` is.
 *
 * @stability experimental
 */
export function useProfileImageClient(): ProfileImageClient {
  const api = usePlatformApi();
  return useMemo(() => createProfileImageClient(api), [api]);
}
