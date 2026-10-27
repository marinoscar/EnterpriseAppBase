// The zone catalog and the map geometry of `timezone/headless`.

import { describe, expect, it } from 'vitest';

import {
  TIME_ZONE_MAP_HEIGHT,
  TIME_ZONE_MAP_WIDTH,
  findTimeZone,
  landDotsPath,
  listTimeZones,
  matchesTimeZoneQuery,
  nearestZone,
  offsetBandRanges,
  projectToMap,
  searchTimeZones,
  unprojectFromMap,
} from '../../src/timezone/headless/index.js';

const JANUARY = new Date('2026-01-15T12:00:00Z');

describe('listTimeZones', () => {
  const zones = listTimeZones(JANUARY);

  it('carries every pinned zone and UTC', () => {
    expect(zones.length).toBeGreaterThan(400);
    const costaRica = zones.find((zone) => zone.id === 'America/Costa_Rica');
    expect(costaRica).toMatchObject({
      city: 'Costa Rica',
      region: 'America',
      countryCode: 'CR',
      countryName: 'Costa Rica',
      offsetMinutes: -360,
      offsetLabel: 'UTC−06:00',
    });
    expect(costaRica?.lat).toBeCloseTo(9.93, 1);
    expect(costaRica?.lon).toBeCloseTo(-84.08, 1);
    expect(zones.find((zone) => zone.id === 'UTC')).toMatchObject({ lat: null, lon: null, offsetMinutes: 0, offsetLabel: 'UTC' });
    expect(zones.find((zone) => zone.id === 'America/New_York')?.city).toBe('New York');
  });

  it('is sorted by offset, then city', () => {
    for (let i = 1; i < zones.length; i++) {
      const a = zones[i - 1]!;
      const b = zones[i]!;
      expect(a.offsetMinutes < b.offsetMinutes || (a.offsetMinutes === b.offsetMinutes && a.city.localeCompare(b.city) <= 0)).toBe(true);
    }
  });
});

describe('findTimeZone', () => {
  it('finds a listed zone, and builds one for a valid zone without a pin', () => {
    expect(findTimeZone('Asia/Tokyo', JANUARY)?.countryCode).toBe('JP');
    const knox = findTimeZone('America/Indiana/Knox', JANUARY);
    expect(knox).toMatchObject({ id: 'America/Indiana/Knox', city: 'Knox', region: 'America' });
    const link = findTimeZone('US/Eastern', JANUARY);
    expect(link).toMatchObject({ id: 'US/Eastern', city: 'Eastern', offsetMinutes: -300 });
  });

  it('returns null for an unknown id', () => {
    expect(findTimeZone('Nowhere/Land')).toBeNull();
    expect(findTimeZone(null)).toBeNull();
  });
});

describe('search', () => {
  const zones = listTimeZones(JANUARY);
  const ids = (query: string) => searchTimeZones(zones, query, 500).map((zone) => zone.id);

  it('matches a city, a country, an id and ignores accents and case', () => {
    expect(ids('tokyo')).toContain('Asia/Tokyo');
    expect(ids('Costa Rica')).toContain('America/Costa_Rica');
    expect(ids('japan')).toContain('Asia/Tokyo');
    expect(ids('america/new_york')).toContain('America/New_York');
    expect(ids('sao paulo')).toContain('America/Sao_Paulo');
  });

  it('matches an offset in the usual spellings', () => {
    expect(ids('UTC+5:30')).toContain('Asia/Kolkata');
    expect(ids('+05:30')).toContain('Asia/Kolkata');
    expect(ids('GMT-6')).toContain('America/Costa_Rica');
    expect(ids('UTC−06:00')).toContain('America/Costa_Rica');
    expect(ids('GMT-6')).not.toContain('Asia/Kolkata');
    expect(ids('UTC')).toContain('UTC');
  });

  it('puts a city that starts with the query first, and limits', () => {
    expect(searchTimeZones(zones, 'paris')[0]?.id).toBe('Europe/Paris');
    expect(searchTimeZones(zones, '', 10)).toHaveLength(10);
    const kolkata = zones.find((zone) => zone.id === 'Asia/Kolkata')!;
    expect(matchesTimeZoneQuery(kolkata, 'india')).toBe(true);
  });
});

describe('the map geometry', () => {
  it('projects and unprojects equirectangularly', () => {
    expect(projectToMap(0, 0)).toEqual({ x: 180, y: 84 });
    expect(unprojectFromMap(180, 84)).toEqual({ lon: 0, lat: 0 });
    expect(TIME_ZONE_MAP_WIDTH).toBe(360);
    // Antarctic stations are clamped to the bottom edge.
    expect(projectToMap(166, -77.8).y).toBeLessThan(TIME_ZONE_MAP_HEIGHT);
  });

  it('picks the nearest pin, wrapping at the date line', () => {
    expect(nearestZone(-84.1, 9.9)).toBe('America/Costa_Rica');
    expect(nearestZone(139.7, 35.7)).toBe('Asia/Tokyo');
    expect(nearestZone(2.35, 48.85)).toBe('Europe/Paris');
    // 179.9W is next to Fiji (178.4E) across the date line, not in the Americas.
    expect(['Pacific/Fiji', 'Pacific/Wallis', 'Pacific/Tongatapu', 'Pacific/Niue', 'Pacific/Funafuti']).toContain(nearestZone(-179.9, -17));
  });

  it('builds the offset band, split at the date line', () => {
    expect(offsetBandRanges(0)).toEqual([[172.5, 15]]);
    expect(offsetBandRanges(-360)).toEqual([[82.5, 15]]);
    expect(offsetBandRanges(330)).toEqual([[255, 15]]);
    // UTC+12 straddles the date line; UTC+13 lies wholly past it (165W).
    const twelve = offsetBandRanges(12 * 60);
    expect(twelve).toEqual([[352.5, 7.5], [0, 7.5]]);
    expect(offsetBandRanges(13 * 60)).toEqual([[7.5, 15]]);
  });

  it('draws one dot per land cell', () => {
    const path = landDotsPath();
    expect(path.startsWith('M')).toBe(true);
    expect(path.match(/h0/g)?.length).toBe(7678);
    expect(landDotsPath()).toBe(path);
  });
});
