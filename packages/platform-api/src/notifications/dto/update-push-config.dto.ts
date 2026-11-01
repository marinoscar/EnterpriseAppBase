// The wire schemas live in @marinoscar/platform-contract/notifications since
// #738 (moved from this file with their meaning unchanged; channel ids are
// open). This file wraps them as DTOs and re-exports them under their old
// names, so the controllers and their importers did not change.

import { createZodDto } from 'nestjs-zod';
import { updatePushConfigSchema } from '@marinoscar/platform-contract/notifications';

export { updatePushConfigSchema } from '@marinoscar/platform-contract/notifications';
export type { UpdatePushConfigInput } from '@marinoscar/platform-contract/notifications';

/**
 * `PUT /api/admin/push-config` body.
 *
 * @stability stable
 */
export class UpdatePushConfigDto extends createZodDto(updatePushConfigSchema) {}
