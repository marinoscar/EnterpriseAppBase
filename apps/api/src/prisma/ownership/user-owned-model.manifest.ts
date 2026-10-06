// =============================================================================
// Manifest: fills the user-owned model registry (issue #688, PP-1.9)
// =============================================================================
//
// The explicit, grep-able list: platform declarations first, then the
// app-owned file, so a collision with a platform entry names the app. Imported
// for its side effect by ./index.ts only. Recipe:
// packages/platform-api/src/core/registry/README.md "Recipe: a static registry".
// =============================================================================

import { APP_USER_OWNED_MODELS } from '../../app-registrations/user-owned-models';
import { PLATFORM_USER_OWNED_MODELS } from './platform-user-owned-models';
import { registerUserOwnedModels } from './user-owned-model.registry';

registerUserOwnedModels(PLATFORM_USER_OWNED_MODELS);

// App-owned entries last.
registerUserOwnedModels(APP_USER_OWNED_MODELS);
