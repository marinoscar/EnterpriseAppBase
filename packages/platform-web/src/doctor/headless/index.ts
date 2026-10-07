// `@marinoscar/platform-web/doctor/headless`: the Doctor's types, client, hook
// and category labels, with no component (issue #696). Documented in ../README.md.

export { DOCTOR_STATUS_ORDER } from './contract.js';
export type { DoctorReportQuery } from './contract.js';
// The wire types, from the contract (#701); re-exported so pre-contract
// imports of this entry keep compiling.
export type { DoctorCheckReport, DoctorReport, DoctorStatus } from '@marinoscar/platform-contract/doctor';
export { createDoctorClient } from './client.js';
export type { DoctorClient } from './client.js';
export { useDoctor } from './use-doctor.js';
export type { UseDoctorReturn } from './use-doctor.js';
export { PLATFORM_DOCTOR_CATEGORY_LABELS, categoryLabel } from './categories.js';
export type { DoctorCategoryLabel } from './categories.js';
