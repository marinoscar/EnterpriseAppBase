import { describe, expect, it } from 'vitest';

import {
  MAX_TRUSTED_ANDROID_APPS,
  adminReleaseSchema,
  androidAppTestNotificationRequestSchema,
  normalizeSha256Fingerprint,
  releaseUploadFieldsSchema,
  sha256FingerprintSchema,
  trustedAppKey,
  updateAndroidAppSchema,
} from '../src/android-app/index.js';
import { PUSH_SUBSCRIPTION_PLATFORMS, pushSubscribeSchema, pushSubscriptionResponseSchema } from '../src/notifications/index.js';

const COLON = Array.from({ length: 32 }, (_, i) => (i * 7 + 16).toString(16).toUpperCase().padStart(2, '0').slice(-2)).join(':');
const BARE = COLON.replace(/:/g, '');

describe('@marinoscar/platform-contract/android-app', () => {
  it('normalises bare hex and lower-case colon fingerprints to the stored form', () => {
    expect(normalizeSha256Fingerprint(BARE.toLowerCase())).toBe(COLON);
    expect(normalizeSha256Fingerprint(` ${COLON.toLowerCase()} `)).toBe(COLON);
    expect(sha256FingerprintSchema.parse(BARE)).toBe(COLON);
    expect(sha256FingerprintSchema.safeParse('AB:CD').success).toBe(false);
  });

  it("reads EvoPath's previously stored format back unchanged", () => {
    expect(normalizeSha256Fingerprint(COLON)).toBe(COLON);
    expect(sha256FingerprintSchema.parse(COLON)).toBe(COLON);
  });

  it('keys a pair by package and normalised fingerprint', () => {
    expect(trustedAppKey('com.example.app', BARE)).toBe(trustedAppKey('com.example.app', COLON));
    expect(trustedAppKey('com.example.app', COLON)).not.toBe(trustedAppKey('com.Example.app', COLON));
  });

  it('validates and dedupes the trusted list, at most ten', () => {
    const parsed = updateAndroidAppSchema.parse({
      trustedApps: [
        { packageName: 'com.example.app', sha256: BARE },
        { packageName: 'com.example.app', sha256: COLON },
      ],
    });
    expect(parsed.trustedApps).toEqual([{ packageName: 'com.example.app', sha256: COLON }]);
    expect(updateAndroidAppSchema.safeParse({ trustedApps: [{ packageName: 'nodots', sha256: COLON }] }).success).toBe(false);
    const tooMany = Array.from({ length: MAX_TRUSTED_ANDROID_APPS + 1 }, (_, i) => ({ packageName: `com.example.a${i}`, sha256: COLON }));
    expect(updateAndroidAppSchema.safeParse({ trustedApps: tooMany }).success).toBe(false);
    expect(updateAndroidAppSchema.safeParse({ trustedApps: [], extra: 1 }).success).toBe(false);
  });

  it('parses multipart upload fields with string booleans and defaults', () => {
    const raw = { packageName: 'com.example.app', versionName: '1.2.0', versionCode: '12', signingSha256: BARE };
    const fields = releaseUploadFieldsSchema.parse(raw);
    expect(fields).toMatchObject({ versionCode: 12, signingSha256: COLON, makeCurrent: true, force: false, trust: false, notes: null });
    expect(releaseUploadFieldsSchema.parse({ ...raw, versionCode: '3', makeCurrent: 'false', trust: '1' })).toMatchObject({ makeCurrent: false, trust: true });
    expect(releaseUploadFieldsSchema.safeParse({ ...raw, versionCode: '0' }).success).toBe(false);
    expect(releaseUploadFieldsSchema.safeParse({ ...raw, versionName: '1 2' }).success).toBe(false);
    expect(releaseUploadFieldsSchema.safeParse({ ...raw, unknown: 'x' }).success).toBe(false);
  });

  it('returns sizeBytes as a decimal string', () => {
    const base = {
      id: '00000000-0000-4000-8000-000000000001',
      packageName: 'com.example.app',
      versionName: '1.0.0',
      versionCode: 1,
      fileSha256: 'a'.repeat(64),
      notes: null,
      createdAt: '2026-10-08T00:00:00.000Z',
      signingSha256: COLON,
      isCurrent: true,
      storageProvider: 's3',
      uploadedBy: null,
    };
    expect(adminReleaseSchema.safeParse({ ...base, sizeBytes: '9007199254740993' }).success).toBe(true);
    expect(adminReleaseSchema.safeParse({ ...base, sizeBytes: 12 }).success).toBe(false);
  });

  it('takes an optional uuid userId for the test notification', () => {
    expect(androidAppTestNotificationRequestSchema.parse({})).toEqual({});
    expect(androidAppTestNotificationRequestSchema.safeParse({ userId: 'x' }).success).toBe(false);
  });
});

describe('push subscription platform (notifications contract)', () => {
  it('accepts an optional platform on subscribe and requires it on the response', () => {
    expect(PUSH_SUBSCRIPTION_PLATFORMS).toEqual(['browser', 'android_app']);
    const body = { endpoint: 'https://push.example/x', keys: { p256dh: 'p', auth: 'a' } };
    expect(pushSubscribeSchema.parse(body).platform).toBeUndefined();
    expect(pushSubscribeSchema.parse({ ...body, platform: 'android_app' }).platform).toBe('android_app');
    expect(pushSubscribeSchema.safeParse({ ...body, platform: 'ios' }).success).toBe(false);
    expect(
      pushSubscriptionResponseSchema.safeParse({ id: '00000000-0000-4000-8000-000000000001', endpoint: 'e', createdAt: '2026-10-08T00:00:00.000Z' }).success,
    ).toBe(false);
  });
});

describe('androidIdentity', () => {
  it("derives EvoPath's Gradle defaults from the repository name", async () => {
    const { androidIdentity } = await import('../src/android-app/index.js');
    expect(androidIdentity({ productName: 'Acme Hub', repoSlug: 'acme/acme-hub' })).toEqual({
      label: 'Acme Hub',
      applicationId: 'com.acmehub.android',
      deepLinkScheme: 'acme-hub-android',
      storagePrefix: 'acmehub',
      apkStem: 'acme-hub-android',
    });
    expect(androidIdentity({ productName: '!!', repoSlug: 'o/9lives' })).toMatchObject({ applicationId: 'com.app9lives.android', apkStem: 'app-android' });
  });

  it("expresses MemoriaHub's legacy values through the android block", async () => {
    const { androidIdentity } = await import('../src/android-app/index.js');
    const legacy = { applicationId: 'legacy.example.cr', deepLinkScheme: 'legacy', storagePrefix: 'legacy', apkStem: 'legacy-android' };
    expect(androidIdentity({ productName: 'Legacy', repoSlug: 'o/legacy-hub', android: legacy })).toEqual({ label: 'Legacy', ...legacy });
  });
});
