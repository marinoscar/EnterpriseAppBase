// =============================================================================
// Manifest: fills the user-owned model registry (issue #688, PP-1.9)
// =============================================================================
//
// The registry itself lives in `@marinoscar/platform-api/core` (issue #699)
// and the platform's inventory in `@marinoscar/platform-api/manifest` (#866);
// the app fills the registry here: platform declarations first, then the
// app-owned file, so a collision with a platform entry names the app.
// Imported for its side effect by ./index.ts, ./scoped-prisma.service.ts and
// ../prisma.service.ts. Recipe:
// packages/platform-api/src/core/registry/README.md "Recipe: a static registry".
// =============================================================================

import { registerPlatformUserOwnedModels } from '@marinoscar/platform-api/manifest';

import { APP_USER_OWNED_MODELS } from '../../app-registrations/user-owned-models';

// The platform's inventory (`PLATFORM_USER_OWNED_MODELS`: the base entries,
// then the sharing, settings, credentials and android-app slices'), then the
// app-owned entries.
registerPlatformUserOwnedModels(APP_USER_OWNED_MODELS);
