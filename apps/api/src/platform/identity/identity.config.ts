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
// The test-only login (`POST /api/auth/test/login`, e2e) is mounted outside
// production only; the package refuses it in production regardless.
// =============================================================================

export const identityModule = IdentityModule.forRoot({
  imports: [IdentityHostModule],
  enableTestAuth: process.env.NODE_ENV !== 'production',
});
