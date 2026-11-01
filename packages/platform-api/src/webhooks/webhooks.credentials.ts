// =============================================================================
// The signing-secret credential purpose (issue #1046)
// =============================================================================
//
// `webhook_signing` in all three tiers of the credentials store: a user's own
// store (user scope), the organization's (org scope) and the deployment's
// (system scope). The app registers both definitions from its credential
// manifest; the slice only declares them. A secret is addressed
// `endpoint:<endpointId>:v<version>` (see `webhook-secrets.service.ts`).
// =============================================================================

import type { CredentialPurposeDef, UserCredentialPurposeDef } from '../credentials/index';
import { WEBHOOK_SIGNING_PURPOSE } from './webhooks.constants';

/**
 * The organization and deployment tiers of `webhook_signing`, for
 * `registerCredentialPurpose`.
 *
 * @example
 * ```ts
 * registerCredentialPurpose(WEBHOOK_SIGNING_CREDENTIAL_PURPOSE_DEF);
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export const WEBHOOK_SIGNING_CREDENTIAL_PURPOSE_DEF: CredentialPurposeDef = Object.freeze({
  purpose: WEBHOOK_SIGNING_PURPOSE,
  owner: 'webhooks',
  label: 'Webhook signing secrets',
  tiers: ['system', 'org'] as const,
});

/**
 * The user tier of `webhook_signing`, for `registerUserCredentialPurpose`. No
 * deployment or organization fallback: a member's secret is theirs alone.
 *
 * @example
 * ```ts
 * registerUserCredentialPurpose(WEBHOOK_SIGNING_USER_CREDENTIAL_PURPOSE_DEF);
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export const WEBHOOK_SIGNING_USER_CREDENTIAL_PURPOSE_DEF: UserCredentialPurposeDef = Object.freeze({
  purpose: WEBHOOK_SIGNING_PURPOSE,
  label: 'Webhook signing secret',
  description: 'Signs the webhooks this application sends to your endpoints, so your receiver can verify them.',
  system: null,
});
