// =============================================================================
// The app's binding of the credentials slice (issue #735)
// =============================================================================
//
// `@marinoscar/platform-api/credentials` needs no host port of its own: it
// reaches the database through the core `PLATFORM_PRISMA` port bound in
// `platform/platform-host.module.ts`. What the app supplies is its purposes,
// registered at import time by the manifest below, before bootstrap.
//
// The three modules are registered in the root module so a broken provider
// graph fails at boot; every consumer still imports the module it needs (none
// is @Global, so each user of a plaintext-returning service is visible).
// =============================================================================

import { CredentialsModule, OrgCredentialsModule, UserCredentialsModule } from '@marinoscar/platform-api/credentials';

import './credential-purposes.manifest';

export const credentialsModules = [CredentialsModule, UserCredentialsModule, OrgCredentialsModule] as const;
