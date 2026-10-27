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
// The packaged-page slot contract (PP-14.23): the optional `slots` prop every
// packaged page takes, and the hook that applies the table slots to a page's
// columns.
export { PageSlotsFrame, SLOT_DETAIL_PANEL_COLUMN_ID, SLOT_ROW_ACTIONS_COLUMN_ID, useTableSlotColumns } from './page-slots.js';
export type {
  PageHeaderSlotProps,
  PageSectionsSlotProps,
  PageSlotsFrameProps,
  PageSlot,
  PageSlotsBase,
  SlotTableColumn,
  TableSlots,
} from './page-slots.js';
export {
  PlatformHostProvider,
  useOptionalPlatformHost,
  usePlatformApi,
  useOptionalPlatformPort,
  usePlatformHost,
  usePlatformPort,
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
// The Server-Sent Events client (issue #900): the incremental parser, the
// reconnecting GET stream and the single-shot POST stream, moved from the
// reference app's `services/sse.ts`. The app binds `connectSse` to the
// notifications slice and `postSse` to the transport port's `postSse`.
export { SseParser, connectSse, postSse } from './http/sse.js';
export type {
  PostSseErrorBody,
  PostSseOptions,
  SseConnection,
  SseFrame,
  SseOptions,
  SseState,
} from './http/sse.js';
// The display time zone (the user's `profile.timezone`, else the device's) and
// the formatters that render in it. Here rather than in the timezone slice so
// that every slice may import them (identity, which timezone depends on,
// included); `@marinoscar/platform-web/timezone/headless` re-exports them.
export {
  TIME_ZONE_STORAGE_KEY,
  deviceTimeZone,
  getDisplayTimeZone,
  getPreferredTimeZone,
  setPreferredTimeZone,
  subscribeDisplayTimeZone,
  timeZoneFromProfile,
  useDisplayTimeZone,
  usePreferredTimeZone,
} from './time-zone/store.js';
export {
  NUMERIC_DATE,
  NUMERIC_DATE_TIME,
  NUMERIC_TIME,
  formatDate,
  formatDateTime,
  formatTime,
  formatUtcOffset,
  getDateTimeFormat,
  getTimeZoneOffsetMinutes,
  toValidDate,
  zonedDateKey,
} from './time-zone/format.js';
export type { DateInput, TimeZoneFormatOptions } from './time-zone/format.js';
export { timeZoneHeader } from './time-zone/request.js';
