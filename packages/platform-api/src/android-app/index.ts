// `@marinoscar/platform-api/android-app`: the Android companion slice (issue
// #746, PP-9.4; merged from EvoPath and MemoriaHub). Documented in
// ./README.md. Explicit named exports only.

export { AndroidAppModule } from './android-app.module';
export { ANDROID_APP_OPTIONS, resolveAndroidAppModuleOptions } from './android-app.options';
export type { AndroidAppImport, AndroidAppModuleOptions, ResolvedAndroidAppModuleOptions } from './android-app.options';

// ---- seams ------------------------------------------------------------------
export { androidDeviceSourceRegistry, mergeReportedApps, registerAndroidDeviceSource } from './device-sources';
export type { AndroidDeviceSource, AndroidDeviceSourceRow } from './device-sources';
export { ANDROID_RELEASES_KEY_PREFIX_DEF, androidReleaseKey, registerAndroidAppKeyPrefixes } from './android-app.key-prefixes';

// ---- services ---------------------------------------------------------------
export { ANDROID_APP_TRUSTED_APPS_UPDATED_ACTION, AndroidAppService, buildAssetLinks } from './android-app.service';
export {
  ANDROID_RELEASE_AUDIT,
  AndroidReleaseService,
  ONE_CURRENT_RELEASE_INDEX,
  toAdminRelease,
  toClientUploadError,
  toPublicRelease,
  versionRuleRefusal,
} from './releases/android-release.service';
export type {
  OpenedDownload,
  ReleaseUploader,
  ReleaseUploadPart,
  ReleaseUploadStream,
  ReleaseWithUploader,
  UploadTarget,
} from './releases/android-release.service';
export {
  ANDROID_APP_TEST_EVENT_KEY,
  ANDROID_APP_TEST_NOTIFICATION_ACTION,
  AndroidAppPushService,
  toResultRow,
} from './android-app-push.service';
export { ApkInspector, ZIP_MAGIC } from './releases/apk-inspector';
export {
  DOWNLOAD_TOKEN_KEY_PURPOSE,
  downloadTokenKey,
  signDownloadToken,
  verifyDownloadToken,
} from './releases/download-token';
export type { DownloadTokenClaims, DownloadTokenVerdict } from './releases/download-token';
export { TrustedAppsValidationPipe, reasonForIssue } from './trusted-apps-validation.pipe';

// ---- controllers, DTOs, doctor checks -----------------------------------------
export { AndroidAppController } from './android-app.controller';
export { AssetLinksController } from './asset-links.controller';
export { AndroidReleaseAdminController } from './releases/android-release-admin.controller';
export { AndroidReleaseController } from './releases/android-release.controller';
export {
  AdminReleaseDto,
  AndroidAppResponseDto,
  AndroidAppTestNotificationRequestDto,
  AndroidAppTestNotificationResponseDto,
  DownloadLinkDto,
  PublicReleaseDto,
  UpdateAndroidAppDto,
} from './dto/android-app.dto';
export { AndroidAssetLinksDoctorCheck, decideAndroidAssetLinks } from './doctor/android-assetlinks.doctor-check';
export { AndroidReleasesDoctorCheck, decideAndroidReleases } from './doctor/android-releases.doctor-check';
export type { AndroidReleaseFacts } from './doctor/android-releases.doctor-check';

// ---- the app's model registries ---------------------------------------------------
export { ANDROID_APP_MODEL_OWNERSHIP, ANDROID_APP_USER_OWNED_MODELS } from './user-data';

// ---- structural data ----------------------------------------------------------
export { isUniqueViolation } from './data/android-app-db';
export type {
  AndroidAppBatchResult,
  AndroidAppDelegate,
  AndroidAppPrisma,
  AndroidAppQueryArgs,
  AndroidAppReleaseRow,
  AndroidAppTx,
} from './data/android-app-db';
