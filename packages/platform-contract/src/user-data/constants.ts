// =============================================================================
// The user-data slice's zod-free constants (issue #743, PP-9.1)
// =============================================================================
//
// Plain values and string-literal unions only (no zod), so a browser that needs
// a phrase, a path or a type never bundles zod (test/no-zod-in-constants.test.ts).
//
// ⚠ THE THREE JOB TYPES AND THE TWO BUILT-IN SCOPE IDS ARE PERMANENT. A job
// `type` string is permanent once jobs of that type exist, and a scope id is
// carried in every queued `user.data.purge` payload.
// =============================================================================

/**
 * The per-user deletion job: one user's rows and objects, for one scope.
 * PERMANENT.
 *
 * @stability experimental
 */
export const USER_DATA_PURGE_JOB_TYPE = 'user.data.purge';

/**
 * The deployment-wide factory reset job. PERMANENT.
 *
 * @stability experimental
 */
export const FACTORY_RESET_JOB_TYPE = 'admin.factory_reset';

/**
 * The organization offboarding job (multi-organization mode). PERMANENT.
 *
 * @stability experimental
 */
export const ORG_OFFBOARD_JOB_TYPE = 'org.offboard';

/**
 * The built-in scope that deletes every category. PERMANENT.
 *
 * @stability experimental
 */
export const USER_DATA_EVERYTHING_SCOPE = 'everything';

/**
 * The built-in scope that deletes the categories marked `content: true`
 * (keeping credentials and settings). PERMANENT.
 *
 * @stability experimental
 */
export const USER_DATA_CONTENT_SCOPE = 'content';

/**
 * The phrase the `everything` scope requires (EvoPath's phrase).
 *
 * @stability experimental
 */
export const USER_DATA_EVERYTHING_CONFIRMATION = 'DELETE MY DATA';

/**
 * The phrase the built-in `content` scope requires.
 *
 * @stability experimental
 */
export const USER_DATA_CONTENT_CONFIRMATION = 'DELETE MY CONTENT';

/**
 * The phrase `POST /api/admin/factory-reset` requires.
 *
 * @stability experimental
 */
export const FACTORY_RESET_CONFIRMATION = 'FACTORY RESET';

/**
 * Which layer of the Danger Zone page renders a scope: `specific` rows (one
 * per narrow scope, with live counts) above the divider, `danger` composite
 * scopes below it.
 *
 * @stability experimental
 */
export const USER_DATA_SCOPE_LAYERS = ['specific', 'danger'] as const;

/**
 * One scope layer.
 *
 * @stability experimental
 */
export type UserDataScopeLayer = (typeof USER_DATA_SCOPE_LAYERS)[number];

/**
 * What happens to the users an offboarded organization leaves without any
 * membership: `keep` (default; they stay and cannot sign in until invited
 * somewhere) or `purge` (their `everything` purge runs, then the user row is
 * deleted).
 *
 * @stability experimental
 */
export const OFFBOARDING_USER_DISPOSITIONS = ['keep', 'purge'] as const;

/**
 * One user disposition.
 *
 * @stability experimental
 */
export type OffboardingUserDisposition = (typeof OFFBOARDING_USER_DISPOSITIONS)[number];

/**
 * The states a deletion, reset or offboarding job is reported in (the queue's
 * own job statuses).
 *
 * @stability experimental
 */
export const USER_DATA_JOB_STATUSES = ['pending', 'running', 'succeeded', 'failed'] as const;

/**
 * One job status.
 *
 * @stability experimental
 */
export type UserDataJobStatus = (typeof USER_DATA_JOB_STATUSES)[number];

/**
 * Every `details.reason` (and `code`) the slice's routes answer with.
 *
 * @stability experimental
 */
export const USER_DATA_ERROR_CODES: {
  /** 400: the confirmation is not the exact phrase of the scope. */
  readonly CONFIRMATION_MISMATCH: 'CONFIRMATION_MISMATCH';
  /** 400: no scope with this id is registered. */
  readonly UNKNOWN_SCOPE: 'UNKNOWN_SCOPE';
  /** 403: `DEPLOYMENT_MODE=saas` disables the factory reset; offboard organizations instead. */
  readonly FACTORY_RESET_DISABLED_IN_SAAS: 'FACTORY_RESET_DISABLED_IN_SAAS';
  /** 409: offboarding exists only in multi-organization mode (`TENANCY_MODE=multi`). */
  readonly OFFBOARDING_REQUIRES_MULTI_ORG: 'OFFBOARDING_REQUIRES_MULTI_ORG';
  /** 409: the default organization can never be offboarded. */
  readonly DEFAULT_ORG_NOT_OFFBOARDABLE: 'DEFAULT_ORG_NOT_OFFBOARDABLE';
  /** 409: a registered offboarding precondition failed and was not skipped; `details.preconditions`. */
  readonly OFFBOARDING_PRECONDITION_FAILED: 'OFFBOARDING_PRECONDITION_FAILED';
} = {
  CONFIRMATION_MISMATCH: 'CONFIRMATION_MISMATCH',
  UNKNOWN_SCOPE: 'UNKNOWN_SCOPE',
  FACTORY_RESET_DISABLED_IN_SAAS: 'FACTORY_RESET_DISABLED_IN_SAAS',
  OFFBOARDING_REQUIRES_MULTI_ORG: 'OFFBOARDING_REQUIRES_MULTI_ORG',
  DEFAULT_ORG_NOT_OFFBOARDABLE: 'DEFAULT_ORG_NOT_OFFBOARDABLE',
  OFFBOARDING_PRECONDITION_FAILED: 'OFFBOARDING_PRECONDITION_FAILED',
};

/**
 * One error code.
 *
 * @stability experimental
 */
export type UserDataErrorCode = (typeof USER_DATA_ERROR_CODES)[keyof typeof USER_DATA_ERROR_CODES];

/**
 * The permission every user-data route requires (held by every role).
 *
 * @stability experimental
 */
export const USER_DATA_PERMISSION = 'user_settings:write';

/**
 * The permission of the factory reset routes (system scope, Admin only).
 *
 * @stability experimental
 */
export const FACTORY_RESET_PERMISSION = 'system:factory_reset';

/**
 * The permission of the offboarding routes (system scope, Admin only).
 *
 * @stability experimental
 */
export const ORG_OFFBOARD_PERMISSION = 'orgs:offboard';

/**
 * The route paths under `/api`, for a client.
 *
 * @stability experimental
 */
export const USER_DATA_PATHS: {
  /** `GET`: categories with counts, and the scopes. */
  readonly summary: '/user-data/summary';
  /** `POST`: request a deletion. `GET <deletions>/<jobId>`: its status. */
  readonly deletions: '/user-data/deletions';
  /** `GET <factoryReset>/summary`, `POST <factoryReset>`, `GET <factoryReset>/<jobId>`. */
  readonly factoryReset: '/admin/factory-reset';
  /** `/admin/orgs/<orgId>/offboarding` (+ `/summary`, `/<jobId>`). */
  readonly offboarding: (orgId: string) => string;
} = {
  summary: '/user-data/summary',
  deletions: '/user-data/deletions',
  factoryReset: '/admin/factory-reset',
  offboarding: (orgId: string) => `/admin/orgs/${encodeURIComponent(orgId)}/offboarding`,
};

/**
 * Where an operator takes a backup before a factory reset (the web route).
 *
 * @stability experimental
 */
export const FACTORY_RESET_BACKUP_PATH = '/admin/settings/db-backup';
