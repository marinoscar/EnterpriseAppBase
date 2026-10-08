/**
 * Interpreting the UNTRUSTED `clientInfo` blob of a device activation (#141).
 * Packaged (#727, PP-6.6) in `@marinoscar/platform-web/identity/headless`; a
 * compatibility re-export until the imports point at the package directly.
 */
export {
  DEVICE_NAME_MAX_DISPLAY,
  DEVICE_PAT_APPROX_DAYS,
  IP_ADDRESS_MAX_DISPLAY,
  USER_AGENT_MAX_DISPLAY,
  readCredentialKind,
  sanitizeDeviceText,
} from '@marinoscar/platform-web/identity/headless';
export type { DeviceCredentialKind } from '@marinoscar/platform-web/identity/headless';
