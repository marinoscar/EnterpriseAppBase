// =============================================================================
// Job reasons: an open vocabulary, not a closed enum
// =============================================================================
//
// Every enqueued job says WHY it exists (`upload`, `rerun`, `backfill`), and
// until the vocabulary was opened that was a Prisma enum: an app with a fourth
// reason (`import`) needed a platform migration. `jobs.reason` is now TEXT. The
// SHAPE of an id is the contract's (`JOB_REASON_PATTERN`); WHICH ids are valid
// is this registry's. The platform's three register through the same function
// an app uses, with no private fast path.
//
// WRITE side strict, READ side lenient. `JobsService` refuses to enqueue a
// reason nobody registered (a typo is a bug, not a new reason), but nothing
// here ever rejects a stored row: a reason whose registration was removed
// still lists, and `jobReasonLabel` falls back to the id.
//
// A static registry (`defineRegistry`): apps register at import time, from
// `app-registrations/`, before the application bootstraps; it freezes with the
// others. The label is display data that reaches the admin list as
// `reasonLabel`, the way `typeLabel` does.
// =============================================================================

import { BUILTIN_JOB_REASONS, JOB_REASON_PATTERN } from '@marinoscar/platform-contract/jobs';

import { defineRegistry } from '../core/index';

/**
 * One job reason.
 *
 * @stability experimental
 */
export interface JobReasonDefinition {
  /**
   * The id stored in `jobs.reason`. Matches `JOB_REASON_PATTERN` (2 to 48
   * lower-case letters, digits, `_`, `.` or `-`, starting with a letter).
   * PERMANENT once rows carry it.
   */
  id: string;
  /** A short phrase in sentence case for the admin list ("Bulk import"). */
  label: string;
}

/**
 * The registered job reasons, in registration order (the three built-ins first).
 *
 * @extensionPoint registry
 * @stability experimental
 */
export const jobReasonRegistry = defineRegistry<JobReasonDefinition>({
  name: 'job-reasons',
  idOf: (reason) => reason.id,
  idPattern: JOB_REASON_PATTERN,
  validate: (reason) => {
    if (typeof reason.label !== 'string' || reason.label.trim() === '') throw new Error('label must be a non-empty string');
    if (reason.label.length > 64) throw new Error('label must be at most 64 characters');
  },
  describeDuplicate: (_existing, incoming) =>
    `Job reason "${incoming.id}" is already registered. A reason id is permanent; pick another id.`,
});

/**
 * Registers a job reason, so `JobsService.enqueue` accepts it and the admin
 * list labels it. Call it at import time (an app's `app-registrations/`), before
 * the application bootstraps.
 *
 * @param reason - the id and its label.
 * @throws RegistryError `INVALID_ID` for an id outside `JOB_REASON_PATTERN`,
 *   `INVALID_ENTRY` for an empty or over-long label, `DUPLICATE_ID` for a
 *   repeated id, `FROZEN` after bootstrap.
 *
 * @example
 * ```ts
 * registerJobReason({ id: 'import', label: 'Bulk import' });
 * // later: jobs.enqueue({ type: 'app.import.run', reason: 'import', ... })
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function registerJobReason(reason: JobReasonDefinition): void {
  jobReasonRegistry.register({ id: reason.id, label: reason.label });
}

const BUILTIN_LABELS: Record<(typeof BUILTIN_JOB_REASONS)[number], string> = {
  upload: 'Upload',
  rerun: 'Rerun',
  backfill: 'Backfill',
};

for (const id of BUILTIN_JOB_REASONS) registerJobReason({ id, label: BUILTIN_LABELS[id] });

/**
 * Whether `reason` is registered.
 *
 * @param reason - a candidate id.
 * @returns true for a built-in or an app's registered reason.
 *
 * @stability experimental
 */
export function isJobReason(reason: string): boolean {
  return jobReasonRegistry.has(reason);
}

/**
 * Throws unless `reason` is registered. What `JobsService` calls before an
 * insert.
 *
 * @param reason - the id an enqueuer gave.
 * @throws Error naming the id, the registered ids and how to register it.
 *
 * @stability experimental
 */
export function assertJobReason(reason: string): void {
  if (isJobReason(reason)) return;
  throw new Error(
    `Unknown job reason "${String(reason)}". Registered reasons: ${jobReasonRegistry.ids().join(', ')}. ` +
      `Register it at import time with registerJobReason({ id, label }) from @marinoscar/platform-api/jobs.`,
  );
}

/**
 * The display label for a reason: the registered label, else the id itself.
 * Total: any string in, a non-empty string out (a row whose reason is no longer
 * registered still has to render).
 *
 * @param reason - a stored `jobs.reason` value.
 * @returns the label.
 *
 * @stability experimental
 */
export function jobReasonLabel(reason: string): string {
  return jobReasonRegistry.get(reason)?.label ?? reason;
}

/**
 * Every registered reason, in registration order.
 *
 * @returns a fresh array of the registered definitions.
 *
 * @stability experimental
 */
export function listJobReasons(): JobReasonDefinition[] {
  return jobReasonRegistry.list();
}
