// The wire schemas live in @marinoscar/platform-contract/notifications since
// #738 (moved from this file with their meaning unchanged). This file wraps
// them as DTOs and re-exports them under their old names.

import { createZodDto } from 'nestjs-zod';
import { createBroadcastSchema as wireCreateBroadcastSchema } from '@marinoscar/platform-contract/notifications';

import { notificationChannelRegistry } from '../../registry/channel.registry';

export {
  BROADCAST_BODY_MAX,
  BROADCAST_CTA_LABEL_MAX,
  BROADCAST_LINK_MAX,
  BROADCAST_TITLE_MAX,
} from '@marinoscar/platform-contract/notifications';
export type { CreateBroadcastInput } from '@marinoscar/platform-contract/notifications';

/**
 * The create body, with its open channel ids checked against the channel
 * registry at run time (#738): an unregistered channel is a 400, exactly as
 * the closed enum it replaces was.
 *
 * @stability stable
 */
export const createBroadcastSchema = wireCreateBroadcastSchema.superRefine((value, ctx) => {
  value.channels.forEach((channel, index) => {
    if (!notificationChannelRegistry.has(channel)) {
      ctx.addIssue({
        code: 'custom',
        path: ['channels', index],
        message: `"${channel}" is not a registered notification channel`,
      });
    }
  });
});

/**
 * `POST /api/admin/broadcasts` body.
 *
 * @stability stable
 */
export class CreateBroadcastDto extends createZodDto(createBroadcastSchema) {}

/**
 * `POST /api/admin/broadcasts/test` body (the same shape).
 *
 * @stability stable
 */
export class TestBroadcastDto extends createZodDto(createBroadcastSchema) {}
