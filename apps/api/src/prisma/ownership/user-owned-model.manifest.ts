// =============================================================================
// Manifest: fills the user-owned model registry (issue #688, PP-1.9)
// =============================================================================
//
// The registry itself lives in `@marinoscar/platform-api/core` (issue #699);
// the app fills it here. The explicit, grep-able list: platform declarations
// first, then the app-owned file, so a collision with a platform entry names
// the app. Imported for its side effect by ./index.ts, ./scoped-prisma.service.ts
// and ../prisma.service.ts. Recipe:
// packages/platform-api/src/core/registry/README.md "Recipe: a static registry".
// =============================================================================

import { registerUserOwnedModels } from '@marinoscar/platform-api/core';

import { APP_USER_OWNED_MODELS } from '../../app-registrations/user-owned-models';
import { PLATFORM_USER_OWNED_MODELS } from './platform-user-owned-models';

registerUserOwnedModels(PLATFORM_USER_OWNED_MODELS);

// App-owned entries last.
registerUserOwnedModels(APP_USER_OWNED_MODELS);
