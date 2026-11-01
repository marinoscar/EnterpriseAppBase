// The wire schemas live in @marinoscar/platform-contract/notifications since
// #738 (moved from this file with their meaning unchanged; channel ids are
// open). This file wraps them as DTOs and re-exports them under their old
// names, so the controllers and their importers did not change.

import { createZodDto } from 'nestjs-zod';
import { generatePushConfigSchema } from '@marinoscar/platform-contract/notifications';

export { generatePushConfigSchema } from '@marinoscar/platform-contract/notifications';
export type { GeneratePushConfigInput } from '@marinoscar/platform-contract/notifications';

/**
 * `POST /api/admin/push-config/generate` body.
 *
 * @stability stable
 */
export class GeneratePushConfigDto extends createZodDto(generatePushConfigSchema) {}
