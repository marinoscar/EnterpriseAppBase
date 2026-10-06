// `@marinoscar/platform-web/doctor/headless`: the Doctor's types, client, hook
// and category labels, with no component (issue #696). Documented in ../README.md.

export { DOCTOR_STATUS_ORDER } from './types.js';
export type { DoctorCheckReport, DoctorReport, DoctorReportQuery, DoctorStatus } from './types.js';
export { createDoctorClient } from './client.js';
export type { DoctorClient } from './client.js';
export { useDoctor } from './use-doctor.js';
export type { UseDoctorReturn } from './use-doctor.js';
export { PLATFORM_DOCTOR_CATEGORY_LABELS, categoryLabel } from './categories.js';
export type { DoctorCategoryLabel } from './categories.js';
