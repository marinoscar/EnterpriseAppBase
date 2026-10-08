// `@marinoscar/platform-api/user-data`: the user-data slice (issue #743,
// PP-9.1): the registry-driven per-user deletion with scopes, the admin
// factory reset and organization offboarding. Documented in ./README.md.

export { UserDataModule } from './user-data.module';
export {
  USER_DATA_OPTIONS,
  USER_DATA_TX_TIMEOUT_MS,
  resolveUserDataModuleOptions,
} from './user-data.options';
export type { ResolvedUserDataModuleOptions, UserDataModuleOptions } from './user-data.options';
export { USER_DATA_DB, USER_DATA_ENVIRONMENT } from './ports';
export type { UserDataDbPort, UserDataEnvironment, UserDataSystemReason } from './ports';
export type {
  FactoryResetStepContext,
  FactoryResetStepDef,
  LegacyUserDataJobType,
  OffboardingPreconditionDef,
  OffboardingPreconditionVerdict,
  UserDataCategoryDef,
  UserDataModelHint,
  UserDataPurgeDelegate,
  UserDataScopeCategories,
  UserDataScopeDef,
  UserRemovalHook,
} from './user-data.types';
export {
  BUILT_IN_USER_DATA_SCOPES,
  USER_DATA_OTHER_CATEGORY,
  categoriesOfScope,
  factoryResetStepRegistry,
  findUserDataScope,
  offboardingPreconditionRegistry,
  registerFactoryResetStep,
  registerOffboardingPrecondition,
  registerUserDataCategory,
  registerUserDataModels,
  registerUserDataScope,
  resolvedUserDataScopes,
  storageObjectModelHint,
  userDataCategoryRegistry,
  userDataModelRegistry,
  userDataScopeRegistry,
} from './user-data.registries';
export {
  PLATFORM_FACTORY_RESET_STEPS,
  PLATFORM_USER_DATA_CATEGORIES,
  PLATFORM_USER_DATA_MODELS,
  registerPlatformUserData,
} from './platform-user-data';
export { groupMembershipRemovalHook } from './user-removal-hooks';
export {
  UserDataPlanError,
  backRelationFields,
  delegateName,
  orderForDeletion,
  relationsOf,
  selfUnlinkFields,
} from './purge/purge-planner';
export type { PurgeDatamodel, PurgeRelation } from './purge/purge-planner';
export {
  USER_DATA_CHUNK_SIZE,
  addCounts,
  collectUserObjectIds,
  countUserData,
  deleteStorageObjects,
  deleteUserRows,
  planUserPurge,
  readCounts,
} from './purge/user-purge';
export type { DeletedUserRows, StorageDeletionCounts, UserPurgeDelegateStep, UserPurgePlan, UserPurgeStep } from './purge/user-purge';
export { UserDataPlanService } from './user-data-plan.service';
export type { OrgDataPlan, OrgDataStep } from './user-data-plan.service';
export { USER_DATA_SUBJECT_TYPE, UserPurgeRunner, userDataPurgeInputSchema } from './user-purge.runner';
export type { UserDataPurgePayload } from './user-purge.runner';
export {
  LegacyUserDataPurgeHandler,
  LegacyUserDataPurgeHandlers,
  USER_DATA_PURGE_PROFILE,
  UserDataPurgeHandler,
} from './handlers/user-data-purge.handler';
export { FACTORY_RESET_ACTOR_ORG_ROLE, FACTORY_RESET_PROFILE, FactoryResetHandler } from './handlers/factory-reset.handler';
export { ORG_OFFBOARD_PROFILE, ORG_OFFBOARD_SUBJECT_TYPE, OrgOffboardHandler } from './handlers/org-offboard.handler';
export { FactoryResetService, OrgOffboardingService, UserDataService } from './user-data.service';
export {
  FactoryResetRequestDto,
  FactoryResetStatusDto,
  FactoryResetSummaryDto,
  OrgOffboardingRequestDto,
  OrgOffboardingStatusDto,
  OrgOffboardingSummaryDto,
  UserDataDeletionRequestDto,
  UserDataDeletionStatusDto,
  UserDataJobStartedDto,
  UserDataSummaryDto,
  createUserDataControllers,
} from './user-data.controller';
export { USER_DATA_PERMISSIONS } from './user-data.permissions';
export type { UserDataPermissionDeclaration } from './user-data.permissions';
export {
  FACTORY_RESET_RUNS_METRIC,
  ORG_OFFBOARDINGS_METRIC,
  USER_DATA_APP_METRICS,
  USER_DATA_AUDIT_ACTIONS,
  USER_DATA_METRIC_OUTCOMES,
  USER_DATA_PURGES_METRIC,
} from './user-data.metrics';
