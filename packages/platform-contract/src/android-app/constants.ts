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
  /** More than `MAX_TRUSTED_ANDROID_APPS` pairs. */
  TOO_MANY_TRUSTED_APPS: 'TOO_MANY_TRUSTED_APPS',
  /** A package name that is not a valid application id. */
  INVALID_PACKAGE_NAME: 'INVALID_PACKAGE_NAME',
  /** A fingerprint that is not 32 bytes of hex. */
  INVALID_FINGERPRINT: 'INVALID_FINGERPRINT',
  /** Any other malformed body. */
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
  /** 409: that (package, versionCode) is already published. */
  VERSION_EXISTS: 'RELEASE_VERSION_EXISTS',
  /** 409: making current a release whose versionCode is not newer, without `force`. */
  VERSION_NOT_NEWER: 'RELEASE_VERSION_NOT_NEWER',
  /** 409: the APK's (package, signing key) is not trusted while others are, without `trust`. */
  UNTRUSTED_APP: 'RELEASE_UNTRUSTED_APP',
  /** 409: deleting the current release. */
  IS_CURRENT: 'RELEASE_IS_CURRENT',
  /** 409: a concurrent "make current" won the one-current index. */
  CURRENT_CONFLICT: 'RELEASE_CURRENT_CONFLICT',
  /** 404: no such release. */
  NOT_FOUND: 'RELEASE_NOT_FOUND',
  /** 404: no release is current. */
  NO_RELEASE: 'NO_RELEASE',
  /** 400: the upload is not a signed APK. */
  NOT_AN_APK: 'RELEASE_NOT_AN_APK',
  /** 413: over `MAX_APK_BYTES`. */
  TOO_LARGE: 'RELEASE_TOO_LARGE',
  /** 400: a malformed multipart body or field. */
  INVALID_UPLOAD: 'RELEASE_INVALID_UPLOAD',
  /** 503: no object storage is configured. */
  STORAGE_NOT_CONFIGURED: 'STORAGE_NOT_CONFIGURED',
  /** 404: a malformed or tampered download token. */
  LINK_INVALID: 'DOWNLOAD_LINK_INVALID',
  /** 410: an expired download token. */
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
  /** The query parameter that marks a TWA launch. */
  SOURCE: 'source',
  /** Its value. */
  SOURCE_VALUE: 'twa',
  /** The installed `versionName`. */
  APP_VERSION: 'appVersion',
  /** The installed `versionCode`. */
  APP_VERSION_CODE: 'appVersionCode',
} as const);

/**
 * The optional `android` block of `packages/shared/identity.json` (#746):
 * every field overrides one derived default. A shipped app copies its legacy
 * values here verbatim (MemoriaHub's `applicationId`, `deepLinkScheme`,
 * `storagePrefix`, `apkStem`), because a changed `applicationId` is a
 * different app and a changed `storagePrefix` loses the server address and
 * the pairing on installed phones.
 *
 * @stability experimental
 */
export interface AndroidIdentityOverrides {
  /** The Android application id. Default `com.<repo token>.android`. */
  readonly applicationId?: string;
  /** The custom URI scheme of the app's deep links. Default `<repo name>-android`. */
  readonly deepLinkScheme?: string;
  /** Prefix of on-device file names (encrypted preferences). Default the repo token. Never change it for a shipped app. */
  readonly storagePrefix?: string;
  /** Stem of APK file names (`<apkStem>-<versionName>.apk`). Default `<app slug>-android`. */
  readonly apkStem?: string;
}

/**
 * The fields of `packages/shared/identity.json` the Android identity derives
 * from.
 *
 * @stability experimental
 */
export interface AndroidIdentitySource {
  /** The display name. */
  readonly productName: string;
  /** `owner/name`. */
  readonly repoSlug: string;
  /** The optional overrides. */
  readonly android?: AndroidIdentityOverrides;
}

/**
 * The Android app's resolved identity.
 *
 * @stability experimental
 */
export interface AndroidIdentity {
  /** The launcher label (the product name). */
  readonly label: string;
  /** The application id (also the default trusted package). */
  readonly applicationId: string;
  /** The deep-link scheme. */
  readonly deepLinkScheme: string;
  /** The on-device file-name prefix. */
  readonly storagePrefix: string;
  /** The APK file-name stem. */
  readonly apkStem: string;
}

function slugifyName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : 'app';
}

/**
 * Resolves the Android identity from the product identity, exactly as
 * `@marinoscar/platform-infra/android/platform-core/identity.gradle.kts` does
 * at build time (EvoPath's Gradle rule): the repository name (after the `/`
 * of `repoSlug`) lower-cased to letters and digits is the token (`app` when
 * empty, `app`-prefixed when it starts with a digit); `applicationId` is
 * `com.<token>.android`, `storagePrefix` the token, `deepLinkScheme` the
 * lower-cased repository name with only scheme characters, plus `-android`,
 * and `apkStem` the product slug plus `-android`. Each `android` override
 * wins when non-empty.
 *
 * @param identity - `packages/shared/identity.json` (or the same shape).
 * @returns the resolved identity.
 *
 * @example
 * ```ts
 * androidIdentity({ productName: 'Acme Hub', repoSlug: 'acme/acme-hub' }).applicationId; // 'com.acmehub.android'
 * ```
 *
 * @stability experimental
 */
export function androidIdentity(identity: AndroidIdentitySource): AndroidIdentity {
  const repoName = identity.repoSlug.split('/')[1] || identity.repoSlug;
  let token = repoName.toLowerCase().replace(/[^a-z0-9]/g, '') || 'app';
  if (/^[0-9]/.test(token)) token = `app${token}`;
  const scheme = `${repoName.toLowerCase().replace(/[^a-z0-9+.-]/g, '').replace(/^[+.-]+/, '') || 'app'}-android`;
  const pick = (value: string | undefined, fallback: string): string => (value && value.trim() !== '' ? value.trim() : fallback);
  const overrides = identity.android ?? {};
  return Object.freeze({
    label: identity.productName,
    applicationId: pick(overrides.applicationId, `com.${token}.android`),
    deepLinkScheme: pick(overrides.deepLinkScheme, scheme),
    storagePrefix: pick(overrides.storagePrefix, token),
    apkStem: pick(overrides.apkStem, `${slugifyName(identity.productName)}-android`),
  });
}
