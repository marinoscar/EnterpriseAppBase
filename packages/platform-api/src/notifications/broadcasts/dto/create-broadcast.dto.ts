// The wire schemas live in @marinoscar/platform-contract/notifications since
// #738 (moved from this file with their meaning unchanged). This file wraps
// them as DTOs and re-exports them under their old names.

import { createZodDto } from 'nestjs-zod';
import { createBroadcastSchema as wireCreateBroadcastSchema } from '@marinoscar/platform-contract/notifications';

import { criticalCapableChannels, notificationChannelRegistry } from '../../registry/channel.registry';

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
 * the closed enum it replaces was. A critical broadcast must include a channel
 * flagged `criticalCapable` (PP-14.10; `browser` unless an app flags another):
 * the durable record is the only thing a recipient can go back and read.
 *
 * @stability stable
 *
 * @internal
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

  if (value.critical) {
    const capable = criticalCapableChannels();
    if (capable.length > 0 && !value.channels.some((channel) => capable.includes(channel))) {
      const names = capable.map((id) => `"${id}"`);
      ctx.addIssue({
        code: 'custom',
        path: ['channels'],
        message:
          `a critical broadcast must include ${
            names.length === 1 ? `the ${names[0]} channel` : `one of the ${names.join(', ')} channels`
          }: the durable in-app notification is the only record a recipient can go back and read`,
      });
    }
  }
});

/**
 * `POST /api/admin/broadcasts` body.
 *
 * @stability stable
 *
 * @internal
 */
export class CreateBroadcastDto extends createZodDto(createBroadcastSchema) {}

/**
 * `POST /api/admin/broadcasts/test` body (the same shape).
 *
 * @stability stable
 *
 * @internal
 */
export class TestBroadcastDto extends createZodDto(createBroadcastSchema) {}
