// `@marinoscar/platform-contract/email`: the wire contract of the email
// slice's admin routes (issue #737, PP-8.4): the stored settings, the PUT
// body, the GET/PUT response, the test-send result and the built-in transport
// list (the transport itself is an open id, PP-14.8). constants.ts is zod-free. Documented in ./README.md. Explicit named
// exports only.

export {
  BUILTIN_EMAIL_PROVIDER_KINDS,
  DEFAULT_SMTP_PORT,
  EMAIL_PROVIDER_KINDS,
  EMAIL_TRANSPORT_ID_PATTERN,
  IMPLICIT_TLS_SMTP_PORT,
  LEGACY_EMAIL_FLAT_FIELDS,
  LEGACY_EMAIL_FLAT_FIELD_TARGETS,
} from './constants.js';
export type { BuiltinEmailProviderKind, EmailProviderKind } from './constants.js';
export {
  DEFAULT_EMAIL_SETTINGS,
  EMAIL_SETTINGS_CARRIES_NO_SECRET,
  EMAIL_SETTINGS_RESPONSE_CARRIES_NO_SECRET,
  credentialStatusSchema,
  emailSettingsResponseSchema,
  emailSettingsSchema,
  emailTransportIdSchema,
  emailTransportSettingsSchema,
  emailTransportsPatchSchema,
  emailTransportsSchema,
  testEmailResultSchema,
  updateEmailSettingsSchema,
} from './schemas.js';
export type {
  EmailCredentialStatusDto,
  EmailProviderKindEnum,
  EmailSecretFieldName,
  EmailSettings,
  EmailSettingsCarriesNoSecret,
  EmailSettingsResponse,
  EmailSettingsResponseCarriesNoSecret,
  TestEmailResult,
  UpdateEmailSettingsInput,
} from './schemas.js';
