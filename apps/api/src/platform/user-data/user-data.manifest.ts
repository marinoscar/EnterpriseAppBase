// =============================================================================
// Manifest: fills the user-data registries (issue #743)
// =============================================================================
//
// The explicit, grep-able list: the platform's categories, model hints and
// factory reset steps first, then the app's own, so a collision names the
// app. Imported for its side effect by ./user-data.config.ts and the tests.
// =============================================================================

import {
  registerFactoryResetStep,
  registerOffboardingPrecondition,
  registerPlatformUserData,
  registerUserDataCategory,
  registerUserDataModels,
  registerUserDataScope,
} from '@marinoscar/platform-api/user-data';

import {
  APP_FACTORY_RESET_STEPS,
  APP_OFFBOARDING_PRECONDITIONS,
  APP_USER_DATA_CATEGORIES,
  APP_USER_DATA_MODELS,
  APP_USER_DATA_SCOPES,
} from '../../app-registrations/user-data';

registerPlatformUserData();

// App-owned entries last.
APP_USER_DATA_CATEGORIES.forEach(registerUserDataCategory);
registerUserDataModels(APP_USER_DATA_MODELS);
APP_USER_DATA_SCOPES.forEach(registerUserDataScope);
APP_FACTORY_RESET_STEPS.forEach(registerFactoryResetStep);
APP_OFFBOARDING_PRECONDITIONS.forEach(registerOffboardingPrecondition);
