import { createZodDto } from 'nestjs-zod';

import { updateEmailSettingsSchema } from '@marinoscar/platform-contract/email';

// =============================================================================
// PUT /api/email-settings body (issue #124; schema in the contract since #737)
// =============================================================================
//
// Every settings field accepts its two "empty box" forms (`''`, `null`), which
// `EmailSettingsService.update` turns into "absent". `smtpPassword` and
// `sesSecretAccessKey` are WRITE-ONLY: blank preserves the stored secret, and
// erasing one is not expressible through this body.
// =============================================================================

export { updateEmailSettingsSchema } from '@marinoscar/platform-contract/email';
export type { UpdateEmailSettingsInput } from '@marinoscar/platform-contract/email';

/**
 * The PUT body as a validated DTO (the global `ZodValidationPipe` parses it).
 *
 * @stability stable
 */
export class UpdateEmailSettingsDto extends createZodDto(updateEmailSettingsSchema) {}
