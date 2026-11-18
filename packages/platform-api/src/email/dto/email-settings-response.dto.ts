import { createZodDto } from 'nestjs-zod';

import { emailSettingsResponseSchema } from '@marinoscar/platform-contract/email';

// =============================================================================
// GET/PUT /api/email-settings response (issue #124; schema in the contract
// since #737)
// =============================================================================
//
// The schema, its field documentation and the compile-time proof that it has
// no secret-bearing field live in `@marinoscar/platform-contract/email`.
// =============================================================================

export {
  EMAIL_SETTINGS_RESPONSE_CARRIES_NO_SECRET,
  credentialStatusSchema,
  emailSettingsResponseSchema,
} from '@marinoscar/platform-contract/email';
export type { EmailSettingsResponse, EmailSettingsResponseCarriesNoSecret } from '@marinoscar/platform-contract/email';

/**
 * The GET/PUT response body as an OpenAPI DTO (inside the global `{ data }` envelope).
 *
 * @stability stable
 */
export class EmailSettingsResponseDto extends createZodDto(emailSettingsResponseSchema) {}
