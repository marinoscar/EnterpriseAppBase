// The wire schema lives in @marinoscar/platform-contract/notifications
// (PP-14.10). This file wraps it as a DTO for the controller and OpenAPI.

import { createZodDto } from 'nestjs-zod';
import { notificationChannelDescriptorSchema } from '@marinoscar/platform-contract/notifications';

export { notificationChannelDescriptorSchema } from '@marinoscar/platform-contract/notifications';
export type { NotificationChannelDescriptorResponse } from '@marinoscar/platform-contract/notifications';

/**
 * One delivery channel as `GET /api/notifications/channels` serves it.
 *
 * @stability experimental
 */
export class NotificationChannelDescriptorDto extends createZodDto(notificationChannelDescriptorSchema) {}
