// The wire schemas live in @marinoscar/platform-contract/notifications since
// #738 (moved from this file with their meaning unchanged). This file wraps
// them as DTOs and re-exports them under their old names.

import { createZodDto } from 'nestjs-zod';
import {
  BROADCAST_STATUSES,
  broadcastAudienceQuerySchema,
  broadcastAudienceSchema,
  broadcastCreateResultSchema,
  broadcastDeliveryCountSchema,
  broadcastDetailSchema,
  broadcastSchema,
  broadcastTestResultSchema,
  type BroadcastStatusName,
} from '@marinoscar/platform-contract/notifications';

import type { NotificationBroadcastStatus } from '../../data/notifications-db';

export {
  BROADCAST_STATUSES,
  broadcastAudienceQuerySchema,
  broadcastAudienceSchema,
  broadcastCreateResultSchema,
  broadcastDeliveryCountSchema,
  broadcastDetailSchema,
  broadcastSchema,
  broadcastTestResultSchema,
} from '@marinoscar/platform-contract/notifications';
export type { BroadcastStatusName } from '@marinoscar/platform-contract/notifications';

type Exhaustive<Enum extends string, Listed extends string> = [Exclude<Enum, Listed>] extends [never] ? true : never;

/**
 * Compile-time proof that the contract's status list and the fragment's
 * enum agree in both directions.
 *
 * @stability stable
 */
export type BroadcastStatusesAreExhaustive = Exhaustive<NotificationBroadcastStatus, BroadcastStatusName> &
  Exhaustive<BroadcastStatusName, NotificationBroadcastStatus>;

const STATUSES_AGREE: BroadcastStatusesAreExhaustive = true;
void STATUSES_AGREE;
void BROADCAST_STATUSES;

/**
 * One broadcast.
 *
 * @stability stable
 */
export class BroadcastDto extends createZodDto(broadcastSchema) {}

/**
 * One (channel, status) delivery count.
 *
 * @stability stable
 */
export class BroadcastDeliveryCountDto extends createZodDto(broadcastDeliveryCountSchema) {}

/**
 * A broadcast with its delivery counts.
 *
 * @stability stable
 */
export class BroadcastDetailDto extends createZodDto(broadcastDetailSchema) {}

/**
 * The create result.
 *
 * @stability stable
 */
export class BroadcastCreateResultDto extends createZodDto(broadcastCreateResultSchema) {}

/**
 * `GET /api/admin/broadcasts/audience` query.
 *
 * @stability stable
 */
export class BroadcastAudienceQueryDto extends createZodDto(broadcastAudienceQuerySchema) {}

/**
 * The audience size.
 *
 * @stability stable
 */
export class BroadcastAudienceDto extends createZodDto(broadcastAudienceSchema) {}

/**
 * The test-send result.
 *
 * @stability stable
 */
export class BroadcastTestResultDto extends createZodDto(broadcastTestResultSchema) {}
