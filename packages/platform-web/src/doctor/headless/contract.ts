// The Doctor's wire types come from `@marinoscar/platform-contract/doctor`
// (#701), the same schemas the API validates with. Type-only imports plus the
// zod-free constants module, so the web bundle never carries zod for them.
// This file keeps the two names the headless entry exported before the
// contract existed.

import { DOCTOR_STATUSES } from '@marinoscar/platform-contract/doctor';
import type { DoctorReportQueryInput, DoctorStatus } from '@marinoscar/platform-contract/doctor';

/**
 * Every status, lowest severity first (`pass < skip < warn < fail`).
 *
 * @deprecated Use `DOCTOR_STATUSES` from `@marinoscar/platform-contract/doctor`
 *   (same values, same order), or `DOCTOR_STATUS_RANK` to compare two statuses.
 * @stability stable
 */
export const DOCTOR_STATUS_ORDER: readonly DoctorStatus[] = DOCTOR_STATUSES;

/**
 * What a report request may ask for: one `category`, or `refresh` to bypass the
 * server-side cache.
 *
 * @deprecated Use `DoctorReportQueryInput` from `@marinoscar/platform-contract/doctor`.
 * @stability stable
 */
export type DoctorReportQuery = DoctorReportQueryInput;
