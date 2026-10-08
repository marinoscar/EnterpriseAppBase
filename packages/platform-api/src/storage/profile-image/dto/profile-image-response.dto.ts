import type { Type } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { composeUserSettingsResponseSchema } from '../../../settings/index';

/**
 * Body of `POST` and `DELETE /api/user-settings/profile-image` (#367), inside
 * the global `{ data }` envelope: the updated settings plus the picture that
 * now represents the user (same resolution as `GET /api/auth/me`).
 *
 * Built from the COMPOSED user-settings response schema, so it is created
 * after every user-settings namespace is registered (by
 * `createProfileImageController()`), never at import time.
 *
 * @returns the zod schema.
 *
 * @internal
 *
 * @stability experimental
 */
export function profileImageResponseSchema() {
  return z.object({
    settings: composeUserSettingsResponseSchema(),
    // Same-origin path (`/api/users/<id>/avatar/<objectId>`), provider URL, or null.
    profileImageUrl: z.string().nullable(),
  });
}

/**
 * {@link profileImageResponseSchema} as a Nest DTO named `ProfileImageResponseDto`.
 *
 * @returns the DTO class.
 *
 * @internal
 *
 * @stability experimental
 */
export function createProfileImageResponseDto(): Type<unknown> {
  class ProfileImageResponseDto extends createZodDto(profileImageResponseSchema()) {}
  return ProfileImageResponseDto;
}
