// The wire schemas live in @marinoscar/platform-contract/notifications since
// #738 (moved from this file with their meaning unchanged; channel ids are
// open). This file wraps them as DTOs and re-exports them under their old
// names, so the controllers and their importers did not change.

import { createZodDto } from 'nestjs-zod';
import {
  notificationListQuerySchema,
  notificationSchema,
  unreadCountSchema,
} from '@marinoscar/platform-contract/notifications';

export {
  notificationListQuerySchema,
  notificationSchema,
  unreadCountSchema,
} from '@marinoscar/platform-contract/notifications';
export type {
  NotificationListResponse,
  NotificationResponse,
  UnreadCountResponse,
} from '@marinoscar/platform-contract/notifications';

/**
 * One inbox row.
 *
 * @stability stable
 */
export class NotificationDto extends createZodDto(notificationSchema) {}

/**
 * `GET /api/notifications` query.
 *
 * @stability stable
 */
export class NotificationListQueryDto extends createZodDto(notificationListQuerySchema) {}

/**
 * `GET /api/notifications/unread-count`.
 *
 * @stability stable
 */
export class UnreadCountDto extends createZodDto(unreadCountSchema) {}
