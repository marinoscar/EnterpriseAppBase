// The app's own sign-in providers (PP-14.9), registered at import time: the
// registry freezes once the application has bootstrapped.
import '../../app-registrations/identity';

import { IdentityModule } from '@marinoscar/platform-api/identity';

import { IdentityHostModule } from './identity-host.module';

// =============================================================================
// The reference app's identity slice (issue #727)
// =============================================================================
//
// One `IdentityModule.forRoot()`: sign-in, sessions and tokens, the guards and
// decorators every route uses, users, the allowlist, personal access tokens,
// the device flow and organizations, from `@marinoscar/platform-api/identity`.
// The host ports are bound by `IdentityHostModule`; the defaults
// (`defaultOrgRole: 'viewer'`, `initialAdminEmailEnv: 'INITIAL_ADMIN_EMAIL'`)
// are this app's.
//
// To bind a sign-in policy (a company domain, a role mapped from a claim) pass
// `signInPolicy: { useClass: ... }` here; it is consulted for every provider.
// The reference app binds none. `platform-extensions/identity/` has a worked one.
//
// The test-only login (`POST /api/auth/test/login`, e2e) is mounted outside
// production only; the package refuses it in production regardless.
// =============================================================================

export const identityModule = IdentityModule.forRoot({
  imports: [IdentityHostModule],
  enableTestAuth: process.env.NODE_ENV !== 'production',
});
