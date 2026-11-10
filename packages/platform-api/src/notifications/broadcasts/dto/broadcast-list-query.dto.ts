// The wire schemas live in @marinoscar/platform-contract/notifications since
// #738 (moved from this file with their meaning unchanged). This file wraps
// them as DTOs and re-exports them under their old names.

import { createZodDto } from 'nestjs-zod';
import { broadcastListQuerySchema } from '@marinoscar/platform-contract/notifications';

export { broadcastListQuerySchema } from '@marinoscar/platform-contract/notifications';
export type { BroadcastListQuery } from '@marinoscar/platform-contract/notifications';

/**
 * `GET /api/admin/broadcasts` query.
 *
 * @stability stable
 */
export class BroadcastListQueryDto extends createZodDto(broadcastListQuerySchema) {}
