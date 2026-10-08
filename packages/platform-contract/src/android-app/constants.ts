// =============================================================================
// The android-app slice's zod-free constants (issue #746, PP-9.4)
// =============================================================================
//
// Plain values, string-literal unions and two pure helpers (no zod), so a
// browser or the CLI that needs a constant, a type or the fingerprint
// normaliser never bundles zod (test/no-zod-in-constants.test.ts). Merged from
// EvoPath's and MemoriaHub's `apps/api/src/android-app/`.
// =============================================================================

/**
 * The `system_settings` row key holding the trusted Android apps
 * (`{ trustedApps: [...] }`). Permanent: renaming it forgets every trusted app.
 *
 * @stability experimental
 */
export const ANDROID_APP_SETTINGS_KEY = 'android_app' as const;

/**
 * The admin web route of the Android app page (the `android` card of the
 * admin settings hub).
 *
 * @stability experimental
 */
export const ANDROID_APP_SETTINGS_PATH = '/admin/settings/android' as const;

/**
 * The admin API route of the trusted apps (`GET`/`PUT`), under `/api`.
 *
 * @stability experimental
 */
export const ANDROID_APP_ADMIN_PATH = '/admin/android-app' as const;

/**
 * The public Digital Asset Links route, under `/api`. The edge proxy maps
 * `/.well-known/assetlinks.json` to it.
 *
 * @stability experimental
 */
export const ASSET_LINKS_API_PATH = '/well-known/assetlinks.json' as const;

/**
 * `Cache-Control` of the assetlinks response: Chrome and the verifier may
 * cache it for five minutes.
 *
 * @stability experimental
 */
export const ASSET_LINKS_CACHE_CONTROL = 'public, max-age=300' as const;

/**
 * The relation every statement grants: open the site full screen.
 *
 * @stability experimental
 */
export const ASSET_LINKS_RELATION = 'delegate_permission/common.handle_all_urls' as const;

/**
 * The most trusted apps one deployment keeps.
 *
 * @stability experimental
 */
export const MAX_TRUSTED_ANDROID_APPS = 10;

/**
 * An Android application id (`com.example.app`): two or more dot-separated
 * segments, each starting with a letter. Case-sensitive, kept as sent.
 *
 * @stability experimental
 */
export const ANDROID_PACKAGE_NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/;

/**
 * The stored form of a SHA-256 signing certificate fingerprint: 32 upper-case
 * hex bytes separated by colons (as `keytool -list -v` prints it).
 *
 * @stability experimental
 */
export const SHA256_FINGERPRINT_PATTERN = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;

const SHA256_BARE_HEX_PATTERN = /^[0-9a-fA-F]{64}$/;

/**
 * Normalises a SHA-256 certificate fingerprint to the stored form: 64 bare
 * hex digits become colon-separated pairs, every form is trimmed and
 * upper-cased. Anything else is returned trimmed and upper-cased, for the
 * schema to reject. EvoPath's stored values (already upper-case colon pairs)
 * read back unchanged.
 *
 * @param value - `AA:BB:...`, `aa:bb:...` or 64 hex digits.
 * @returns the normalised string (not necessarily valid).
 *
 * @example
 * ```ts
 * normalizeSha256Fingerprint('ab'.repeat(32)); // 'AB:AB:...:AB'
 * ```
 *
 * @stability experimental
 */
export function normalizeSha256Fingerprint(value: string): string {
  const trimmed = value.trim();
  if (SHA256_BARE_HEX_PATTERN.test(trimmed)) {
    return trimmed.toUpperCase().match(/.{2}/g)!.join(':');
  }
  return trimmed.toUpperCase();
}

/**
 * The identity of a (package, signing key) pair: the merge key of the trusted
 * list and of every device source's reported apps.
 *
 * @param packageName - the application id, case-sensitive.
 * @param sha256 - the fingerprint in any accepted form.
 * @returns a string unique per pair.
 *
 * @stability experimental
 */
export function trustedAppKey(packageName: string, sha256: string): string {
  return `${packageName}\u0000${normalizeSha256Fingerprint(sha256)}`;
}

/**
 * The typed `details.reason` of a refused `PUT /api/admin/android-app`
 * (MemoriaHub's validation pipe), in priority order.
 *
 * @stability experimental
 */
export const TRUSTED_APPS_ERROR_REASONS = Object.freeze({
  TOO_MANY_TRUSTED_APPS: 'TOO_MANY_TRUSTED_APPS',
  INVALID_PACKAGE_NAME: 'INVALID_PACKAGE_NAME',
  INVALID_FINGERPRINT: 'INVALID_FINGERPRINT',
  INVALID_TRUSTED_APPS: 'INVALID_TRUSTED_APPS',
} as const);

/**
 * One trusted-apps refusal reason.
 *
 * @stability experimental
 */
export type TrustedAppsErrorReason = (typeof TRUSTED_APPS_ERROR_REASONS)[keyof typeof TRUSTED_APPS_ERROR_REASONS];

/**
 * The storage key prefix of the hosted APKs. Registered with the storage key
 * prefix registry as `android-releases` (`survivesFactoryReset: true`).
 * Permanent once a release is stored.
 *
 * @stability experimental
 */
export const ANDROID_RELEASES_KEY_PREFIX = 'android-releases/' as const;

/**
 * The largest APK an upload accepts (150 MiB).
 *
 * @stability experimental
 */
export const MAX_APK_BYTES = 150 * 1024 * 1024;

/**
 * The smallest `versionCode` Android accepts.
 *
 * @stability experimental
 */
export const MIN_VERSION_CODE = 1;

/**
 * The largest `versionCode` Google Play accepts (2 100 000 000); the platform
 * keeps the same ceiling.
 *
 * @stability experimental
 */
export const MAX_VERSION_CODE = 2_100_000_000;

/**
 * The longest `versionName` (the column is `VARCHAR(50)`).
 *
 * @stability experimental
 */
export const MAX_VERSION_NAME_LENGTH = 50;

/**
 * The longest release notes (the column is `VARCHAR(2000)`).
 *
 * @stability experimental
 */
export const MAX_RELEASE_NOTES_LENGTH = 2000;

/**
 * What a `versionName` may contain: letters, digits, `.`, `_`, `+`, `-`.
 *
 * @stability experimental
 */
export const VERSION_NAME_PATTERN = /^[0-9A-Za-z][0-9A-Za-z._+-]*$/;

/**
 * The APK media type, on upload and download.
 *
 * @stability experimental
 */
export const APK_MIME_TYPE = 'application/vnd.android.package-archive' as const;

/**
 * The multipart field the APK travels in.
 *
 * @stability experimental
 */
export const APK_FILE_FIELD = 'apk' as const;

/**
 * How long a signed download link stays valid (ten minutes).
 *
 * @stability experimental
 */
export const DOWNLOAD_LINK_TTL_SECONDS = 10 * 60;

/**
 * The same-origin route a download link points at, under `/api`.
 *
 * @stability experimental
 */
export const DOWNLOAD_ROUTE_PREFIX = '/api/android-app/download/' as const;

/**
 * The typed `details.reason` of every refused release call.
 *
 * @stability experimental
 */
export const ANDROID_RELEASE_REASONS = Object.freeze({
  VERSION_EXISTS: 'RELEASE_VERSION_EXISTS',
  VERSION_NOT_NEWER: 'RELEASE_VERSION_NOT_NEWER',
  UNTRUSTED_APP: 'RELEASE_UNTRUSTED_APP',
  IS_CURRENT: 'RELEASE_IS_CURRENT',
  CURRENT_CONFLICT: 'RELEASE_CURRENT_CONFLICT',
  NOT_FOUND: 'RELEASE_NOT_FOUND',
  NO_RELEASE: 'NO_RELEASE',
  NOT_AN_APK: 'RELEASE_NOT_AN_APK',
  TOO_LARGE: 'RELEASE_TOO_LARGE',
  INVALID_UPLOAD: 'RELEASE_INVALID_UPLOAD',
  STORAGE_NOT_CONFIGURED: 'STORAGE_NOT_CONFIGURED',
  LINK_INVALID: 'DOWNLOAD_LINK_INVALID',
  LINK_EXPIRED: 'DOWNLOAD_LINK_EXPIRED',
} as const);

/**
 * One release refusal reason.
 *
 * @stability experimental
 */
export type AndroidReleaseReason = (typeof ANDROID_RELEASE_REASONS)[keyof typeof ANDROID_RELEASE_REASONS];

/**
 * Why `POST /api/admin/android-app/test-notification` sent nothing.
 *
 * @stability experimental
 */
export const ANDROID_APP_TEST_REASONS = ['NO_ANDROID_SUBSCRIPTION', 'PUSH_NOT_CONFIGURED'] as const;

/**
 * One test-notification reason.
 *
 * @stability experimental
 */
export type AndroidAppTestReason = (typeof ANDROID_APP_TEST_REASONS)[number];

/**
 * The per-subscription outcome of a test notification: `gone` when the push
 * service answered 404/410 and the subscription was removed.
 *
 * @stability experimental
 */
export const ANDROID_APP_TEST_STATUSES = ['sent', 'failed', 'gone'] as const;

/**
 * One test-notification outcome.
 *
 * @stability experimental
 */
export type AndroidAppTestStatus = (typeof ANDROID_APP_TEST_STATUSES)[number];

/**
 * The query flags a Trusted Web Activity launch URL carries
 * (`?source=twa&appVersion=<name>&appVersionCode=<code>`), built by the
 * Kotlin `ServerUrls.twaLaunchUrl` and read once by the web's
 * `captureTwaLaunch()`.
 *
 * @stability experimental
 */
export const TWA_LAUNCH_PARAMS = Object.freeze({
  SOURCE: 'source',
  SOURCE_VALUE: 'twa',
  APP_VERSION: 'appVersion',
  APP_VERSION_CODE: 'appVersionCode',
} as const);
