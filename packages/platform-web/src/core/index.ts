// `@marinoscar/platform-web/core`: the web host ports every packaged page
// reuses (issue #696). Documented in ./README.md.

export { isPlatformApiError } from './api-client.js';
export type {
  PlatformApiClient,
  PlatformApiError,
  PlatformBlobResponse,
  PlatformRequestOptions,
  PlatformSseOptions,
} from './api-client.js';
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
// The browser HTTP client (issue #727, PP-6.6): the access-token holder, the
// one-shot refresh and the cross-page refresh lock, moved from the reference
// app's `services/api.ts`. The identity slice's `AuthProvider` drives it.
export { ApiError, PlatformHttpClient } from './http/client.js';
export type {
  PlatformHttpBlobWithHeaders,
  PlatformHttpClientOptions,
  PlatformHttpErrorBody,
  PlatformHttpRequestOptions,
  SessionExpiredListener,
} from './http/client.js';
// The adapter from that client to the transport port (issue #868): an app
// keeps ONE `PlatformHttpClient` and hands the packaged pages this view of it.
export { createPlatformApiClient, toHttpRequestOptions, toPlatformApiError } from './http/platform-api-client.js';
export type { PlatformApiClientOptions } from './http/platform-api-client.js';
