// =============================================================================
// Is this page running inside the Android app's Trusted Web Activity? (#746)
// =============================================================================
//
// Merged from EvoPath's and MemoriaHub's `apps/web/src/utils/twa.ts`. The
// Kotlin `TwaLauncher` opens `<server>/?source=twa&appVersion=<name>&appVersionCode=<code>`
// (`ServerUrls.twaLaunchUrl` of `platform-core`). The query string is gone
// after the first in-app navigation, so `captureTwaLaunch()` runs ONCE at
// startup (the app's `main.tsx`, before the router) and remembers it in
// `sessionStorage`, which lives exactly as long as the TWA's browsing session.
// A TWA also reports its referrer as `android-app://<package>`, which covers
// a launch the flag missed.
//
// PRESENTATION ONLY: the answer decides whether to OFFER an update or a deep
// link into a native screen. It grants nothing; the server never trusts it.
// =============================================================================

import { TWA_LAUNCH_PARAMS } from '@marinoscar/platform-contract/android-app';

/**
 * The default prefix of the `sessionStorage` keys (`<prefix>.twa`, ...). An
 * app passes its identity's `storagePrefix` when two apps share an origin.
 *
 * @stability experimental
 */
export const DEFAULT_TWA_KEY_PREFIX = 'android';

/**
 * The installed Android build, as its TWA launch URL reported it.
 *
 * @stability experimental
 */
export interface InstalledAppVersion {
  /** `appVersion`, or null when the launch did not carry it. */
  versionName: string | null;
  /** `appVersionCode`. */
  versionCode: number;
}

/**
 * The `sessionStorage` keys the launch flags live under.
 *
 * @stability experimental
 */
export interface TwaSessionKeys {
  /** `1` when the session started from the Android app. */
  launched: string;
  /** The installed `versionName`. */
  versionName: string;
  /** The installed `versionCode`. */
  versionCode: string;
}

/**
 * The three `sessionStorage` keys of a prefix.
 *
 * @param prefix - the key prefix.
 * @returns the keys.
 *
 * @stability experimental
 */
export function twaSessionKeys(prefix: string = DEFAULT_TWA_KEY_PREFIX): TwaSessionKeys {
  return { launched: `${prefix}.twa`, versionName: `${prefix}.twa.appVersion`, versionCode: `${prefix}.twa.appVersionCode` };
}

function session(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * Remembers a `?source=twa` launch, and the installed build it names, for
 * the rest of the session. Call once, before the router drops the query
 * string. Safe to call more than once; never throws (blocked storage falls
 * back to the referrer check).
 *
 * @param search - the launch query string (default `window.location.search`).
 * @param prefix - the key prefix (default {@link DEFAULT_TWA_KEY_PREFIX}).
 *
 * @example
 * ```ts
 * // apps/web/src/main.tsx, before ReactDOM.createRoot
 * captureTwaLaunch();
 * ```
 *
 * @extensionPoint hook
 * @stability experimental
 */
export function captureTwaLaunch(search?: string, prefix: string = DEFAULT_TWA_KEY_PREFIX): void {
  const store = session();
  if (!store) return;
  try {
    const params = new URLSearchParams(search ?? window.location.search);
    if (params.get(TWA_LAUNCH_PARAMS.SOURCE) !== TWA_LAUNCH_PARAMS.SOURCE_VALUE) return;
    const keys = twaSessionKeys(prefix);
    store.setItem(keys.launched, '1');
    const name = params.get(TWA_LAUNCH_PARAMS.APP_VERSION);
    const code = params.get(TWA_LAUNCH_PARAMS.APP_VERSION_CODE);
    if (name) store.setItem(keys.versionName, name.slice(0, 50));
    if (code && /^\d{1,10}$/.test(code)) store.setItem(keys.versionCode, code);
  } catch {
    // Storage blocked: the referrer check below still answers.
  }
}

/**
 * True inside the Android app's TWA: the flag `captureTwaLaunch` saved, or an
 * `android-app://` referrer.
 *
 * @param prefix - the key prefix.
 * @returns whether this page runs in the TWA.
 *
 * @stability experimental
 */
export function isRunningInTwa(prefix: string = DEFAULT_TWA_KEY_PREFIX): boolean {
  try {
    if (session()?.getItem(twaSessionKeys(prefix).launched) === '1') return true;
  } catch {
    // fall through to the referrer
  }
  return typeof document !== 'undefined' && document.referrer.startsWith('android-app://');
}

/**
 * The installed build as the TWA launch URL reported it, or null outside the
 * TWA or for a build that sends no `appVersionCode`.
 *
 * @param prefix - the key prefix.
 * @returns the installed version, or null.
 *
 * @stability experimental
 */
export function getInstalledAppVersion(prefix: string = DEFAULT_TWA_KEY_PREFIX): InstalledAppVersion | null {
  if (!isRunningInTwa(prefix)) return null;
  try {
    const store = session();
    const keys = twaSessionKeys(prefix);
    const code = Number(store?.getItem(keys.versionCode));
    if (!Number.isInteger(code) || code <= 0) return null;
    return { versionName: store?.getItem(keys.versionName) ?? null, versionCode: code };
  } catch {
    return null;
  }
}
