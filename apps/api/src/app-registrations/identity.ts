import { registerCredentialPurpose } from '@marinoscar/platform-api/credentials';
import { registerAuthProvider } from '@marinoscar/platform-api/identity';

import {
  EXAMPLE_OIDC_PURPOSE,
  exampleOidcProvider,
} from '../platform-extensions/identity/example-oidc.provider';

// =============================================================================
// This app's sign-in providers (PP-14.9)
// =============================================================================
//
// A sign-in provider is added HERE, with `registerAuthProvider`, AT IMPORT TIME:
// the registry freezes once the application has bootstrapped, and
// `platform/identity/identity.config.ts` imports this file before it builds the
// identity module. Like `email.ts`, `storage.ts` and `ai.ts`, this file makes
// the `register` call itself.
//
// Registering is all it takes. The slice mounts `GET /api/auth/<id>` and
// `/callback`, lists the provider on `GET /api/auth/providers` while it is
// configured, stores its identities under its own provider id, applies the
// allowlist, and shows it in the Doctor's `auth.providers` check and the
// network-egress view. A provider's secrets live in the credential store under
// the purpose `auth_<id>`, which the provider's owner declares (below).
//
// The reference app registers the worked example, `example-oidc`: a fake OIDC
// provider with no network. It is registered so the example is the real thing,
// but it is OFF until its signing key is stored: a fresh install lists no new
// button and mounts no reachable route. A fork that does not want it deletes the
// two calls below (and `platform-extensions/identity/example-oidc.provider.ts`).
// Recipe: docs/EXTENDING.md and the README of `@marinoscar/platform-api/identity`.
// =============================================================================

registerCredentialPurpose({
  purpose: EXAMPLE_OIDC_PURPOSE,
  owner: 'identity',
  label: 'Example OIDC signing key',
  tiers: ['system'],
});

registerAuthProvider(exampleOidcProvider);
