// `@marinoscar/platform-web/core`: the web host ports every packaged page
// reuses (issue #696). Documented in ./README.md.

export { isPlatformApiError } from './api-client.js';
export type { PlatformApiClient, PlatformApiError, PlatformBlobResponse } from './api-client.js';
export type { PlatformViewer } from './viewer.js';
export type { PlatformSettingsPage } from './settings-page.js';
export {
  PlatformHostProvider,
  useOptionalPlatformHost,
  usePlatformApi,
  usePlatformHost,
  usePlatformViewer,
} from './host.js';
export type { PlatformWebHost } from './host.js';
