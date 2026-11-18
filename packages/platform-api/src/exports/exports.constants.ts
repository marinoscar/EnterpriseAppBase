// =============================================================================
// The exports slice's constants (issue #744)
// =============================================================================
//
// Job types, audit names, the storage key prefixes and the defaults (EvoPath's
// `health-export.constants.ts` values). Plain data, no Nest import.
// =============================================================================

import type { StorageKeyPrefixDef } from '../storage/index';

/**
 * The export job. PERMANENT once rows of it exist.
 *
 * @stability experimental
 */
export const EXPORT_RUN_JOB_TYPE = 'export.run';

/**
 * The housekeeping job that deletes expired export files. PERMANENT.
 *
 * @stability experimental
 */
export const EXPORT_PURGE_JOB_TYPE = 'export.purge';

/**
 * `Job.subjectType` of a user export (`subjectId` is the user id). The same
 * value the user-data reset matches when it deletes a user's pending jobs.
 *
 * @stability experimental
 */
export const EXPORT_USER_SUBJECT_TYPE = 'user';

/**
 * `Job.subjectType` of an organization export (`subjectId` is the
 * organization id), the jobs README's convention for org-scoped work.
 *
 * @stability experimental
 */
export const EXPORT_ORG_SUBJECT_TYPE = 'organization';

/**
 * The audit action written when an export file is produced. Its `meta` holds
 * the source, the format, the row counts and the size: never a value, a file
 * name or a URL.
 *
 * @stability experimental
 */
export const EXPORT_AUDIT_ACTION = 'export:create';

/**
 * The audit `targetType`; `targetId` is the export (job) id.
 *
 * @stability experimental
 */
export const EXPORT_AUDIT_TARGET = 'export';

/**
 * `storage_objects.metadata.source` of an export file: the user-data reset's
 * `files` category deletes it with the rest of the user's uploads.
 *
 * @stability experimental
 */
export const EXPORT_OBJECT_SOURCE = 'export';

/**
 * Every export file lives under this root (both prefixes below). The purge
 * selects rows by it. Not a `*_KEY_PREFIX`: the key-prefix tripwire would
 * read it as a third, unregistered prefix.
 *
 * @stability experimental
 */
export const EXPORTS_STORAGE_ROOT = 'exports/';

/**
 * A user's exports: `exports/users/<userId>/<exportId>.<ext>`.
 *
 * @stability experimental
 */
export const EXPORTS_USERS_KEY_PREFIX = 'exports/users/';

/**
 * An organization's exports: `exports/orgs/<orgId>/<exportId>.<ext>`, one
 * listable prefix per organization (`orgKeyPrefixes`), so offboarding never
 * scans the bucket.
 *
 * @stability experimental
 */
export const EXPORTS_ORGS_KEY_PREFIX = 'exports/orgs/';

/**
 * The slice's object-key prefixes, for the app's key-prefix manifest (so the
 * standalone storage purge reaches them) and for `ExportsModule.forRoot()`,
 * which registers them too (idempotent).
 *
 * @stability experimental
 */
export const EXPORTS_KEY_PREFIXES: readonly StorageKeyPrefixDef[] = Object.freeze([
  Object.freeze({
    id: 'exports-users',
    prefix: EXPORTS_USERS_KEY_PREFIX,
    owner: 'exports',
    scope: 'user' as const,
    description: "Data exports of one user, under exports/users/<userId>/, deleted after the retention period.",
  }),
  Object.freeze({
    id: 'exports-orgs',
    prefix: EXPORTS_ORGS_KEY_PREFIX,
    owner: 'exports',
    scope: 'org' as const,
    description: "Data exports of one organization, under exports/orgs/<orgId>/, deleted after the retention period.",
  }),
]);

/**
 * How long an export file is kept: 7 days.
 *
 * @stability stable
 */
export const DEFAULT_EXPORT_RETENTION_DAYS = 7;

/**
 * Lifetime of a signed download URL: 300 seconds.
 *
 * @stability stable
 */
export const DEFAULT_EXPORT_DOWNLOAD_URL_TTL_SECONDS = 300;

/**
 * Exports one subject may have pending or running at once; the next is a 429.
 *
 * @stability stable
 */
export const DEFAULT_EXPORT_MAX_IN_FLIGHT = 3;

/**
 * Rows read per page by the platform sources.
 *
 * @stability stable
 */
export const DEFAULT_EXPORT_PAGE_SIZE = 500;

/**
 * Storage rows the purge reads per batch.
 *
 * @stability stable
 */
export const EXPORT_PURGE_BATCH = 200;
