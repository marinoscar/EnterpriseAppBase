// =============================================================================
// The onboarding slice's zod-free constants (issue #745, PP-9.3)
// =============================================================================
//
// Plain values and string-literal unions only (no zod), so a browser that needs
// a constant or a type never bundles zod (test/no-zod-in-constants.test.ts).
// =============================================================================

/**
 * Who a step is for: `admin` steps form the Setup guide (the caller holds the
 * admin permission, `system_settings:read` by default), `user` steps the Get
 * started checklist every signed-in user sees.
 *
 * @stability experimental
 */
export const ONBOARDING_AUDIENCES = ['admin', 'user'] as const;

/**
 * One audience.
 *
 * @stability experimental
 */
export type OnboardingAudience = (typeof ONBOARDING_AUDIENCES)[number];

/**
 * How much a step matters, in display order: `required` (other people cannot
 * succeed without it; never skippable), `recommended`, `optional`.
 *
 * @stability experimental
 */
export const ONBOARDING_TIERS = ['required', 'recommended', 'optional'] as const;

/**
 * One tier.
 *
 * @stability experimental
 */
export type OnboardingTier = (typeof ONBOARDING_TIERS)[number];

/**
 * A step's derived status: `done` (the data says so), `todo`, or `blocked`
 * (the step cannot be done yet; `blockedReason` says why). Never stored.
 *
 * @stability experimental
 */
export const ONBOARDING_STATUSES = ['done', 'todo', 'blocked'] as const;

/**
 * One status.
 *
 * @stability experimental
 */
export type OnboardingStatus = (typeof ONBOARDING_STATUSES)[number];

/**
 * The user-settings namespace the stored onboarding UI state lives in.
 *
 * @stability experimental
 */
export const ONBOARDING_SETTINGS_KEY = 'onboarding' as const;

/**
 * The most step ids `skipped` may hold (a storage-exhaustion control: the
 * namespace is a JSONB value the user writes themselves).
 *
 * @stability experimental
 */
export const ONBOARDING_SKIPPED_MAX = 32;

/**
 * The longest step id, in characters.
 *
 * @stability experimental
 */
export const ONBOARDING_STEP_ID_MAX = 64;

/**
 * What a step id looks like: dot-namespaced, lower case
 * (`admin.storage`, `user.profile`, `<app>.<step>`).
 *
 * @stability experimental
 */
export const ONBOARDING_STEP_ID_PATTERN = /^[a-z][a-z0-9_-]*(?:\.[a-z0-9][a-z0-9_-]*)+$/;

/**
 * The metrics cohort window when `days` is not given, in days.
 *
 * @stability experimental
 */
export const ONBOARDING_METRICS_DAYS_DEFAULT = 30;

/**
 * The longest metrics cohort window, in days.
 *
 * @stability experimental
 */
export const ONBOARDING_METRICS_DAYS_MAX = 365;

/**
 * The route of the caller's onboarding state, relative to the API base.
 *
 * @stability experimental
 */
export const ONBOARDING_PATH = '/onboarding' as const;

/**
 * The route of the aggregate activation metrics, relative to the API base.
 *
 * @stability experimental
 */
export const ONBOARDING_METRICS_PATH = '/admin/onboarding/metrics' as const;

/**
 * The permission `GET /api/onboarding` requires (every role holds it).
 *
 * @stability experimental
 */
export const ONBOARDING_READ_PERMISSION = 'user_settings:read' as const;

/**
 * The permission that adds the `admin` block and gates the metrics route.
 *
 * @stability experimental
 */
export const ONBOARDING_ADMIN_PERMISSION = 'system_settings:read' as const;
