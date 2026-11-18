import type { CredentialPurposeDef, UserCredentialPurposeDef } from '@marinoscar/platform-api/credentials';

// =============================================================================
// EXAMPLE, NOT WIRED: an org-tier purpose with fallback ['org', 'system'] (PP-8.8)
// =============================================================================
//
// Two declarations that work together:
//
//   PARTNER_API_CREDENTIAL_PURPOSE  `registerCredentialPurpose`: the deployment
//                                   and organizations may each store a partner
//                                   API token (tiers `system` and `org`), in
//                                   `credentials` and `org_credentials`.
//   PARTNER_API_TOKEN_PURPOSE       `registerUserCredentialPurpose`: a user may
//                                   bring their own; when they have none, the
//                                   resolver tries their ORGANIZATION's token,
//                                   then the DEPLOYMENT's, then answers `none`.
//
// The resolution is `resolver.resolve(userId, 'partner_api_token', undefined,
// { orgId: principal.activeOrgId })`; the result's `source` (`user`, `org`,
// `system`) says who pays for the call.
//
// To use them, a fork adds the first to `APP_CREDENTIAL_PURPOSES` and the
// second to `APP_USER_CREDENTIAL_PURPOSES` (`app-registrations/credentials.ts`).
// Exercised by `test/credentials/credentials-extension-points.spec.ts`.
// =============================================================================

/** Where the deployment's and each organization's partner token live. */
export const PARTNER_API_CREDENTIAL_PURPOSE = {
  purpose: 'partner_api',
  owner: 'app',
  label: 'Partner API token',
  tiers: ['system', 'org'],
} as const satisfies CredentialPurposeDef;

/** A user's own partner token, falling back to their organization's, then the deployment's. */
export const PARTNER_API_TOKEN_PURPOSE = {
  purpose: 'partner_api_token',
  label: 'Partner API token',
  description: 'Your own token for the partner API. Without one, your organization’s token is used, then the deployment’s.',
  system: { purpose: 'partner_api', name: 'default' },
  org: { purpose: 'partner_api', name: 'default' },
  fallback: ['org', 'system'],
} as const satisfies UserCredentialPurposeDef;
