// =============================================================================
// The exports slice's zod-free constants (issue #744, PP-9.2)
// =============================================================================
//
// Plain values and string-literal unions only (no zod), so a browser that needs
// a constant or a type never bundles zod (test/no-zod-in-constants.test.ts).
// =============================================================================

/**
 * The route group, relative to `/api`: `POST /exports`, `GET /exports`,
 * `GET /exports/:id`.
 *
 * @stability experimental
 */
export const EXPORTS_PATH = '/exports';

/**
 * `GET /exports/sources`: the sources and formats the caller may use.
 *
 * @stability experimental
 */
export const EXPORTS_SOURCES_PATH = '/exports/sources';

/**
 * An export's derived status, in lifecycle order:
 *
 * - `pending`, `running`: the job's own status;
 * - `ready`: the result is recorded, its file exists and it has not expired;
 * - `expired`: the result is recorded but the file is gone or past its expiry;
 * - `failed`: the job settled without a result.
 *
 * @stability experimental
 */
export const EXPORT_STATUSES = ['pending', 'running', 'ready', 'expired', 'failed'] as const;

/**
 * One derived status.
 *
 * @stability experimental
 */
export type ExportStatus = (typeof EXPORT_STATUSES)[number];

/**
 * Whose data a source exports: one user's (`user`) or one organization's (`org`).
 *
 * @stability experimental
 */
export const EXPORT_SCOPES = ['user', 'org'] as const;

/**
 * One scope.
 *
 * @stability experimental
 */
export type ExportScope = (typeof EXPORT_SCOPES)[number];

/**
 * A column's value type. `date` is a calendar day (`YYYY-MM-DD`), `datetime`
 * an ISO 8601 instant; both travel as strings.
 *
 * @stability experimental
 */
export const EXPORT_COLUMN_TYPES = ['string', 'number', 'boolean', 'date', 'datetime'] as const;

/**
 * One column type.
 *
 * @stability experimental
 */
export type ExportColumnType = (typeof EXPORT_COLUMN_TYPES)[number];

/**
 * The kind of one request field the export dialog draws: a date picker, a
 * checkbox, a select or a text box.
 *
 * @stability experimental
 */
export const EXPORT_REQUEST_FIELD_KINDS = ['date', 'boolean', 'select', 'text'] as const;

/**
 * One request field kind.
 *
 * @stability experimental
 */
export type ExportRequestFieldKind = (typeof EXPORT_REQUEST_FIELD_KINDS)[number];

/**
 * A source id (`user-data`) and a format id (`csv`): lowercase kebab-case.
 * Both are PERMANENT once jobs carry them.
 *
 * @stability experimental
 */
export const EXPORT_ID_PATTERN = /^[a-z][a-z0-9-]{0,47}$/;

/**
 * A dataset name inside one export (`personal_access_token`): lowercase
 * snake_case, so it is a safe file name in a zip and a safe JSON key.
 *
 * @stability experimental
 */
export const EXPORT_DATASET_PATTERN = /^[a-z][a-z0-9_]{0,62}$/;

/**
 * The download name a ready export may carry in its `Content-Disposition`:
 * lowercase kebab-case plus one short extension. Anything else is refused
 * before a URL is minted, so the header never needs quoting or escaping.
 *
 * @stability experimental
 */
export const EXPORT_FILE_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,127}\.[a-z0-9]{1,8}$/;

/**
 * How many exports `GET /exports` lists: the caller's most recent.
 *
 * @stability experimental
 */
export const EXPORT_LIST_LIMIT = 20;

/**
 * The fixed message a failed export carries. The job's `lastError` is never
 * shown: it may name a bucket, a table or a provider error.
 *
 * @stability experimental
 */
export const EXPORT_FAILED_MESSAGE = 'The export could not be created. Please try again.';

/**
 * The JSON writer's `schemaVersion`. Bumped only on a breaking change of the
 * envelope; a new field is additive and keeps it.
 *
 * @stability experimental
 */
export const EXPORT_JSON_SCHEMA_VERSION = 1;
