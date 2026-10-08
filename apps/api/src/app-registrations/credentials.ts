// =============================================================================
// App credential purposes (issue #735): the app-owned seam of the two
// credential purpose registries of `@marinoscar/platform-api/credentials`
// =============================================================================
//
// Upstream keeps both lists EMPTY forever; a fork adds its own purposes here
// and never edits the platform's manifest
// (`platform/credentials/credential-purposes.manifest.ts`), which registers
// these after every platform purpose, so a collision names the app.
//
//   APP_CREDENTIAL_PURPOSES       system/org purposes: what the app stores in
//                                 `credentials` and `org_credentials`
//   APP_USER_CREDENTIAL_PURPOSES  kinds of key a user may bring themselves,
//                                 with their org/system fallback
//
// Worked examples (compiled, not registered):
// `platform-extensions/credentials/examples/`.
// =============================================================================

import type { CredentialPurposeDef, UserCredentialPurposeDef } from '@marinoscar/platform-api/credentials';

export const APP_CREDENTIAL_PURPOSES: readonly CredentialPurposeDef[] = [];

export const APP_USER_CREDENTIAL_PURPOSES: readonly UserCredentialPurposeDef[] = [];
