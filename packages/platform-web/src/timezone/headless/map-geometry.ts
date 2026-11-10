// The time zone map's projection and its land layer, as pure functions, so the
// UI draws and hit-tests with the same numbers the tests check.
// Equirectangular, in map units of one degree: x = lon + 180 (0..360),
// y = LAND_NORTH - lat (0 at 84N, the bottom of the land grid at 58.5S).

import { LAND_COLS, LAND_NORTH, LAND_ROWS, LAND_STEP } from './map-data.js';

/**
 * Width of the map in map units (one unit = one degree of longitude).
 *
 * @stability experimental
 */
export const TIME_ZONE_MAP_WIDTH = LAND_COLS * LAND_STEP;

/**
 * Height of the map in map units (one unit = one degree of latitude).
 *
 * @stability experimental
 */
export const TIME_ZONE_MAP_HEIGHT = LAND_ROWS.length * LAND_STEP;

/**
 * A point of the map, in map units.
 *
 * @stability experimental
 */
export interface MapPoint {
  /** 0 at 180W, {@link TIME_ZONE_MAP_WIDTH} at 180E. */
  x: number;
  /** 0 at the top edge (84N). */
  y: number;
}

/**
 * A geographic coordinate, in degrees.
 *
 * @stability experimental
 */
export interface GeoPoint {
  /** Longitude, degrees east (-180..180). */
  lon: number;
  /** Latitude, degrees north. */
  lat: number;
}

/**
 * Projects a coordinate onto the map. Latitudes beyond the land grid (the
 * Antarctic stations, the far north) are clamped to its edge.
 *
 * @param lon - longitude, degrees east.
 * @param lat - latitude, degrees north.
 * @returns the map point.
 *
 * @stability experimental
 */
export function projectToMap(lon: number, lat: number): MapPoint {
  const edge = LAND_STEP / 2;
  const y = Math.min(TIME_ZONE_MAP_HEIGHT - edge, Math.max(edge, LAND_NORTH - lat));
  return { x: lon + 180, y };
}

/**
 * The coordinate under a map point (the inverse of {@link projectToMap}).
 *
 * @param x - map units from the left edge.
 * @param y - map units from the top edge.
 * @returns longitude and latitude in degrees.
 *
 * @stability experimental
 */
export function unprojectFromMap(x: number, y: number): GeoPoint {
  return { lon: x - 180, lat: LAND_NORTH - y };
}

/**
 * The longitude band of a UTC offset: the 15-degree strip centred on
 * `offsetHours * 15`, as one or two `[x, width]` ranges in map units (two when
 * it straddles the date line, as `UTC+12` does).
 *
 * @param offsetMinutes - minutes east of UTC.
 * @returns the ranges.
 *
 * @stability experimental
 */
export function offsetBandRanges(offsetMinutes: number): Array<[number, number]> {
  const centre = (offsetMinutes / 60) * 15 + 180;
  const start = centre - 7.5;
  const end = centre + 7.5;
  const ranges: Array<[number, number]> = [];
  const clip = (a: number, b: number) => {
    const lo = Math.max(0, a);
    const hi = Math.min(TIME_ZONE_MAP_WIDTH, b);
    if (hi > lo) ranges.push([lo, hi - lo]);
  };
  clip(start, end);
  if (start < 0) clip(start + TIME_ZONE_MAP_WIDTH, end + TIME_ZONE_MAP_WIDTH);
  if (end > TIME_ZONE_MAP_WIDTH) clip(start - TIME_ZONE_MAP_WIDTH, end - TIME_ZONE_MAP_WIDTH);
  return ranges;
}

let landPath: string | undefined;

/**
 * The land layer as one SVG path: a zero-length segment at the centre of every
 * land cell. Stroke it with `stroke-linecap: round` and a width under
 * `LAND_STEP` and every segment draws as one dot. Built once, then cached.
 *
 * @returns the path's `d`.
 *
 * @stability experimental
 */
export function landDotsPath(): string {
  if (landPath !== undefined) return landPath;
  const parts: string[] = [];
  LAND_ROWS.forEach((row, r) => {
    const y = r * LAND_STEP + LAND_STEP / 2;
    for (let i = 0; i < row.length; i++) {
      const nibble = parseInt(row[i] ?? '0', 16);
      if (!nibble) continue;
      for (let bit = 0; bit < 4; bit++) {
        if (nibble & (8 >> bit)) {
          const x = (i * 4 + bit) * LAND_STEP + LAND_STEP / 2;
          parts.push(`M${x} ${y}h0`);
        }
      }
    }
  });
  landPath = parts.join('');
  return landPath;
}
