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
export type { DoctorQuery } from './dto/doctor-query.dto';
export { DoctorReportDto } from './dto/doctor-report.dto';
export type { DoctorCheckReport, DoctorReport } from './dto/doctor-report.dto';
export {
  DEPLOYMENT_NETWORKS,
  DEPLOYMENT_NETWORK_SOURCE,
  EGRESS_MAX_HOSTS,
  EgressRegistry,
  classifyHost,
  egressDependency,
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
