// =============================================================================
// Manifest: fills the model ownership registry (issue #725, PP-6.5)
// =============================================================================
//
// The registry lives in `@marinoscar/platform-api/core`; the app fills it here:
// platform classifications first, then the app-owned file, so a collision with
// a platform entry names the app. Imported for its side effect by ./index.ts
// and ../prisma.service.ts. Recipe:
// packages/platform-api/src/core/registry/README.md "Recipe: a static registry".
// =============================================================================

import { registerModelOwnership } from '@marinoscar/platform-api/core';
import { SETTINGS_MODEL_OWNERSHIP } from '@marinoscar/platform-api/settings';
import { CREDENTIALS_MODEL_OWNERSHIP } from '@marinoscar/platform-api/credentials';
import { SHARING_MODEL_OWNERSHIP } from '@marinoscar/platform-api/sharing';

import { APP_MODEL_OWNERSHIP } from '../../app-registrations/model-ownership';
import { PLATFORM_MODEL_OWNERSHIP } from './platform-model-ownership';

registerModelOwnership(PLATFORM_MODEL_OWNERSHIP);
// The sharing slice's org tables (#728), declared by the package.
registerModelOwnership(SHARING_MODEL_OWNERSHIP);
// The settings slice's org table (#733), declared by the package.
registerModelOwnership(SETTINGS_MODEL_OWNERSHIP);
// The credentials slice's three models (#735), declared by the package.
registerModelOwnership(CREDENTIALS_MODEL_OWNERSHIP);

// App-owned entries last.
registerModelOwnership(APP_MODEL_OWNERSHIP);
