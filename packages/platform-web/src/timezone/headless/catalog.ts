// The zone catalog: every zone of the map (tzdata zone.tab, ZONE_PINS) plus
// UTC, with its city, region, country, coordinates and current offset, and the
// two lookups the picker needs (search, nearest pin). Imports the generated map
// data, so only the picker pulls it; the formatters do not.

import { isValidTimeZone } from '@marinoscar/platform-contract/settings';

import { formatUtcOffset, getTimeZoneOffsetMinutes } from './format.js';
import { ZONE_PINS } from './map-data.js';

/**
 * One zone the picker offers.
 *
 * @stability experimental
 */
export interface TimeZoneOption {
  /** The IANA id (`America/Costa_Rica`). */
  id: string;
  /** The last path segment, readable (`Costa Rica`, `New York`). */
  city: string;
  /** The first path segment (`America`); `''` for `UTC`. */
  region: string;
  /** ISO 3166 country code (`CR`), or `null` (UTC, an id with no pin). */
  countryCode: string | null;
  /** The country's English name (`Costa Rica`), or `null`. */
  countryName: string | null;
  /** Latitude of the zone's principal city, or `null` (no pin). */
  lat: number | null;
  /** Longitude of the zone's principal city, or `null` (no pin). */
  lon: number | null;
  /** Minutes east of UTC at the moment the list was built. */
  offsetMinutes: number;
  /** `UTC−06:00` ({@link formatUtcOffset}). */
  offsetLabel: string;
}

let regionNames: Intl.DisplayNames | null | undefined;

function countryNameOf(code: string | null): string | null {
  if (!code) return null;
  if (regionNames === undefined) {
    try {
      regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
    } catch {
      regionNames = null;
    }
  }
  try {
    return regionNames?.of(code) ?? null;
  } catch {
    return null;
  }
}

function cityOf(id: string): string {
  const segments = id.split('/');
  return (segments[segments.length - 1] ?? id).replace(/_/g, ' ');
}

function regionOf(id: string): string {
  return id.includes('/') ? (id.split('/')[0] ?? '') : '';
}

const PINS_BY_ID = new Map(ZONE_PINS.map((pin) => [pin[0], pin] as const));

function optionOf(id: string, at: Date, pin = PINS_BY_ID.get(id)): TimeZoneOption {
  const offsetMinutes = getTimeZoneOffsetMinutes(id, at);
  const countryCode = pin?.[1] ?? null;
  return {
    id,
    city: id === 'UTC' ? 'UTC' : cityOf(id),
    region: id === 'UTC' ? '' : regionOf(id),
    countryCode,
    countryName: id === 'UTC' ? 'Coordinated Universal Time' : countryNameOf(countryCode),
    lat: pin?.[2] ?? null,
    lon: pin?.[3] ?? null,
    offsetMinutes,
    offsetLabel: formatUtcOffset(offsetMinutes),
  };
}

let listCache: { hour: number; options: TimeZoneOption[] } | null = null;

/**
 * Every zone of the map plus `UTC`, sorted by offset, then city. Offsets are
 * those at `at` (daylight saving time applies); the list is cached per hour.
 *
 * @param at - the moment the offsets are computed for; default now.
 * @returns the options.
 *
 * @stability experimental
 */
export function listTimeZones(at: Date = new Date()): TimeZoneOption[] {
  const hour = Math.floor(at.getTime() / 3_600_000);
  if (listCache?.hour === hour) return listCache.options;
  const options = [optionOf('UTC', at), ...ZONE_PINS.map(([id]) => optionOf(id, at))];
  options.sort((a, b) => a.offsetMinutes - b.offsetMinutes || a.city.localeCompare(b.city));
  listCache = { hour, options };
  return options;
}

function canonicalOf(id: string): string | null {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: id }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

/**
 * The option of one zone. A valid zone the map has no pin for (a link such as
 * `US/Eastern`, or `America/Indiana/Knox`) still gets one: with the pin of its
 * canonical zone when the runtime names one, else without coordinates.
 *
 * @param id - an IANA zone id.
 * @param at - the moment the offset is computed for; default now.
 * @returns the option, or `null` for an unknown id.
 *
 * @stability experimental
 */
export function findTimeZone(id: string | null | undefined, at: Date = new Date()): TimeZoneOption | null {
  if (!isValidTimeZone(id)) return null;
  const listed = listTimeZones(at).find((option) => option.id === id);
  if (listed) return listed;
  const canonical = canonicalOf(id);
  return optionOf(id, at, canonical ? PINS_BY_ID.get(canonical) : undefined);
}

/** `+5:30`, `-6`, `+05:30`: the offset spellings a search may use. */
function offsetQueries(minutes: number): string[] {
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  const mm = String(m).padStart(2, '0');
  const hh = String(h).padStart(2, '0');
  const forms = [`${sign}${h}:${mm}`, `${sign}${hh}:${mm}`, `${sign}${hh}${mm}`];
  if (m === 0) forms.push(`${sign}${h}`, `${sign}${hh}`);
  if (minutes === 0) forms.push('', '+0', '-0', '0');
  return forms;
}

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/−/g, '-')
    .replace(/_/g, ' ')
    .toLowerCase()
    .trim();
}

/**
 * Whether an option matches a search: its city, region, country, id or offset
 * (`UTC+5:30`, `GMT-6`, `+05:30`). Case and accents are ignored.
 *
 * @param option - the zone.
 * @param query - what the user typed.
 * @returns whether it matches.
 *
 * @stability experimental
 */
export function matchesTimeZoneQuery(option: TimeZoneOption, query: string): boolean {
  const q = normalize(query);
  if (!q) return true;
  const offset = /^(?:utc|gmt)?\s*([+-]\s*\d{1,2}(?::?\d{2})?|0)$/.exec(q.replace(/\s+/g, ''));
  if (offset || /^(?:utc|gmt)$/.test(q)) {
    const typed = (offset?.[1] ?? '').replace(/\s+/g, '');
    if (offsetQueries(option.offsetMinutes).includes(typed)) return true;
    if (!offset) return option.offsetMinutes === 0;
  }
  const haystack = normalize([option.city, option.region, option.countryName ?? '', option.countryCode ?? '', option.id].join(' '));
  return q.split(/\s+/).every((word) => haystack.includes(word));
}

/**
 * The options matching a search ({@link matchesTimeZoneQuery}), best first:
 * a city that starts with the query, then the rest in list order.
 *
 * @param options - the list ({@link listTimeZones}).
 * @param query - what the user typed.
 * @param limit - the most to return; default 50.
 * @returns the matches.
 *
 * @stability experimental
 */
export function searchTimeZones(options: readonly TimeZoneOption[], query: string, limit = 50): TimeZoneOption[] {
  const q = normalize(query);
  const matches = options.filter((option) => matchesTimeZoneQuery(option, query));
  if (q) {
    const starts = (option: TimeZoneOption) => (normalize(option.city).startsWith(q) ? 0 : 1);
    matches.sort((a, b) => starts(a) - starts(b));
  }
  return matches.slice(0, limit);
}

/**
 * The zone whose pin is nearest a point of the map, in the map's
 * equirectangular projection (longitude wraps at the date line).
 *
 * @param lon - longitude, degrees east.
 * @param lat - latitude, degrees north.
 * @returns the zone id.
 *
 * @stability experimental
 */
export function nearestZone(lon: number, lat: number): string {
  let best = ZONE_PINS[0]?.[0] ?? 'UTC';
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const [id, , pinLat, pinLon] of ZONE_PINS) {
    let dx = Math.abs(lon - pinLon) % 360;
    if (dx > 180) dx = 360 - dx;
    const dy = lat - pinLat;
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = id;
    }
  }
  return best;
}
