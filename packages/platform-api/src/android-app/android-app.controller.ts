import { Body, Controller, Get, HttpCode, HttpStatus, Post, Put } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type {
  AndroidAppResponse,
  AndroidAppTestNotificationResponse,
  UpdateAndroidAppInput,
} from '@marinoscar/platform-contract/android-app';

import { ErrorDto } from '../core/index';
import { Auth, CurrentUser } from '../identity/index';
import { SETTINGS_PERMISSIONS } from '../settings/index';
import { AndroidAppPushService } from './android-app-push.service';
import { AndroidAppService } from './android-app.service';
import {
  AndroidAppResponseDto,
  AndroidAppTestNotificationRequestDto,
  AndroidAppTestNotificationResponseDto,
  UpdateAndroidAppDto,
} from './dto/android-app.dto';
import { TrustedAppsValidationPipe } from './trusted-apps-validation.pipe';

// =============================================================================
//   GET  /api/admin/android-app                     system_settings:read
//   PUT  /api/admin/android-app                     system_settings:write
//   POST /api/admin/android-app/test-notification   system_settings:write
//
// Both apps' choice: the system settings permission strings, so the admin
// "Android app" card declares exactly `system_settings:read` (Settings UI
// Pattern rule 3) and the page disables its controls without `:write`.
// =============================================================================

/**
 * The trusted Android apps and the Android test notification (admin).
 *
 * @stability experimental
 */
@ApiTags('Android App')
@Controller('admin/android-app')
export class AndroidAppController {
  constructor(
    private readonly androidApp: AndroidAppService,
    private readonly androidAppPush: AndroidAppPushService,
  ) {}

  /**
   * The admin view.
   *
   * @returns trusted and reported apps, the assetlinks statements, the push counts.
   */
  @Get()
  @Auth({ permissions: [SETTINGS_PERMISSIONS.SYSTEM_SETTINGS_READ.id] })
  @ApiOperation({
    summary: 'Get the trusted Android apps (Admin)',
    description:
      'The Android apps this deployment trusts to open it as a Trusted Web Activity (full screen, no URL bar); the ' +
      'apps paired devices report through every registered device source (`reportedApps`: package and signing ' +
      'certificate fingerprint, a device count, the latest sighting and whether the pair is trusted); the Digital ' +
      'Asset Links statements `/.well-known/assetlinks.json` serves; and Web Push subscription counts by platform.',
  })
  @ApiResponse({ status: 200, description: 'Trusted and reported apps', type: AndroidAppResponseDto })
  @ApiResponse({ status: 403, description: 'Missing system_settings:read', type: ErrorDto })
  async get(): Promise<AndroidAppResponse> {
    return this.androidApp.describe();
  }

  /**
   * Replaces the trusted list.
   *
   * @param body - the validated list.
   * @param userId - the actor.
   * @returns the saved state.
   */
  @Put()
  @Auth({ permissions: [SETTINGS_PERMISSIONS.SYSTEM_SETTINGS_WRITE.id] })
  @ApiOperation({
    summary: 'Replace the trusted Android apps (Admin)',
    description:
      'Replaces the whole list (at most 10). `packageName` is an Android application id, kept exactly as sent; ' +
      "`sha256` is the signing certificate's SHA-256 fingerprint as 32 colon-separated hex bytes or 64 hex digits, " +
      'either case, stored upper-case colon-separated. Repeated pairs are dropped. Audited as ' +
      '`android_app.trusted_apps.updated`. A malformed body is a 400 whose `details.reason` is ' +
      '`TOO_MANY_TRUSTED_APPS`, `INVALID_PACKAGE_NAME`, `INVALID_FINGERPRINT` or `INVALID_TRUSTED_APPS`, with every ' +
      'problem under `details.issues`.',
  })
  @ApiBody({ type: UpdateAndroidAppDto })
  @ApiResponse({ status: 200, description: 'The saved state', type: AndroidAppResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error (`details.reason`)', type: ErrorDto })
  @ApiResponse({ status: 403, description: 'Missing system_settings:write', type: ErrorDto })
  async replace(
    @Body(TrustedAppsValidationPipe) body: UpdateAndroidAppInput,
    @CurrentUser('id') userId: string,
  ): Promise<AndroidAppResponse> {
    return this.androidApp.replace(body, userId);
  }

  /**
   * Sends the Android app test notification.
   *
   * @param body - `{ userId? }`.
   * @param userId - the actor.
   * @returns per-subscription outcomes, or a reason.
   */
  @Post('test-notification')
  @HttpCode(HttpStatus.OK)
  @Auth({ permissions: [SETTINGS_PERMISSIONS.SYSTEM_SETTINGS_WRITE.id] })
  @ApiOperation({
    summary: 'Send a test notification to the Android app (Admin)',
    description:
      'One Web Push to every subscription the target user (`userId`, default the caller) registered from inside the ' +
      'Android app (`platform: android_app`), through the runtime VAPID configuration. Not a notification: no inbox ' +
      'row, preferences do not apply. 200 for any valid request: `results` has one row per subscription (`sent`, ' +
      '`failed`, or `gone` when the push service answered 404/410 and the subscription was removed), and `reason` ' +
      'explains an empty send (`PUSH_NOT_CONFIGURED`, `NO_ANDROID_SUBSCRIPTION`). Audited as ' +
      '`android_app.test_notification.sent`.',
  })
  @ApiBody({ type: AndroidAppTestNotificationRequestDto })
  @ApiResponse({ status: 200, description: 'The per-subscription outcome', type: AndroidAppTestNotificationResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error', type: ErrorDto })
  @ApiResponse({ status: 404, description: 'No such user', type: ErrorDto })
  async testNotification(
    @Body() body: AndroidAppTestNotificationRequestDto,
    @CurrentUser('id') userId: string,
  ): Promise<AndroidAppTestNotificationResponse> {
    return this.androidAppPush.sendTest(userId, body?.userId);
  }
}
