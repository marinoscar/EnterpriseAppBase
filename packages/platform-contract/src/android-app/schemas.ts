// =============================================================================
// The android-app slice's wire shapes (issue #746, PP-9.4)
// =============================================================================
//
// Merged from EvoPath and MemoriaHub: MemoriaHub's fingerprint normalisation
// (bare 64-hex or colon pairs, stored upper-case colon pairs), its strict
// upload fields and BigInt `sizeBytes` (a decimal string on the wire), and
// EvoPath's test notification and push subscription counts.
// =============================================================================

import { z } from 'zod';

import {
  ANDROID_APP_TEST_REASONS,
  ANDROID_APP_TEST_STATUSES,
  ANDROID_PACKAGE_NAME_PATTERN,
  ASSET_LINKS_RELATION,
  MAX_RELEASE_NOTES_LENGTH,
  MAX_TRUSTED_ANDROID_APPS,
  MAX_VERSION_CODE,
  MAX_VERSION_NAME_LENGTH,
  MIN_VERSION_CODE,
  SHA256_FINGERPRINT_PATTERN,
  VERSION_NAME_PATTERN,
  normalizeSha256Fingerprint,
  trustedAppKey,
} from './constants.js';
import type { AndroidAppTestReason, AndroidAppTestStatus } from './constants.js';

// ---- trusted apps -----------------------------------------------------------

/**
 * An Android application id, trimmed, kept case-sensitive.
 *
 * @stability experimental
 */
export const androidPackageNameSchema = z
  .string()
  .trim()
  .max(255)
  .regex(ANDROID_PACKAGE_NAME_PATTERN, 'packageName must be an Android application id such as com.example.app');

/**
 * A SHA-256 signing certificate fingerprint: 32 colon-separated hex bytes or
 * 64 hex digits, either case; the output is the stored upper-case colon form.
 *
 * @stability experimental
 */
export const sha256FingerprintSchema = z
  .string()
  .transform(normalizeSha256Fingerprint)
  .pipe(
    z
      .string()
      .regex(
        SHA256_FINGERPRINT_PATTERN,
        'sha256 must be a SHA-256 certificate fingerprint: 32 colon-separated hex bytes (AA:BB:...) or 64 hex digits',
      ),
  );

/**
 * One trusted (package, signing key) pair.
 *
 * @stability experimental
 */
export const trustedAndroidAppSchema = z
  .object({
    /** The application id. */
    packageName: androidPackageNameSchema,
    /** The signing certificate fingerprint (stored upper-case colon form). */
    sha256: sha256FingerprintSchema,
  })
  .strict();

/**
 * One trusted app, typed.
 *
 * @stability experimental
 */
export type TrustedAndroidApp = z.output<typeof trustedAndroidAppSchema>;

/**
 * Drops repeated pairs, keeping the first. Order is otherwise preserved.
 *
 * @param apps - the parsed list.
 * @returns a new list without duplicates.
 *
 * @stability experimental
 */
export function dedupeTrustedApps(apps: readonly TrustedAndroidApp[]): TrustedAndroidApp[] {
  const seen = new Set<string>();
  const result: TrustedAndroidApp[] = [];
  for (const app of apps) {
    const key = trustedAppKey(app.packageName, app.sha256);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ packageName: app.packageName, sha256: app.sha256 });
  }
  return result;
}

/**
 * The whole trusted list: at most {@link MAX_TRUSTED_ANDROID_APPS}, repeated
 * pairs dropped.
 *
 * @stability experimental
 */
export const trustedAndroidAppsSchema = z
  .array(trustedAndroidAppSchema)
  .max(MAX_TRUSTED_ANDROID_APPS, `At most ${MAX_TRUSTED_ANDROID_APPS} trusted apps`)
  .transform(dedupeTrustedApps);

/**
 * The stored value of the `android_app` `system_settings` row.
 *
 * @stability experimental
 */
export const androidAppSettingsValueSchema = z.object({
  /** The trusted pairs, in the order the administrator saved them. */
  trustedApps: trustedAndroidAppsSchema,
});

/**
 * The stored value, typed.
 *
 * @stability experimental
 */
export type AndroidAppSettingsValue = z.output<typeof androidAppSettingsValueSchema>;

/**
 * `PUT /api/admin/android-app`: replaces the whole list.
 *
 * @stability experimental
 */
export const updateAndroidAppSchema = z
  .object({
    /** The new list (at most ten pairs). */
    trustedApps: trustedAndroidAppsSchema,
  })
  .strict();

/**
 * The replace body, parsed.
 *
 * @stability experimental
 */
export type UpdateAndroidAppInput = z.output<typeof updateAndroidAppSchema>;

/**
 * One (package, signing key) pair paired devices reported, merged across
 * every registered device source.
 *
 * @stability experimental
 */
export const reportedAndroidAppSchema = z.object({
  /** The application id the devices run. */
  packageName: z.string(),
  /** The signing fingerprint they reported (normalised). */
  sha256: z.string(),
  /** How many devices report this pair. */
  deviceCount: z.number().int().nonnegative(),
  /** The latest sighting (ISO 8601), or null. */
  lastSeenAt: z.iso.datetime().nullable(),
  /** Whether the pair is in the trusted list. */
  trusted: z.boolean(),
});

/**
 * One reported app, typed.
 *
 * @stability experimental
 */
export type ReportedAndroidApp = z.infer<typeof reportedAndroidAppSchema>;

/**
 * One Digital Asset Links statement.
 *
 * @stability experimental
 */
export const assetLinkStatementSchema = z.object({
  /** Always `[ASSET_LINKS_RELATION]`. */
  relation: z.array(z.literal(ASSET_LINKS_RELATION)),
  /** The app the statement trusts. */
  target: z.object({
    /** Always `android_app`. */
    namespace: z.literal('android_app'),
    /** The application id. */
    package_name: z.string(),
    /** Every trusted fingerprint of that package. */
    sha256_cert_fingerprints: z.array(z.string()),
  }),
});

/**
 * One statement, typed.
 *
 * @stability experimental
 */
export type AssetLinkStatement = z.infer<typeof assetLinkStatementSchema>;

/**
 * Web Push subscription counts by platform (EvoPath): how many devices the
 * `android_app` channel can reach.
 *
 * @stability experimental
 */
export const androidPushSubscriptionCountsSchema = z.object({
  /** Subscriptions registered from the Android app. */
  androidApp: z.number().int().nonnegative(),
  /** Every other subscription. */
  browser: z.number().int().nonnegative(),
  /** Distinct users with at least one Android app subscription. */
  androidAppUsers: z.number().int().nonnegative(),
});

/**
 * The counts, typed.
 *
 * @stability experimental
 */
export type AndroidPushSubscriptionCounts = z.infer<typeof androidPushSubscriptionCountsSchema>;

/**
 * `GET`/`PUT /api/admin/android-app`.
 *
 * @stability experimental
 */
export const androidAppResponseSchema = z.object({
  /** The trusted pairs. */
  trustedApps: z.array(trustedAndroidAppSchema),
  /** What paired devices report, trusted or not, most devices first. */
  reportedApps: z.array(reportedAndroidAppSchema),
  /** The statement list `/.well-known/assetlinks.json` serves now. */
  assetLinks: z.array(assetLinkStatementSchema),
  /** Push subscription counts by platform. */
  pushSubscriptions: androidPushSubscriptionCountsSchema,
});

/**
 * The admin view, typed.
 *
 * @stability experimental
 */
export type AndroidAppResponse = z.infer<typeof androidAppResponseSchema>;

// ---- releases ---------------------------------------------------------------

/**
 * The string spellings a multipart boolean field accepts, as `z.enum` types them.
 *
 * @stability experimental
 */
export type BooleanFieldEnum = { [K in 'true' | 'false' | '1' | '0']: K };

/**
 * The Android test statuses, as `z.enum` types them.
 *
 * @stability experimental
 */
export type AndroidAppTestStatusEnum = { [K in AndroidAppTestStatus]: K };

/**
 * The Android test reasons, as `z.enum` types them.
 *
 * @stability experimental
 */
export type AndroidAppTestReasonEnum = { [K in AndroidAppTestReason]: K };

const booleanFieldStringSchema: z.ZodEnum<BooleanFieldEnum> = z.enum(['true', 'false', '1', '0']);
const androidAppTestStatusSchema: z.ZodEnum<AndroidAppTestStatusEnum> = z.enum(ANDROID_APP_TEST_STATUSES);
const androidAppTestReasonSchema: z.ZodEnum<AndroidAppTestReasonEnum> = z.enum(ANDROID_APP_TEST_REASONS);

const booleanField = (fallback: boolean) =>
  z
    .union([z.boolean(), booleanFieldStringSchema])
    .optional()
    .transform((value) => (value === undefined ? fallback : value === true || value === 'true' || value === '1'));

/**
 * The text fields of a release upload (multipart, so every value arrives as a
 * string). Strict: an unknown field is refused.
 *
 * @stability experimental
 */
export const releaseUploadFieldsSchema = z
  .object({
    /** The application id inside the APK. */
    packageName: androidPackageNameSchema,
    /** The human version (`1.4.0`). */
    versionName: z
      .string()
      .trim()
      .min(1)
      .max(MAX_VERSION_NAME_LENGTH)
      .regex(VERSION_NAME_PATTERN, 'versionName may contain only letters, digits, ".", "_", "+" and "-"'),
    /** The monotonically increasing build number Android compares. */
    versionCode: z.coerce.number().int('versionCode must be an integer').min(MIN_VERSION_CODE).max(MAX_VERSION_CODE),
    /** The signing certificate fingerprint of the APK. */
    signingSha256: z.string().trim().pipe(sha256FingerprintSchema),
    /** Release notes shown to users, or absent. */
    notes: z
      .string()
      .trim()
      .max(MAX_RELEASE_NOTES_LENGTH)
      .optional()
      .transform((value) => (value ? value : null)),
    /** Offer it to users at once (default `true`). */
    makeCurrent: booleanField(true),
    /** Make it current even when its versionCode is not newer (default `false`). */
    force: booleanField(false),
    /** Add an untrusted (package, signing key) pair to the trusted list (default `false`). */
    trust: booleanField(false),
  })
  .strict();

/**
 * The parsed upload fields.
 *
 * @stability experimental
 */
export type ReleaseUploadFields = z.output<typeof releaseUploadFieldsSchema>;

/**
 * What any signed-in user sees of a release (`GET /api/android-app/releases/latest`).
 *
 * @stability experimental
 */
export const publicReleaseSchema = z.object({
  /** The release id. */
  id: z.uuid(),
  /** The application id. */
  packageName: z.string(),
  /** The human version. */
  versionName: z.string(),
  /** The build number. */
  versionCode: z.number().int(),
  /** SHA-256 of the APK bytes (64 lower-case hex digits). */
  fileSha256: z.string(),
  /** The APK size in bytes, as a decimal string (the column is BigInt). */
  sizeBytes: z.string().regex(/^\d+$/),
  /** Release notes, or null. */
  notes: z.string().nullable(),
  /** Upload time (ISO 8601). */
  createdAt: z.iso.datetime(),
});

/**
 * A public release, typed.
 *
 * @stability experimental
 */
export type PublicRelease = z.infer<typeof publicReleaseSchema>;

/**
 * What an administrator sees of a release.
 *
 * @stability experimental
 */
export const adminReleaseSchema = publicReleaseSchema.extend({
  /** The signing certificate fingerprint. */
  signingSha256: z.string(),
  /** Whether this is the release users are offered. */
  isCurrent: z.boolean(),
  /** The storage provider the bytes were written to, or null. */
  storageProvider: z.string().nullable(),
  /** Who uploaded it, or null once that account is gone. */
  uploadedBy: z
    .object({
      /** The user id. */
      id: z.uuid(),
      /** Their email. */
      email: z.string(),
      /** Their display name, or null. */
      displayName: z.string().nullable(),
    })
    .nullable(),
});

/**
 * An admin release, typed.
 *
 * @stability experimental
 */
export type AdminRelease = z.infer<typeof adminReleaseSchema>;

/**
 * `POST /api/android-app/releases/:id/download-link`.
 *
 * @stability experimental
 */
export const downloadLinkSchema = z.object({
  /** A same-origin URL (`/api/android-app/download/<token>`); never log it. */
  url: z.string(),
  /** When it stops working (ISO 8601). */
  expiresAt: z.iso.datetime(),
});

/**
 * A download link, typed.
 *
 * @stability experimental
 */
export type DownloadLink = z.infer<typeof downloadLinkSchema>;

// ---- test notification ------------------------------------------------------

/**
 * `POST /api/admin/android-app/test-notification` body.
 *
 * @stability experimental
 */
export const androidAppTestNotificationRequestSchema = z
  .object({
    /** The user whose Android app subscriptions to push to; default the caller. */
    userId: z.uuid().optional(),
  })
  .strict();

/**
 * The test request, typed.
 *
 * @stability experimental
 */
export type AndroidAppTestNotificationRequest = z.infer<typeof androidAppTestNotificationRequestSchema>;

/**
 * One subscription's outcome.
 *
 * @stability experimental
 */
export const androidAppTestResultRowSchema = z.object({
  /** The subscription id. */
  subscriptionId: z.uuid(),
  /** The push service host (never the endpoint: it is a capability URL). */
  endpointHost: z.string(),
  /** `sent`, `failed` or `gone`. */
  status: androidAppTestStatusSchema,
  /** Why it failed, when it did. */
  error: z.string().optional(),
});

/**
 * One outcome, typed.
 *
 * @stability experimental
 */
export type AndroidAppTestResultRow = z.infer<typeof androidAppTestResultRowSchema>;

/**
 * The test notification response: always 200 for a valid request.
 *
 * @stability experimental
 */
export const androidAppTestNotificationResponseSchema = z.object({
  /** The target user. */
  userId: z.uuid(),
  /** How many Android app subscriptions they hold. */
  androidSubscriptions: z.number().int().nonnegative(),
  /** One row per subscription pushed to. */
  results: z.array(androidAppTestResultRowSchema),
  /** Why nothing was sent, when nothing was. */
  reason: androidAppTestReasonSchema.optional(),
});

/**
 * The test response, typed.
 *
 * @stability experimental
 */
export type AndroidAppTestNotificationResponse = z.infer<typeof androidAppTestNotificationResponseSchema>;
