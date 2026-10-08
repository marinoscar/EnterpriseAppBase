// The wire schemas live in @marinoscar/platform-contract/notifications since
// #738 (moved from this file with their meaning unchanged; channel ids are
// open). This file wraps them as DTOs and re-exports them under their old
// names, so the controllers and their importers did not change.

import { createZodDto } from 'nestjs-zod';
import { notificationConfigSchema } from '@marinoscar/platform-contract/notifications';

export { notificationConfigSchema } from '@marinoscar/platform-contract/notifications';
export type { NotificationConfigResponse } from '@marinoscar/platform-contract/notifications';

/**
 * `GET /api/notifications/config`.
 *
 * @stability stable
 */
export class NotificationConfigDto extends createZodDto(notificationConfigSchema) {}
