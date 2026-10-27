// The request side of the display time zone: the `X-Time-Zone` header every
// packaged transport (`PlatformHttpClient`, `connectSse`, `postSse`) sends, so
// the API cuts calendar days in the viewer's zone for a user who stored no
// `profile.timezone`. The server resolves the stored zone first, then this
// header, then UTC (`SettingsResolver.resolveRequestTimeZone`).

import { TIME_ZONE_HEADER } from '@marinoscar/platform-contract/timezone';

import { getDisplayTimeZone } from './store.js';

/**
 * The header naming the viewer's display zone, `{ 'x-time-zone': 'America/Costa_Rica' }`,
 * for a transport that does not go through `PlatformHttpClient` (a raw
 * `fetch`, an upload with `XMLHttpRequest`). The packaged client and SSE
 * helpers already send it.
 *
 * @returns a one-entry header record.
 *
 * @example
 * ```ts
 * await fetch('/api/reports/daily', { headers: { ...timeZoneHeader(), Authorization: bearer } });
 * ```
 *
 * @stability experimental
 */
export function timeZoneHeader(): Record<string, string> {
  return { [TIME_ZONE_HEADER]: getDisplayTimeZone() };
}
