// `@marinoscar/platform-api/doctor`: the admin Doctor (issue #634, packaged by
// #696). Documented in ./README.md. Explicit named exports only.

export {
  DOCTOR_CATEGORIES,
  DOCTOR_STATUSES,
  DOCTOR_STATUS_RANK,
  PLATFORM_DOCTOR_CATEGORIES,
} from './doctor-check.interface';
export type {
  CoreDoctorCategory,
  DoctorCategory,
  DoctorCheck,
  DoctorCheckOutcome,
  DoctorDataValue,
  DoctorStatus,
} from './doctor-check.interface';
export { DoctorCheckRegistry } from './doctor-check.registry';
export {
  DOCTOR_CACHE_TTL_MS,
  DOCTOR_DEFAULT_TIMEOUT_MS,
  DOCTOR_FALLBACK_REMEDY,
  DoctorService,
  worstStatus,
} from './doctor.service';
export type { DoctorRunOptions } from './doctor.service';
export { DOCTOR_MODULE_OPTIONS } from './doctor.options';
export type { ResolvedDoctorModuleOptions } from './doctor.options';
export { DEFAULT_DOCTOR_PATH, DEFAULT_DOCTOR_PERMISSION, DoctorModule } from './doctor.module';
export type { DoctorModuleOptions } from './doctor.module';
export { createDoctorController } from './doctor.controller.factory';
export type { DoctorControllerInstance } from './doctor.controller.factory';
export { DoctorQueryDto } from './dto/doctor-query.dto';
export { DoctorReportDto } from './dto/doctor-report.dto';
// The wire types, from the contract (#701); re-exported so pre-contract
// imports of `@marinoscar/platform-api/doctor` keep compiling.
export type { DoctorCheckReport, DoctorQuery, DoctorReport } from '@marinoscar/platform-contract/doctor';
export {
  AIR_GAPPED_RUNBOOK,
  DEPLOYMENT_NETWORKS,
  DEPLOYMENT_NETWORK_SOURCE,
  EGRESS_MAX_HOSTS,
  EgressRegistry,
  NETWORK_EGRESS_CHECK_ID,
  NetworkEgressDoctorCheck,
  classifyHost,
  describeEgress,
  egressDependency,
  gradeEgress,
  hostnameOf,
  scopeOfHosts,
} from './egress/index';
export type {
  DeploymentNetwork,
  DeploymentNetworkSource,
  EgressContributor,
  EgressDependency,
  EgressDependencyInput,
  EgressDirection,
  EgressScope,
} from './egress/index';

// The support bundle (issue #772): `GET <path>/support-bundle`, its section
// registry, the redaction pass and the built-in sections.
export {
  COMMIT_SHA_ALLOWED_PATHS,
  REDACTED,
  SENSITIVE_KEY_PATTERN,
  SUPPORT_BUNDLE_AUDIT_ACTION,
  SUPPORT_BUNDLE_MAX_BYTES,
  SUPPORT_BUNDLE_REDACTION_VERSION,
  SUPPORT_BUNDLE_SECTION_MAX_BYTES,
  SUPPORT_BUNDLE_SECTION_TIMEOUT_MS,
  SUPPORT_BUNDLE_SUBPATH,
  SupportBundleDto,
  SupportBundleRegistry,
  SupportBundleService,
  createSupportBundleController,
  defaultSupportBundlePrincipal,
  isSupportBundleOmission,
  omitSupportBundleSection,
  redactString,
  redactValue,
} from './support-bundle/index';
export type {
  RedactValueOptions,
  RedactionResult,
  ResolvedSupportBundleOptions,
  SupportBundleBuild,
  SupportBundleControllerInstance,
  SupportBundleOmission,
  SupportBundleOptions,
  SupportBundlePrincipal,
  SupportBundleSection,
  SupportBundleSectionContext,
} from './support-bundle/index';
