// The wire schemas live in @marinoscar/platform-contract/notifications since
// #738 (moved from this file with their meaning unchanged; channel ids are
// open). This file wraps them as DTOs and re-exports them under their old
// names, so the controllers and their importers did not change.

import { createZodDto } from 'nestjs-zod';
import { removePushConfigSchema, rotatePushConfigSchema } from '@marinoscar/platform-contract/notifications';

export {
  REMOVE_CONFIRMATION,
  ROTATE_CONFIRMATION,
  removePushConfigSchema,
  rotatePushConfigSchema,
} from '@marinoscar/platform-contract/notifications';
export type { RemovePushConfigInput, RotatePushConfigInput } from '@marinoscar/platform-contract/notifications';

/**
 * `POST /api/admin/push-config/rotate` body.
 *
 * @stability stable
 */
export class RotatePushConfigDto extends createZodDto(rotatePushConfigSchema) {}

/**
 * `DELETE /api/admin/push-config` body.
 *
 * @stability stable
 */
export class RemovePushConfigDto extends createZodDto(removePushConfigSchema) {}
