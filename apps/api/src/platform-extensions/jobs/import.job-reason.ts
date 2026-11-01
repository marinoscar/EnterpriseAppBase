import type { JobReasonDefinition } from '@marinoscar/platform-api/jobs';

// =============================================================================
// EXAMPLE, NOT WIRED: an app job reason (PP-14.19)
// =============================================================================
//
// `jobs.reason` is a plain string, so an app's own reason costs no migration.
// Registering it (`APP_JOB_REASONS` in `app-registrations/jobs.ts`) is what
// lets `JobsService.enqueue({ reason: 'import' })` through (an unregistered
// reason throws, so a typo is a bug and not a new reason) and gives the admin
// list its `reasonLabel`.
//
// An id is permanent once rows carry it: 2 to 48 lower-case letters, digits,
// `_`, `.` or `-`. Proved by test/examples/jobs/job-reason.example.spec.ts.
// =============================================================================

/** Why a bulk-import job was queued. */
export const IMPORT_JOB_REASON: JobReasonDefinition = { id: 'import', label: 'Bulk import' };
