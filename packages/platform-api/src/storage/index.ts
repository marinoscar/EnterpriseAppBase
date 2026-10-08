// `@marinoscar/platform-api/storage`: the storage slice (issue #736, PP-8.3;
// objects API #150, runtime configuration epic #372, key-prefix registry
// #679, processing job #520, profile images #367). The provider and its
// runtime configuration, the objects API, the admin storage-config routes,
// the post-upload processor registry, the object-key prefix registry with
// org-aware keys, the purge entry point and the profile-image routes.
// Documented in ./README.md. Explicit named exports only.
//
// NOTHING EXPORTED FROM HERE CAN CARRY THE STORAGE SECRET ACCESS KEY: it is
// written to and read from the credential store at `(purpose 'storage', name
// 'default')`; the admin view carries its masked status only.

// ---- the modules and their options (rung 1) -------------------------------------------
export { StorageModule } from './storage.module';
export {
  DEFAULT_MAX_SIMPLE_UPLOAD_BYTES,
  DEFAULT_STALE_UPLOAD_HOURS,
  DEFAULT_STORAGE_PART_SIZE_BYTES,
  STORAGE_OPTIONS,
  resolveStorageModuleOptions,
  simpleUploadFileSizeLimit,
} from './storage.options';
export type { ResolvedStorageModuleOptions, StorageModuleOptions } from './storage.options';
export { StorageProvidersModule } from './providers/storage-providers.module';
export { StorageConfigModule } from './config/storage-config.module';
export { ObjectProcessingModule } from './processing/object-processing.module';
export { ProfileImageModule } from './profile-image/profile-image.module';

// ---- the provider (rung 3: override STORAGE_PROVIDER) -------------------------------------
export { STORAGE_PROVIDER } from './providers/storage-provider.interface';
export type { StorageProvider } from './providers/storage-provider.interface';
export type {
  MultipartUploadInit,
  SignedPutUrlOptions,
  SignedUrlOptions,
  StorageUploadOptions,
  StorageUploadResult,
  UploadPart,
} from './providers/storage-provider.types';
export { ResolvingStorageProvider } from './providers/resolving-storage.provider';
export { DEFAULT_S3_PART_SIZE, S3StorageProvider, buildS3ClientConfig } from './providers/s3/s3-storage.provider';
export type { S3StorageProviderConfig } from './providers/s3/s3-storage.provider';
export { nodeObjectStoreBinding } from './node-object-store.binding';
export type { StorageProviderIsNodeObjectStore } from './node-object-store.binding';

// ---- the runtime configuration ------------------------------------------------------------
export { STORAGE_POLICY_CACHE_MS, StorageConfigService } from './config/storage-config.service';
export {
  MISSING_STORAGE_CONFIG_FIELDS,
  R2_DEFAULT_REGION,
  R2_ENDPOINT_HOST_SUFFIX,
  S3_COMPATIBLE_DEFAULT_REGION,
  deriveR2Endpoint,
  describeStorageConfig,
  fingerprintStorageConfig,
  resolveStorageConfig,
} from './config/storage-config';
export type { MissingStorageConfigField, ResolvedStorageConfig, StorageConfigResolution } from './config/storage-config';
export { STORAGE_SETTINGS_PATH, StorageNotConfiguredError } from './config/storage-not-configured.error';
export type { StorageNotConfiguredReason } from './config/storage-not-configured.error';
export { STORAGE_SYSTEM_SETTINGS, mergeStorageSettings } from './config/storage.system-settings';
export {
  STORAGE_CREDENTIAL_LABEL,
  STORAGE_CREDENTIAL_NAME,
  STORAGE_CREDENTIAL_PURPOSE,
  STORAGE_CREDENTIAL_PURPOSE_DEF,
} from './storage-credential.constants';
export { STORAGE_SWITCH_CONFIRMATION, UpdateStorageConfigDto } from './config/dto/update-storage-config.dto';
export { StorageConfigResponseDto } from './config/dto/storage-config-response.dto';
export { StorageConnectionTestResultDto, TestStorageConfigDto } from './config/dto/storage-connection-test.dto';
export { ProvisionStorageBucketDto, StorageBucketProvisionResultDto } from './config/dto/storage-bucket-provision.dto';
export { StorageConfigAdminService } from './config/storage-config-admin.service';
export type { StorageLocationUsage } from './config/storage-config-admin.service';
export { StorageConnectionTestService, STORAGE_PROBE_KEY_PREFIX } from './config/storage-connection-test.service';
export { StorageBucketProvisionService } from './config/storage-bucket-provision.service';
export { StorageConfigController } from './config/storage-config.controller';
export { StorageConfigDoctorCheck, decideStorageConfig } from './config/doctor/storage-config.doctor-check';
export { STORAGE_DOCTOR_PROBE_KEY, StorageBucketDoctorCheck, decideStorageProbeError } from './config/doctor/storage-bucket.doctor-check';
export { StorageEgressContributor } from './config/doctor/egress/storage.egress.contributor';

// ---- the objects API, its jobs and its processors (rung 2: the processor registry) --------
export { ObjectsService } from './objects/objects.service';
export { CompleteUploadBodyDto } from './objects/dto/complete-upload.dto';
export { DownloadUrlResponseDto } from './objects/dto/download-url-response.dto';
export { InitUploadBodyDto, InitUploadResponseDto } from './objects/dto/init-upload.dto';
export { ObjectResponseDto, UploadStatusResponseDto } from './objects/dto/object-response.dto';
export { UpdateMetadataBodyDto } from './objects/dto/update-metadata.dto';
export { StorageStatusResponseDto } from './status/dto/storage-status.dto';
export type { MultipartFile } from './objects/objects.service';
export { ObjectsController } from './objects/objects.controller';
export { StorageStatusController } from './status/storage-status.controller';
export { ObjectProcessorRegistry } from './processing/object-processor.registry';
export type { ObjectProcessor, ObjectProcessorResult } from './processing/object-processor.interface';
export { ObjectProcessingService } from './processing/object-processing.service';
export type { ObjectProcessingOutcome } from './processing/object-processing.service';
export { buildProcessedMetadata } from './processing/processing-metadata';
export { STORAGE_CLEANUP_TYPE, StorageCleanupHandler } from './handlers/storage-cleanup.handler';
export type { StaleUploadCleanupResult } from './handlers/storage-cleanup.handler';
export { STORAGE_OBJECT_PROCESS_TYPE, StorageObjectProcessHandler } from './handlers/storage-object-process.handler';
export { StorageCleanupTask } from './tasks/storage-cleanup.task';
export {
  JobInputResolutionError,
  STORAGE_OBJECT_SUBJECT_TYPE,
  resolveStorageObjectInput,
} from './storage-job-input';
export type { JobInputFailureReason, StorageObjectReader } from './storage-job-input';
export { mimeTypeMatches, normaliseMimeType } from './mime-type-match';

// ---- object keys: the prefix registry, scopes and the key builder (rung 2) -----------------
export {
  KEY_PREFIX_SCOPES,
  STORAGE_KEY_PREFIX_PATTERN,
  allKeyPrefixes,
  buildObjectKey,
  isRegisteredStorageKey,
  orgKeyPrefixes,
  registerKeyPrefix,
  registerStorageKeyPrefixes,
  storageKeyPrefixRegistry,
  survivingKeyPrefixes,
} from './storage-key-prefix.registry';
export type { KeyPrefixDef, KeyPrefixScope, ObjectKeyContext, StorageKeyPrefixDef } from './storage-key-prefix.registry';
export {
  AVATARS_KEY_PREFIX,
  NODE_OUTPUTS_KEY_PREFIX,
  STORAGE_SLICE_KEY_PREFIXES,
  STORAGE_TEST_KEY_PREFIX,
  UPLOADS_KEY_PREFIX,
  registerStorageSliceKeyPrefixes,
} from './storage-key-prefixes';

// ---- the purge entry point -----------------------------------------------------------------
export { runStoragePurge, runStoragePurgeCli } from './purge/run-storage-purge';
export type {
  StoragePurgeClient,
  StoragePurgeOptions,
  StoragePurgeOutcome,
  StoragePurgePrefixReport,
  StoragePurgeReport,
} from './purge/run-storage-purge';

// ---- profile images ------------------------------------------------------------------------
export {
  AVATAR_MAX_BYTES,
  AVATAR_MIME_TYPES,
  AVATAR_PURPOSE,
  avatarKeyPrefix,
  avatarUrl,
  detectImageType,
  isAvatarObjectFor,
  isUuid,
  normalizeProfileSettings,
  resolveProfileImageUrl,
} from './profile-image/profile-image';
export type {
  AvatarCandidate,
  AvatarMimeType,
  DetectedImageType,
  NormalizedProfileSettings,
  ProfileImageUser,
} from './profile-image/profile-image';
export { ProfileImageService } from './profile-image/profile-image.service';
export type { ProfileImageResult } from './profile-image/profile-image.service';
export { AvatarService } from './profile-image/avatar.service';
export type { OpenedAvatar } from './profile-image/avatar.service';
export { AvatarController } from './profile-image/avatar.controller';
export { createProfileImageController } from './profile-image/profile-image.controller';
export type { ProfileImageControllerShape } from './profile-image/profile-image.controller';

// ---- the host ports and the data (rung 3) -------------------------------------------------
export { STORAGE_SYSTEM_DATA } from './ports';
export type { StorageSystemData } from './ports';
export { StorageObjectStatus, storageForOrg, storageRunInOrg } from './data/storage-db';
export type {
  StorageBatchPayload,
  StorageDelegate,
  StorageInputJsonArray,
  StorageInputJsonObject,
  StorageInputJsonValue,
  StorageJsonArray,
  StorageJsonObject,
  StorageJsonValue,
  StorageObject,
  StorageObjectChunk,
  StoragePrisma,
  StorageQueryArgs,
  StorageRunInOrgOptions,
  StorageTx,
} from './data/storage-db';

// ---- permissions, as data for the app's permission registry -------------------------------
export { STORAGE_PERMISSIONS } from './storage.permissions';
export type { StoragePermissionDeclaration } from './storage.permissions';
export { STORAGE_CONFIG_PERMISSIONS } from './config/storage-config.permissions';
