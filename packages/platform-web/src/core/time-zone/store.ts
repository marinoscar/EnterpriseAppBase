// The display time zone: one module-level store, so a pure formatter, a hook
// and code outside React all read the same answer. The user's choice comes
// from `profile.timezone` (pushed here by `UserTimeZoneSync` of the timezone
// slice and by `useUserSettings` of the settings slice); without one, the
// device's zone. It lives in `core`, not in the timezone slice, because every
// slice renders dates (identity included, which the timezone slice depends
// on): core is the one place all of them may import without a cycle. The
// timezone slice re-exports it from `/timezone/headless`.

import { isValidTimeZone } from '@marinoscar/platform-contract/settings';
import { useSyncExternalStore } from 'react';

/**
 * The `localStorage` key the chosen zone is cached under, so a reload renders
 * in the right zone before the settings fetch lands.
 *
 * @stability experimental
 */
export const TIME_ZONE_STORAGE_KEY = 'platform.timezone';

const listeners = new Set<() => void>();

function readCache(): string | null {
  try {
    const cached = globalThis.localStorage?.getItem(TIME_ZONE_STORAGE_KEY) ?? null;
    return isValidTimeZone(cached) ? cached : null;
  } catch {
    return null;
  }
}

function writeCache(id: string | null): void {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return;
    if (id === null) storage.removeItem(TIME_ZONE_STORAGE_KEY);
    else storage.setItem(TIME_ZONE_STORAGE_KEY, id);
  } catch {
    // Private mode or blocked storage: the choice still applies to this page.
  }
}

let preferred: string | null = readCache();
let device: string | undefined;

/**
 * The IANA zone this device reports (`Europe/Paris`), or `'UTC'` when the
 * runtime does not say.
 *
 * @returns the device's zone id.
 *
 * @stability experimental
 */
export function deviceTimeZone(): string {
  if (device !== undefined) return device;
  let zone = 'UTC';
  try {
    const resolved = new Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (isValidTimeZone(resolved)) zone = resolved;
  } catch {
    // An engine without Intl time zone support: UTC.
  }
  device = zone;
  return zone;
}

/**
 * The zone the user chose (`profile.timezone`), or `null` when they follow the
 * device.
 *
 * @returns the stored choice.
 *
 * @stability experimental
 */
export function getPreferredTimeZone(): string | null {
  return preferred;
}

/**
 * The zone every packaged time is rendered in: the user's choice, else the
 * device's zone, else `'UTC'`.
 *
 * @returns an IANA zone id.
 *
 * @stability experimental
 */
export function getDisplayTimeZone(): string {
  return preferred ?? deviceTimeZone();
}

/**
 * Sets the user's choice (`null` follows the device again) and notifies every
 * subscriber. An id the runtime does not know is ignored. The value is cached
 * in `localStorage` (`platform.timezone`) when the browser allows it.
 *
 * @param id - an IANA zone id, or `null`.
 *
 * @example
 * ```ts
 * setPreferredTimeZone(settings.profile.timezone ?? null);
 * ```
 *
 * @stability experimental
 */
export function setPreferredTimeZone(id: string | null): void {
  if (id !== null && !isValidTimeZone(id)) return;
  if (id === preferred) return;
  preferred = id;
  writeCache(id);
  for (const listener of [...listeners]) listener();
}

/**
 * Calls `listener` whenever the display zone may have changed.
 *
 * @param listener - called with no argument.
 * @returns the unsubscribe function.
 *
 * @stability experimental
 */
export function subscribeDisplayTimeZone(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The display zone, re-rendering the component when it changes. Use it in a
 * component that formats times, so a saved profile re-renders them.
 *
 * @returns the effective IANA zone id ({@link getDisplayTimeZone}).
 *
 * @example
 * ```tsx
 * const zone = useDisplayTimeZone();
 * return <span>{formatDateTime(job.createdAt, { timeZone: zone })}</span>;
 * ```
 *
 * @extensionPoint hook
 * @stability experimental
 */
export function useDisplayTimeZone(): string {
  return useSyncExternalStore(subscribeDisplayTimeZone, getDisplayTimeZone, getDisplayTimeZone);
}

/**
 * The user's stored choice, re-rendering on change (`null`: follow the device).
 *
 * @returns the choice ({@link getPreferredTimeZone}).
 *
 * @stability experimental
 */
export function usePreferredTimeZone(): string | null {
  return useSyncExternalStore(subscribeDisplayTimeZone, getPreferredTimeZone, getPreferredTimeZone);
}

/**
 * `profile.timezone` out of a settings profile: the id when it is a valid zone,
 * else `null`.
 *
 * @param profile - a stored profile (any shape).
 * @returns the zone id, or `null`.
 *
 * @stability experimental
 */
export function timeZoneFromProfile(profile: unknown): string | null {
  if (!profile || typeof profile !== 'object') return null;
  const value = (profile as { timezone?: unknown }).timezone;
  return isValidTimeZone(value) ? value : null;
}
