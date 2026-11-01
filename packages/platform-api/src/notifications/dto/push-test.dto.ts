// The wire schemas live in @marinoscar/platform-contract/notifications since
// #738 (moved from this file with their meaning unchanged; channel ids are
// open). This file wraps them as DTOs and re-exports them under their old
// names, so the controllers and their importers did not change.

import { createZodDto } from 'nestjs-zod';
import { pushTestRequestSchema, pushTestResponseSchema } from '@marinoscar/platform-contract/notifications';

export {
  PUSH_TEST_CONFIG_SOURCES,
  PUSH_TEST_OVERALL,
  PUSH_TEST_SEND_STATUSES,
  pushTestBrowserDiagnosticsSchema,
  pushTestConfigDiagnosticsSchema,
  pushTestEventDiagnosticsSchema,
  pushTestRequestSchema,
  pushTestResponseSchema,
  pushTestSendResultSchema,
  pushTestSubscriptionResultSchema,
} from '@marinoscar/platform-contract/notifications';
export type {
  PushTestBrowserDiagnostics,
  PushTestConfigDiagnostics,
  PushTestConfigSource,
  PushTestEventDiagnostics,
  PushTestOverall,
  PushTestRequest,
  PushTestResponse,
  PushTestSendResult,
  PushTestSendStatus,
  PushTestSubscriptionResult,
} from '@marinoscar/platform-contract/notifications';

/**
 * `POST /api/admin/push-config/test` body.
 *
 * @stability stable
 */
export class PushTestRequestDto extends createZodDto(pushTestRequestSchema) {}

/**
 * `POST /api/admin/push-config/test` response.
 *
 * @stability stable
 */
export class PushTestResponseDto extends createZodDto(pushTestResponseSchema) {}
