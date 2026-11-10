import { Module, type DynamicModule } from '@nestjs/common';

import { AndroidAppNotificationChannel } from '../notifications/index';
import { StorageProvidersModule } from '../storage/index';
import { AndroidAppController } from './android-app.controller';
import { AndroidAppPushService } from './android-app-push.service';
import { ANDROID_APP_OPTIONS, resolveAndroidAppModuleOptions, type AndroidAppModuleOptions } from './android-app.options';
import { AndroidAppService } from './android-app.service';
import { AssetLinksController } from './asset-links.controller';
import { AndroidAssetLinksDoctorCheck } from './doctor/android-assetlinks.doctor-check';
import { AndroidReleasesDoctorCheck } from './doctor/android-releases.doctor-check';
import { AndroidReleaseAdminController } from './releases/android-release-admin.controller';
import { AndroidReleaseController } from './releases/android-release.controller';
import { AndroidReleaseService } from './releases/android-release.service';

/**
 * The Android companion slice: the trusted apps and the public assetlinks
 * route, the hosted APK releases with signed downloads, the Android test
 * notification, the `android_app` notification sender and the
 * `android.assetlinks` / `android.releases` doctor checks.
 *
 * @stability experimental
 */
@Module({})
export class AndroidAppModule {
  /**
   * The slice for one app. Requires the core `PlatformHostModule`
   * (`PLATFORM_PRISMA`, `AUDIT_SINK`), the global settings, doctor and
   * notifications modules, and the composed `android-app` fragment. The app's
   * manifest must have called `registerAndroidAppNotificationChannel()` (the
   * sender registers for it) and `registerAndroidAppKeyPrefixes()` first.
   *
   * @param options - see {@link AndroidAppModuleOptions}.
   * @returns the dynamic module. It exports `AndroidAppService` and `AndroidReleaseService`.
   * @throws Error when an option is invalid.
   *
   * @example
   * ```ts
   * export const androidAppModule = AndroidAppModule.forRoot({ appName: APP_NAME, apkStem: androidIdentity(identity).apkStem });
   * ```
   *
   * @extensionPoint option
   * @stability experimental
   */
  static forRoot(options: AndroidAppModuleOptions): DynamicModule {
    const resolved = resolveAndroidAppModuleOptions(options);
    return {
      module: AndroidAppModule,
      imports: [StorageProvidersModule, ...resolved.imports],
      controllers: [AndroidAppController, AssetLinksController, AndroidReleaseAdminController, AndroidReleaseController],
      providers: [
        { provide: ANDROID_APP_OPTIONS, useValue: resolved },
        AndroidAppService,
        AndroidReleaseService,
        AndroidAppPushService,
        AndroidAppNotificationChannel,
        AndroidAssetLinksDoctorCheck,
        AndroidReleasesDoctorCheck,
      ],
      exports: [ANDROID_APP_OPTIONS, AndroidAppService, AndroidReleaseService],
    };
  }
}
