// The wire schemas live in @marinoscar/platform-contract/notifications since
// #738 (moved from this file with their meaning unchanged; channel ids are
// open). This file wraps them as DTOs and re-exports them under their old
// names, so the controllers and their importers did not change.

import { createZodDto } from 'nestjs-zod';
import {
  pushSubscribeSchema,
  pushSubscriptionResponseSchema,
  pushUnsubscribeSchema,
} from '@marinoscar/platform-contract/notifications';

export {
  pushSubscribeSchema,
  pushSubscriptionResponseSchema,
  pushUnsubscribeSchema,
} from '@marinoscar/platform-contract/notifications';
export type {
  PushSubscribeRequest,
  PushSubscriptionResponse,
  PushUnsubscribeRequest,
} from '@marinoscar/platform-contract/notifications';

/**
 * `POST /api/notifications/push/subscriptions` body.
 *
 * @stability stable
 */
export class PushSubscribeDto extends createZodDto(pushSubscribeSchema) {}

/**
 * The subscribe response.
 *
 * @stability stable
 */
export class PushSubscriptionResponseDto extends createZodDto(pushSubscriptionResponseSchema) {}

/**
 * `DELETE /api/notifications/push/subscriptions` body.
 *
 * @stability stable
 */
export class PushUnsubscribeDto extends createZodDto(pushUnsubscribeSchema) {}
