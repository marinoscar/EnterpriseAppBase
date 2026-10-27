// `@marinoscar/platform-web/timezone/headless`: the display time zone (the
// user's `profile.timezone`, else the device's), the formatters that render in
// it, the zone catalog, the map geometry and the settings sync, with no
// component. Documented in ../README.md.

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
} from './store.js';
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
} from './format.js';
export type { DateInput, TimeZoneFormatOptions } from './format.js';
export { findTimeZone, listTimeZones, matchesTimeZoneQuery, nearestZone, searchTimeZones } from './catalog.js';
export type { TimeZoneOption } from './catalog.js';
export {
  TIME_ZONE_MAP_HEIGHT,
  TIME_ZONE_MAP_WIDTH,
  landDotsPath,
  offsetBandRanges,
  projectToMap,
  unprojectFromMap,
} from './map-geometry.js';
export type { GeoPoint, MapPoint } from './map-geometry.js';
export { UserTimeZoneSync } from './sync.js';
export type { UserTimeZoneSyncProps } from './sync.js';
