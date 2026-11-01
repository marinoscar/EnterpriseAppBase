import { registerCredentialPurpose } from '@marinoscar/platform-api/credentials';
import {
  registerAuthProvider,
  registerCurrentUserExtension,
  registerUserListExtension,
  registerUserMetadataSchema,
} from '@marinoscar/platform-api/identity';

import {
  COACH_PREFERENCES_NAMESPACE,
  coachPreferencesSchema,
} from '../platform-extensions/identity/coach-preferences.metadata';
import {
  EXAMPLE_OIDC_PURPOSE,
  exampleOidcProvider,
} from '../platform-extensions/identity/example-oidc.provider';
import {
  currentUserTeamExtension,
  userListTeamExtension,
} from '../platform-extensions/identity/team-directory.extensions';

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

// =============================================================================
// This app's metadata namespaces on users and organizations (PP-14.27)
// =============================================================================
//
// `users.metadata` and `organizations.metadata` hold one top-level key per
// namespace registered HERE, AT IMPORT TIME (the registries freeze once the
// application has bootstrapped). A namespace is a zod schema: a closed object,
// no secret-named field, 16 KiB for the whole document. Read and write it with
// `IdentityMetadataService`; the platform exposes no route over it.
//
// The reference app registers the worked example, `preferences.coach`
// (`platform-extensions/identity/coach-preferences.*`). Registering adds no
// route, no column and no behaviour: it only makes the key valid. A fork that
// does not want it deletes the registration and those files. An organization
// namespace is `registerOrganizationMetadataSchema` the same way.
// Recipe: docs/EXTENDING.md, "Add app metadata to users and organizations".
// =============================================================================

export const coachPreferences = registerUserMetadataSchema({
  namespace: COACH_PREFERENCES_NAMESPACE,
  schema: coachPreferencesSchema,
  description: 'A coach: reminder hour, weekly digest and athlete labels (example)',
});

// =============================================================================
// What this app adds to `/api/auth/me` and to the user list (PP-14.25)
// =============================================================================
//
// `registerCurrentUserExtension` adds `extensions.<id>` to `GET /api/auth/me`;
// `registerUserListExtension` adds it to each row of `GET /api/users`, batched:
// the resolver gets every id of the page and answers a Map. Both are bounded
// JSON, never secrets, and a throwing resolver is skipped and logged (see
// `platform-extensions/identity/team-directory.extensions.ts`).
//
// The `team` example reads an in-memory directory that starts empty, so the
// payloads are unchanged until a team is assigned. A fork replaces the directory
// with its own table, or deletes the two calls and the file.
// =============================================================================

registerCurrentUserExtension(currentUserTeamExtension);
registerUserListExtension(userListTeamExtension);
