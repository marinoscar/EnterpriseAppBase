// =============================================================================
// The "recent organization export" offboarding precondition (#743 with #744)
// =============================================================================
//
// "Export, then purge the org" (platform-packages spec): an organization is
// offboarded only after an `org-data` export of it succeeded in the last
// `DEFAULT_EXPORT_RETENTION_DAYS` days (7), the window in which its file can
// still be downloaded. Read from the queue's own rows: an `export.run` job of
// the organization (`subjectType: 'organization'`), succeeded, finished inside
// the window, whose payload names the `org-data` source and carries a committed
// result. The operator may still skip it with a reason
// (`skipExport.reason`), recorded in the audit event.
//
// An app registers it when it mounts the exports slice
// (`registerOffboardingPrecondition(RECENT_ORG_EXPORT_PRECONDITION)`); an app
// without exports has no way to satisfy it, so it is not a platform default.
// =============================================================================

import {
  DEFAULT_EXPORT_RETENTION_DAYS,
  EXPORT_ORG_SUBJECT_TYPE,
  EXPORT_RUN_JOB_TYPE,
  ORG_DATA_EXPORT_SOURCE_ID,
  readExportResult,
} from '../../exports/index';
import type { OffboardingPreconditionDef, OffboardingPreconditionVerdict } from '../user-data.types';

/**
 * The precondition's id.
 *
 * @stability experimental
 */
export const RECENT_ORG_EXPORT_PRECONDITION_ID = 'exports.recent-org-export';

/**
 * Builds the precondition for a window other than the default 7 days.
 *
 * @param windowDays - how recent the export must be, in days (at least 1).
 * @param now - the clock, for tests. Default `Date.now`.
 * @returns the precondition.
 * @throws Error when `windowDays` is not a positive integer.
 *
 * @stability experimental
 */
export function recentOrgExportPrecondition(windowDays: number = DEFAULT_EXPORT_RETENTION_DAYS, now: () => number = Date.now): OffboardingPreconditionDef {
  if (!Number.isSafeInteger(windowDays) || windowDays < 1) throw new Error('recentOrgExportPrecondition: windowDays must be a positive integer');
  return {
    id: RECENT_ORG_EXPORT_PRECONDITION_ID,
    label: `An organization data export completed in the last ${windowDays} days`,
    async check({ orgId }, db): Promise<OffboardingPreconditionVerdict> {
      const since = new Date(now() - windowDays * 86_400_000);
      const jobs: { payload: unknown }[] = await db.job.findMany({
        where: {
          type: EXPORT_RUN_JOB_TYPE,
          subjectType: EXPORT_ORG_SUBJECT_TYPE,
          subjectId: orgId,
          status: 'succeeded',
          finishedAt: { gte: since },
        },
        select: { payload: true },
        orderBy: { finishedAt: 'desc' },
        take: 20,
      });
      const found = jobs.some((job) => {
        const payload = job.payload as { source?: unknown } | null;
        return payload?.source === ORG_DATA_EXPORT_SOURCE_ID && readExportResult(payload) !== null;
      });
      return found
        ? { passed: true }
        : { passed: false, message: `No organization data export succeeded in the last ${windowDays} days. Export it first, or give a reason to skip.` };
    },
  };
}

/**
 * The precondition with the default window (`DEFAULT_EXPORT_RETENTION_DAYS`, 7 days).
 *
 * @stability experimental
 * @example
 * ```ts
 * registerOffboardingPrecondition(RECENT_ORG_EXPORT_PRECONDITION);
 * ```
 */
export const RECENT_ORG_EXPORT_PRECONDITION: OffboardingPreconditionDef = recentOrgExportPrecondition();
