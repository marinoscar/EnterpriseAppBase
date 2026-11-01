import { Injectable, type OnModuleInit } from '@nestjs/common';
import { ANDROID_APP_SETTINGS_PATH, type ReportedAndroidApp } from '@marinoscar/platform-contract/android-app';

import { DoctorCheckRegistry, type DoctorCheck, type DoctorCheckOutcome } from '../../doctor/index';
import { AndroidAppService } from '../android-app.service';

/**
 * The verdict of `android.assetlinks` from what it read (pure).
 *
 * @param reported - the merged reported apps.
 * @param trustedCount - how many pairs are trusted.
 * @returns the outcome.
 *
 * @stability experimental
 */
export function decideAndroidAssetLinks(reported: readonly ReportedAndroidApp[], trustedCount: number): DoctorCheckOutcome {
  if (reported.length === 0) {
    return { status: 'skip', detail: 'No paired Android device has reported its app signature', data: { trusted: trustedCount, reported: 0 } };
  }
  const untrusted = reported.filter((app) => !app.trusted);
  const data = { trusted: trustedCount, reported: reported.length, untrusted: untrusted.length };
  if (untrusted.length > 0) {
    const listed = untrusted
      .slice(0, 3)
      .map((app) => `${app.packageName} (${app.sha256}, ${app.deviceCount} device(s))`)
      .join('; ');
    return {
      status: 'warn',
      detail:
        `${untrusted.length} reported Android app signature(s) not in assetlinks.json, so the app opens with a URL bar: ` +
        `${listed}${untrusted.length > 3 ? '; ...' : ''}`,
      remedy: `Trust it in Admin -> Settings -> Android app (${ANDROID_APP_SETTINGS_PATH}).`,
      data,
    };
  }
  return { status: 'pass', detail: `All ${reported.length} reported Android app signature(s) are trusted in assetlinks.json`, data };
}

/**
 * `android.assetlinks`: every signature paired devices report is trusted.
 * Read-only.
 *
 * @stability experimental
 */
@Injectable()
export class AndroidAssetLinksDoctorCheck implements DoctorCheck, OnModuleInit {
  /** The check id. */
  readonly id = 'android.assetlinks';
  /** The category. */
  readonly category = 'android';
  /** The label. */
  readonly label = 'Android app Digital Asset Links';
  /** Where to fix it. */
  readonly settingsPath = ANDROID_APP_SETTINGS_PATH;
  /** Needs the database. */
  readonly dependsOn = ['db.connection'];

  constructor(
    private readonly registry: DoctorCheckRegistry,
    private readonly androidApp: AndroidAppService,
  ) {}

  /** Registers the check. */
  onModuleInit(): void {
    this.registry.register(this);
  }

  /**
   * Reads the trusted list and the device sources.
   *
   * @returns the outcome.
   */
  async run(): Promise<DoctorCheckOutcome> {
    try {
      const trusted = await this.androidApp.getTrustedApps();
      return decideAndroidAssetLinks(await this.androidApp.getReportedApps(trusted), trusted.length);
    } catch (error) {
      return {
        status: 'fail',
        detail: 'Could not read the trusted and reported Android apps',
        remedy: `Check the database connection, then open ${ANDROID_APP_SETTINGS_PATH}.`,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
