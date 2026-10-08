import { createZodDto } from 'nestjs-zod';
import {
  adminReleaseSchema,
  androidAppResponseSchema,
  androidAppTestNotificationRequestSchema,
  androidAppTestNotificationResponseSchema,
  downloadLinkSchema,
  publicReleaseSchema,
  updateAndroidAppSchema,
} from '@marinoscar/platform-contract/android-app';

/**
 * `PUT /api/admin/android-app` body (OpenAPI only: the pipe validates).
 *
 * @stability experimental
 */
export class UpdateAndroidAppDto extends createZodDto(updateAndroidAppSchema) {}

/**
 * `GET`/`PUT /api/admin/android-app` response.
 *
 * @stability experimental
 */
export class AndroidAppResponseDto extends createZodDto(androidAppResponseSchema) {}

/**
 * `POST /api/admin/android-app/test-notification` body.
 *
 * @stability experimental
 */
export class AndroidAppTestNotificationRequestDto extends createZodDto(androidAppTestNotificationRequestSchema) {}

/**
 * The test notification response.
 *
 * @stability experimental
 */
export class AndroidAppTestNotificationResponseDto extends createZodDto(androidAppTestNotificationResponseSchema) {}

/**
 * A release, as any signed-in user sees it.
 *
 * @stability experimental
 */
export class PublicReleaseDto extends createZodDto(publicReleaseSchema) {}

/**
 * A release, as an administrator sees it.
 *
 * @stability experimental
 */
export class AdminReleaseDto extends createZodDto(adminReleaseSchema) {}

/**
 * A signed download link.
 *
 * @stability experimental
 */
export class DownloadLinkDto extends createZodDto(downloadLinkSchema) {}
