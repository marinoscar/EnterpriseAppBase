// `TENANCY_MODE` parsing lives in the identity slice since #727
// (`@marinoscar/platform-api/identity`): tenancy decides who joins which
// organization at sign-in, which identity owns. Re-exported here so the app's
// startup check (`main.ts`), its configuration and its imports are unchanged.
export {
  DEFAULT_TENANCY_MODE,
  TENANCY_MODES,
  TENANCY_MODE_ENV_VAR,
  describeTenancyMode,
  parseTenancyMode,
  tenancyCapabilitiesFor,
  verifyTenancyModeAtStartup,
} from '@marinoscar/platform-api/identity';
export type { TenancyCapabilities } from '@marinoscar/platform-api/identity';
export type { TenancyMode } from '@marinoscar/platform-api/core';
