// `@marinoscar/platform-contract/credentials`: the presentation-safe wire
// shapes of a stored credential (issue #735, PP-8.8). The API's credentials
// slice returns these types' runtime equivalents; a feature that presents a
// credential embeds one. constants.ts is zod-free. Documented in ./README.md.
// Explicit named exports only.

export { CREDENTIAL_SOURCES, CREDENTIAL_TIERS, SECRET_BEARING_KEYS } from './constants.js';
export type { CredentialSourceValue, CredentialTierValue } from './constants.js';
export { credentialInfoSchema, orgCredentialInfoSchema, userCredentialInfoSchema } from './schemas.js';
export type { CredentialInfoDto, OrgCredentialInfoDto, UserCredentialInfoDto } from './schemas.js';
