// `@marinoscar/platform-contract/doctor`: the Doctor's wire shapes, shared by
// `@marinoscar/platform-api/doctor` (the DTOs) and
// `@marinoscar/platform-web/doctor` (the client's types) (issue #701).
// Documented in ./README.md. Explicit named exports only.
//
// constants.ts is zod-free; a consumer that imports only the constants and the
// types (the web app) never bundles schemas.ts or zod (`"sideEffects": false`).

export {
  DOCTOR_STATUSES,
  DOCTOR_STATUS_RANK,
  SUPPORT_BUNDLE_REDACTION_RULES,
  SUPPORT_BUNDLE_SECTION_STATUSES,
  SUPPORT_BUNDLE_VERSION,
} from './constants.js';
export type { DoctorStatus, SupportBundleSectionStatus } from './constants.js';
export {
  doctorCheckReportSchema,
  doctorQuerySchema,
  doctorReportSchema,
  doctorStatusSchema,
  supportBundleSchema,
  supportBundleSectionResultSchema,
} from './schemas.js';
export type {
  DoctorBooleanStringEnum,
  DoctorCheckReport,
  DoctorQuery,
  DoctorReport,
  DoctorReportQueryInput,
  DoctorStatusEnum,
  SupportBundle,
  SupportBundleSectionResult,
} from './schemas.js';
