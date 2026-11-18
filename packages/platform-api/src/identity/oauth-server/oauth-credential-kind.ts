// The `oauth` credential kind, registered by the identity slice (PP-15.3).
// Imported by the guard, so it is known wherever the guard can admit an `oat_`
// token. Registering the kind only makes its id known: every built-in decision
// (switchOrg, PAT creation, device approval, the node routes) keys on built-in
// ids, so `oauth` starts with no privilege beyond what the guard grants it.

import { credentialKindRegistry, registerCredentialKind } from '../../core/index';

/**
 * The credential kind id of an `oat_` access token.
 *
 * @stability experimental
 */
export const OAUTH_CREDENTIAL_KIND = 'oauth' as const;

if (!credentialKindRegistry.has(OAUTH_CREDENTIAL_KIND)) {
  registerCredentialKind({
    id: OAUTH_CREDENTIAL_KIND,
    principalKind: 'user',
    description: 'An `oat_` access token a user granted to a third-party client.',
  });
}
