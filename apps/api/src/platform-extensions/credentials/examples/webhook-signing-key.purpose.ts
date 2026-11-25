import type { UserCredentialPurposeDef } from '@marinoscar/platform-api/credentials';

// =============================================================================
// EXAMPLE, NOT WIRED: a user credential purpose with no fallback (PP-8.8)
// =============================================================================
//
// Rung 2 of the extension ladder: `registerUserCredentialPurpose` declares a
// kind of key a user may bring themselves. This one is a user's own webhook
// signing secret: there is no deployment-wide or organization-wide
// counterpart (`system: null`, no `org`), so the resolver answers `user` or
// `none` and never anyone else's key.
//
// To use it, a fork adds it to `APP_USER_CREDENTIAL_PURPOSES` in
// `app-registrations/credentials.ts`; the manifest registers it before
// bootstrap. It is compiled with the app and exercised by
// `test/credentials/credentials-extension-points.spec.ts` instead, so the base
// declares no user purpose of its own.
// =============================================================================

/** A user's own webhook signing secret: the user's key, or nothing. */
export const WEBHOOK_SIGNING_KEY_PURPOSE = {
  purpose: 'webhook_signing_key',
  label: 'Webhook signing secret',
  description: 'Signs the webhooks this application sends on your behalf, so your receiver can verify them.',
  system: null,
} as const satisfies UserCredentialPurposeDef;
