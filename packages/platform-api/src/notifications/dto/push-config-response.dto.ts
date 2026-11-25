// The wire schemas live in @marinoscar/platform-contract/notifications since
// #738 (moved from this file with their meaning unchanged; channel ids are
// open). This file wraps them as DTOs and re-exports them under their old
// names, so the controllers and their importers did not change.

import { createZodDto } from 'nestjs-zod';
import { pushConfigResponseSchema } from '@marinoscar/platform-contract/notifications';

export {
  PUSH_CONTRACT_CARRIES_NO_SECRET,
  privateKeyStatusSchema,
  pushConfigResponseSchema,
} from '@marinoscar/platform-contract/notifications';
export type { PushConfigResponse } from '@marinoscar/platform-contract/notifications';

/**
 * The admin view of the Web Push configuration.
 *
 * @stability stable
 */
export class PushConfigResponseDto extends createZodDto(pushConfigResponseSchema) {}
