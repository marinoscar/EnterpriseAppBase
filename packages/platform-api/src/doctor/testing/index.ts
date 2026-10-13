// `@marinoscar/platform-api/doctor/testing`: the Doctor slice's extension-author
// kit (PP-14.26). `describeDoctorCheckConformance` proves one check against the
// contract (a guarded run, a valid outcome, read-only); the doubles
// (`createRecordingPrisma`, `createWriteFailingStorage`) are what it runs over;
// and importing this entry registers the `doctor-read-only` suite with
// `runPlatformConformance` (option key `doctorReadOnly`), which runs the same
// proof over every registered check. Never import it from production code.
// Documented in ../README.md.

import './doctor-read-only.suite';

export { createRecordingPrisma, ReadOnlyViolationError } from './recording-prisma';
export type { RecordedPrismaOperation, RecordingPrisma, RecordingPrismaOptions } from './recording-prisma';
export { createWriteFailingStorage } from './write-failing-storage';
export type { RecordedStorageOperation, WriteFailingStorage, WriteFailingStorageOptions } from './write-failing-storage';
export { findIdentityProblems, findOutcomeProblems, runDoctorCheck } from './run-doctor-check';
export type { DoctorCheckRun, OutcomeGradingOptions, RunDoctorCheckOptions } from './run-doctor-check';
export { describeDoctorCheckConformance } from './describe-doctor-check-conformance';
export type {
  DoctorCheckConformanceOptions,
  DoctorCheckDoubles,
  DoctorCheckFactory,
  DoctorCheckScenario,
} from './describe-doctor-check-conformance';
export { DOCTOR_FORBIDDEN_SERVICES, auditDoctorChecks, doctorReadOnlySuite, findReadOnlyViolations } from './doctor-read-only.suite';
export type {
  DoctorCheckAudit,
  DoctorConformanceApp,
  DoctorConformanceContext,
  DoctorConformanceFixture,
  DoctorReadOnlyDoubles,
  DoctorReadOnlyExemption,
  DoctorReadOnlyOptions,
} from './doctor-read-only.suite';
