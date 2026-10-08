// The wire schemas live in @marinoscar/platform-contract/notifications since
// #738 (moved from this file with their meaning unchanged; channel ids are
// open). This file wraps them as DTOs and re-exports them under their old
// names, so the controllers and their importers did not change.

import { createZodDto } from 'nestjs-zod';
import { notificationEventSchema } from '@marinoscar/platform-contract/notifications';

export { notificationEventSchema } from '@marinoscar/platform-contract/notifications';
export type { NotificationEventResponse } from '@marinoscar/platform-contract/notifications';

/**
 * One event as `GET /api/notifications/events` serves it.
 *
 * @stability stable
 */
export class NotificationEventDto extends createZodDto(notificationEventSchema) {}
