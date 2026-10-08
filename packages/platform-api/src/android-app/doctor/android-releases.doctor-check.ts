import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { ANDROID_APP_SETTINGS_PATH } from '@marinoscar/platform-contract/android-app';

import { PLATFORM_PRISMA } from '../../core/index';
import { DoctorCheckRegistry, type DoctorCheck, type DoctorCheckOutcome } from '../../doctor/index';
import { AndroidAppService } from '../android-app.service';
import type { AndroidAppPrisma } from '../data/android-app-db';
import { androidDeviceSourceRegistry } from '../device-sources';

/**
 * What `android.releases` read.
 *
 * @stability experimental
 */
export interface AndroidReleaseFacts {
  /** Paired devices across every device source. */
  activeDevices: number;
  /** The current release, or null. */
  current: { packageName: string; versionName: string; versionCode: number } | null;
  /** Devices running an older build of the current package (sources that record it). */
  devicesBehind: number;
}

/**
 * The verdict of `android.releases` (pure).
 *
 * @param facts - what it read.
 * @returns the outcome.
 *
 * @stability experimental
 */
export function decideAndroidReleases(facts: AndroidReleaseFacts): DoctorCheckOutcome {
  if (facts.activeDevices === 0) {
    return { status: 'skip', detail: 'No Android device is paired', data: { activeDevices: 0, current: facts.current?.versionCode ?? null } };
  }
  if (!facts.current) {
    return {
      status: 'warn',
      detail: `${facts.activeDevices} Android device(s) are paired but no APK release is published on this server`,
      remedy: `Publish one with \`android publish\` from the CLI or upload it in Admin -> Settings -> Android app (${ANDROID_APP_SETTINGS_PATH}).`,
      data: { activeDevices: facts.activeDevices, current: null },
    };
  }
  return {
    status: 'pass',
    detail:
      `Current release ${facts.current.versionName} (${facts.current.versionCode}); ` +
      `${facts.devicesBehind} of ${facts.activeDevices} paired device(s) run an older build`,
    data: { activeDevices: facts.activeDevices, current: facts.current.versionCode, devicesBehind: facts.devicesBehind },
  };
}

/**
 * `android.releases`: paired devices have a current release to update to.
 * Read-only.
 *
 * @stability experimental
 */
@Injectable()
export class AndroidReleasesDoctorCheck implements DoctorCheck, OnModuleInit {
  /** The check id. */
  readonly id = 'android.releases';
  /** The category. */
  readonly category = 'android';
  /** The label. */
  readonly label = 'Android app releases';
  /** Where to fix it. */
  readonly settingsPath = ANDROID_APP_SETTINGS_PATH;
  /** Needs the database. */
  readonly dependsOn = ['db.connection'];

  constructor(
    private readonly registry: DoctorCheckRegistry,
    private readonly androidApp: AndroidAppService,
    @Inject(PLATFORM_PRISMA) private readonly prisma: AndroidAppPrisma,
  ) {}

  /** Registers the check. */
  onModuleInit(): void {
    this.registry.register(this);
  }

  /**
   * Reads the current release and every device source.
   *
   * @returns the outcome.
   */
  async run(): Promise<DoctorCheckOutcome> {
    try {
      const [reported, current] = await Promise.all([
        this.androidApp.getReportedApps(),
        this.prisma.androidAppRelease.findFirst({
          where: { isCurrent: true },
          select: { packageName: true, versionName: true, versionCode: true },
        }) as Promise<AndroidReleaseFacts['current']>,
      ]);
      const activeDevices = reported.reduce((sum, app) => sum + app.deviceCount, 0);
      let devicesBehind = 0;
      if (current) {
        for (const source of androidDeviceSourceRegistry.list()) {
          if (source.devicesBehind) devicesBehind += await source.devicesBehind(current.packageName, current.versionCode);
        }
      }
      return decideAndroidReleases({ activeDevices, current: current ?? null, devicesBehind });
    } catch (error) {
      return {
        status: 'fail',
        detail: 'Could not read the Android releases and paired devices',
        remedy: `Check the database connection, then open ${ANDROID_APP_SETTINGS_PATH}.`,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
