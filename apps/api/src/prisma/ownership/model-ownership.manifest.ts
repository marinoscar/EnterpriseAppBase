// =============================================================================
// Manifest: fills the model ownership registry (issue #725, PP-6.5)
// =============================================================================
//
// The registry lives in `@marinoscar/platform-api/core` and the platform's
// classification in `@marinoscar/platform-api/manifest` (#866); the app fills
// the registry here: platform classifications first, then the app-owned file,
// so a collision with a platform entry names the app. Imported for its side effect by ./index.ts
// and ../prisma.service.ts. Recipe:
// packages/platform-api/src/core/registry/README.md "Recipe: a static registry".
// =============================================================================

import { registerPlatformModelOwnership } from '@marinoscar/platform-api/manifest';

import { APP_MODEL_OWNERSHIP } from '../../app-registrations/model-ownership';

// The platform's classification (`PLATFORM_MODEL_OWNERSHIP`: the base entries,
// then the sharing, settings, credentials and android-app slices'), then the
// app-owned entries.
registerPlatformModelOwnership(APP_MODEL_OWNERSHIP);
