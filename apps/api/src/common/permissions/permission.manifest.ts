// =============================================================================
// Role and permission manifest (issue #676; packaged by #866)
// =============================================================================
//
// Fills core's role and permission registries, once, at import time, in SEED
// ORDER:
//
//   1. platform roles   2. app roles   3. platform permissions   4. app permissions
//
// The platform's part (the identity slice's roles and every slice's permission
// sets, in the order this app has always seeded them) is
// `registerPlatformPermissions()` of `@marinoscar/platform-api/manifest`. An
// APP never edits this file: it fills `app-registrations/permissions.ts`, which
// is registered after the platform's, so a collision names the app.
// =============================================================================

import { registerPlatformPermissions } from '@marinoscar/platform-api/manifest';

import { APP_PERMISSIONS, APP_ROLES } from '../../app-registrations/permissions';

registerPlatformPermissions({ app: { roles: [APP_ROLES], permissions: [APP_PERMISSIONS] } });
