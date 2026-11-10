import { createZodDto } from 'nestjs-zod';

import { testEmailResultSchema } from '@marinoscar/platform-contract/email';

// =============================================================================
// POST /api/email-settings/test response (issue #124; schema in the contract
// since #737)
// =============================================================================
//
// HTTP 200 even when the send failed: `success` and `error` carry the outcome,
// the error already redacted and capped by `BaseEmailProvider`.
// =============================================================================

export { testEmailResultSchema } from '@marinoscar/platform-contract/email';
export type { TestEmailResult } from '@marinoscar/platform-contract/email';

/**
 * The test-send result as an OpenAPI DTO (inside the global `{ data }` envelope).
 *
 * @stability stable
 */
export class TestEmailResultDto extends createZodDto(testEmailResultSchema) {}
