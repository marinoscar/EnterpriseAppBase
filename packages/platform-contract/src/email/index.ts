// `@marinoscar/platform-contract/email`: the wire contract of the email
// slice's admin routes (issue #737, PP-8.4): the stored settings, the PUT
// body, the GET/PUT response, the test-send result and the closed transport
// list. constants.ts is zod-free. Documented in ./README.md. Explicit named
// exports only.

export { DEFAULT_SMTP_PORT, EMAIL_PROVIDER_KINDS, IMPLICIT_TLS_SMTP_PORT } from './constants.js';
export type { EmailProviderKind } from './constants.js';
export {
  DEFAULT_EMAIL_SETTINGS,
  EMAIL_SETTINGS_CARRIES_NO_SECRET,
  EMAIL_SETTINGS_RESPONSE_CARRIES_NO_SECRET,
  credentialStatusSchema,
  emailSettingsResponseSchema,
  emailSettingsSchema,
  testEmailResultSchema,
  updateEmailSettingsSchema,
} from './schemas.js';
export type {
  EmailCredentialStatusDto,
  EmailSettings,
  EmailSettingsCarriesNoSecret,
  EmailSettingsResponse,
  EmailSettingsResponseCarriesNoSecret,
  TestEmailResult,
  UpdateEmailSettingsInput,
} from './schemas.js';
