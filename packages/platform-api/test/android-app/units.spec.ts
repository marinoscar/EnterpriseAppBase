// The android-app slice's pure units (#746): the APK inspector, the download
// tokens, the device-source merge, the trusted-apps pipe and the doctor
// verdicts.
import { BadRequestException } from '@nestjs/common';
import { pipeline } from 'node:stream/promises';
import { createHash } from 'node:crypto';
import { PassThrough } from 'node:stream';

import { ApkInspector } from '../../src/android-app/releases/apk-inspector';
import { signDownloadToken, verifyDownloadToken } from '../../src/android-app/releases/download-token';
import { mergeReportedApps } from '../../src/android-app/device-sources';
import { TrustedAppsValidationPipe } from '../../src/android-app/trusted-apps-validation.pipe';
import { decideAndroidAssetLinks } from '../../src/android-app/doctor/android-assetlinks.doctor-check';
import { decideAndroidReleases } from '../../src/android-app/doctor/android-releases.doctor-check';
import { buildAssetLinks } from '../../src/android-app/android-app.service';
import { versionRuleRefusal } from '../../src/android-app/releases/android-release.service';
import { OTHER_SHA, SHA, chunked, drain, fixtureApk } from './support';

const RELEASE = '00000000-0000-4000-8000-0000000000aa';
const USER = '00000000-0000-4000-8000-0000000000bb';

describe('ApkInspector', () => {
  it('passes the bytes through, counting and hashing them', async () => {
    const apk = fixtureApk(10_000);
    const inspector = new ApkInspector();
    const sink = new PassThrough();
    const collected = drain(sink);
    await pipeline(chunked(apk, 3), inspector, sink);
    expect(await collected).toEqual(apk);
    expect(inspector.sizeBytes).toBe(apk.length);
    expect(inspector.digest()).toBe(createHash('sha256').update(apk).digest('hex'));
  });

  it('refuses a file without the ZIP signature', async () => {
    const inspector = new ApkInspector();
    await expect(pipeline(chunked(Buffer.from('not a zip at all')), inspector, new PassThrough())).rejects.toBeInstanceOf(BadRequestException);
    expect((inspector.failure?.getResponse() as { details: { reason: string } }).details.reason).toBe('RELEASE_NOT_AN_APK');
  });

  it('refuses a file over the ceiling as it streams', async () => {
    const inspector = new ApkInspector(2048);
    await expect(pipeline(chunked(fixtureApk(4096)), inspector, new PassThrough())).rejects.toThrow(/exceeds/);
    expect((inspector.failure?.getResponse() as { details: { reason: string } }).details.reason).toBe('RELEASE_TOO_LARGE');
  });
});

describe('download tokens', () => {
  const key = Buffer.alloc(32, 3);

  it('round-trips the claims until expiry', () => {
    const token = signDownloadToken(key, { releaseId: RELEASE, userId: USER, expiresAt: 2000 });
    expect(verifyDownloadToken(key, token, 1999)).toEqual({ ok: true, claims: { releaseId: RELEASE, userId: USER, expiresAt: 2000 } });
    expect(verifyDownloadToken(key, token, 2000)).toEqual({ ok: false, reason: 'expired' });
  });

  it('refuses a tampered token, another key, or garbage', () => {
    const token = signDownloadToken(key, { releaseId: RELEASE, userId: USER, expiresAt: 2000 });
    const [payload, mac] = token.split('.');
    const flipped = Buffer.from(payload!, 'base64url');
    flipped[5] ^= 0xff;
    expect(verifyDownloadToken(key, `${flipped.toString('base64url')}.${mac}`, 1)).toEqual({ ok: false, reason: 'invalid' });
    expect(verifyDownloadToken(Buffer.alloc(32, 4), token, 1)).toEqual({ ok: false, reason: 'invalid' });
    expect(verifyDownloadToken(key, 'x', 1)).toEqual({ ok: false, reason: 'invalid' });
    expect(verifyDownloadToken(key, 'a'.repeat(200), 1)).toEqual({ ok: false, reason: 'invalid' });
  });
});

describe('mergeReportedApps', () => {
  it('merges sources by package and normalised fingerprint, and sorts by devices, package, fingerprint', () => {
    const lower = SHA.toLowerCase().replace(/:/g, '');
    const merged = mergeReportedApps(
      [
        { packageName: 'com.b.app', signingSha256: SHA, deviceCount: 2, lastSeenAt: new Date('2026-01-01T00:00:00Z') },
        { packageName: 'com.b.app', signingSha256: lower, deviceCount: 3, lastSeenAt: new Date('2026-02-01T00:00:00Z') },
        { packageName: 'com.a.app', signingSha256: OTHER_SHA, deviceCount: 5, lastSeenAt: null },
        { packageName: 'com.d.app', signingSha256: SHA, deviceCount: 1, lastSeenAt: null },
        { packageName: 'com.c.app', signingSha256: SHA, deviceCount: 5, lastSeenAt: null },
      ],
      [{ packageName: 'com.b.app', sha256: SHA }],
    );
    expect(merged.map((app) => [app.packageName, app.deviceCount, app.trusted])).toEqual([
      ['com.a.app', 5, false],
      ['com.b.app', 5, true],
      ['com.c.app', 5, false],
      ['com.d.app', 1, false],
    ]);
    expect(merged[1]!.lastSeenAt).toBe('2026-02-01T00:00:00.000Z');
    expect(merged[1]!.sha256).toBe(SHA);
  });

  it('is empty with no source rows', () => {
    expect(mergeReportedApps([], [])).toEqual([]);
  });
});

describe('TrustedAppsValidationPipe', () => {
  const pipe = new TrustedAppsValidationPipe();
  const reasonOf = (body: unknown): string => {
    try {
      pipe.transform(body);
    } catch (error) {
      return ((error as BadRequestException).getResponse() as { details: { reason: string } }).details.reason;
    }
    throw new Error('expected a refusal');
  };

  it('normalises bare hex and colon forms', () => {
    expect(pipe.transform({ trustedApps: [{ packageName: 'com.example.app', sha256: SHA.replace(/:/g, '').toLowerCase() }] })).toEqual({
      trustedApps: [{ packageName: 'com.example.app', sha256: SHA }],
    });
  });

  it('refuses with typed reasons, too-many first', () => {
    expect(reasonOf({ trustedApps: [{ packageName: 'com.example.app', sha256: 'nope' }] })).toBe('INVALID_FINGERPRINT');
    expect(reasonOf({ trustedApps: [{ packageName: 'bad', sha256: SHA }] })).toBe('INVALID_PACKAGE_NAME');
    expect(reasonOf({})).toBe('INVALID_TRUSTED_APPS');
    const many = Array.from({ length: 11 }, (_, i) => ({ packageName: 'bad', sha256: `${i}` }));
    expect(reasonOf({ trustedApps: many })).toBe('TOO_MANY_TRUSTED_APPS');
  });
});

describe('assetlinks', () => {
  it('groups fingerprints per package', () => {
    expect(
      buildAssetLinks([
        { packageName: 'com.example.app', sha256: SHA },
        { packageName: 'com.example.app', sha256: OTHER_SHA },
        { packageName: 'com.example.other', sha256: SHA },
      ]),
    ).toEqual([
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: { namespace: 'android_app', package_name: 'com.example.app', sha256_cert_fingerprints: [SHA, OTHER_SHA] },
      },
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: { namespace: 'android_app', package_name: 'com.example.other', sha256_cert_fingerprints: [SHA] },
      },
    ]);
  });
});

describe('versionRuleRefusal', () => {
  it('refuses a not-newer versionCode of the same package unless forced', () => {
    const current = { packageName: 'com.example.app', versionCode: 5 };
    expect(versionRuleRefusal(current, { packageName: 'com.example.app', versionCode: 5 }, false)).toBe('RELEASE_VERSION_NOT_NEWER');
    expect(versionRuleRefusal(current, { packageName: 'com.example.app', versionCode: 5 }, true)).toBeNull();
    expect(versionRuleRefusal(current, { packageName: 'com.example.app', versionCode: 6 }, false)).toBeNull();
    expect(versionRuleRefusal(current, { packageName: 'com.example.other', versionCode: 1 }, false)).toBeNull();
    expect(versionRuleRefusal(null, { packageName: 'com.example.app', versionCode: 1 }, false)).toBeNull();
  });
});

describe('doctor verdicts', () => {
  it('android.assetlinks skips with no reports, warns on untrusted, passes otherwise', () => {
    expect(decideAndroidAssetLinks([], 1).status).toBe('skip');
    const app = { packageName: 'com.example.app', sha256: SHA, deviceCount: 2, lastSeenAt: null, trusted: false };
    expect(decideAndroidAssetLinks([app], 0)).toMatchObject({ status: 'warn', data: { untrusted: 1 } });
    expect(decideAndroidAssetLinks([{ ...app, trusted: true }], 1).status).toBe('pass');
  });

  it('android.releases skips with no devices, warns without a current release, passes with one', () => {
    expect(decideAndroidReleases({ activeDevices: 0, current: null, devicesBehind: 0 }).status).toBe('skip');
    expect(decideAndroidReleases({ activeDevices: 3, current: null, devicesBehind: 0 }).status).toBe('warn');
    expect(
      decideAndroidReleases({ activeDevices: 3, current: { packageName: 'p', versionName: '1.0', versionCode: 4 }, devicesBehind: 1 }),
    ).toMatchObject({ status: 'pass', data: { devicesBehind: 1 } });
  });
});
