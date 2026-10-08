// =============================================================================
// The onboarding slice's wire shapes (issue #745, PP-9.3)
// =============================================================================
//
// The stored `onboarding` user-settings namespace (UI state only: a step's
// completion is DERIVED on every request, never stored), the query and
// response of `GET /api/onboarding`, and the query and response of
// `GET /api/admin/onboarding/metrics`. Shared by
// `@marinoscar/platform-api/onboarding` (which wraps them as DTOs, so the
// OpenAPI document is generated from them) and `@marinoscar/platform-web/onboarding`.
//
// NO `.default()` in the stored namespace: absent means "never seen, never
// dismissed, nothing skipped".
// =============================================================================

import { z } from 'zod';

import {
  ONBOARDING_AUDIENCES,
  ONBOARDING_METRICS_DAYS_DEFAULT,
  ONBOARDING_METRICS_DAYS_MAX,
  ONBOARDING_SKIPPED_MAX,
  ONBOARDING_STATUSES,
  ONBOARDING_STEP_ID_MAX,
  ONBOARDING_TIERS,
} from './constants.js';

// =============================================================================
// Enum entry types (named, so the published types stay readable)
// =============================================================================

/**
 * The entries of the audience enum.
 *
 * @stability experimental
 */
export type OnboardingAudienceEnum = { [K in (typeof ONBOARDING_AUDIENCES)[number]]: K };
/**
 * The entries of the tier enum.
 *
 * @stability experimental
 */
export type OnboardingTierEnum = { [K in (typeof ONBOARDING_TIERS)[number]]: K };
/**
 * The entries of the status enum.
 *
 * @stability experimental
 */
export type OnboardingStatusEnum = { [K in (typeof ONBOARDING_STATUSES)[number]]: K };
/**
 * The entries of the `refresh` query enum.
 *
 * @stability experimental
 */
export type OnboardingRefreshEnum = {
  /** Bypass the Doctor's cache. */
  true: 'true';
  /** Use it. */
  false: 'false';
};

/**
 * A step's audience.
 *
 * @stability experimental
 */
export const onboardingAudienceSchema: z.ZodEnum<OnboardingAudienceEnum> = z.enum(ONBOARDING_AUDIENCES);
/**
 * A step's tier.
 *
 * @stability experimental
 */
export const onboardingTierSchema: z.ZodEnum<OnboardingTierEnum> = z.enum(ONBOARDING_TIERS);
/**
 * A step's derived status.
 *
 * @stability experimental
 */
export const onboardingStatusSchema: z.ZodEnum<OnboardingStatusEnum> = z.enum(ONBOARDING_STATUSES);
/**
 * The raw `refresh` query value.
 *
 * @stability experimental
 */
export const onboardingRefreshSchema: z.ZodEnum<OnboardingRefreshEnum> = z.enum(['true', 'false']);

// =============================================================================
// The stored namespace
// =============================================================================

const isoDateTime = z.string().datetime({ offset: true });

/**
 * The fields of the stored `onboarding` namespace, as a zod shape. An app
 * extends the namespace with its own fields through `extendOnboardingSettings`
 * in `@marinoscar/platform-api/onboarding`; it never edits this shape.
 *
 * @stability experimental
 */
export const onboardingSettingsShape = {
  /** The welcome dialog was closed, by any route. */
  welcomeSeenAt: isoDateTime.optional(),
  /** The user hid the Get started checklist. */
  checklistDismissedAt: isoDateTime.optional(),
  /** An administrator hid the Setup guide prompt. */
  adminDismissedAt: isoDateTime.optional(),
  /** Ids of registered, skippable steps the user chose to skip. */
  skipped: z.array(z.string().min(1).max(ONBOARDING_STEP_ID_MAX)).max(ONBOARDING_SKIPPED_MAX).optional(),
};

/**
 * The stored `onboarding` namespace (`user_settings.value.onboarding`).
 * `.strict()`: an unknown key is refused, so the namespace stays closed until
 * an app extends it.
 *
 * @stability experimental
 */
export const onboardingSettingsSchema = z.object(onboardingSettingsShape).strict();

/**
 * The stored `onboarding` namespace.
 *
 * @stability experimental
 */
export type OnboardingSettings = z.infer<typeof onboardingSettingsSchema>;

/**
 * `onboarding` in a `PATCH /api/user-settings` body: every field optional,
 * and an explicit `null` clears it (a shallow merge).
 *
 * @stability experimental
 */
export const onboardingSettingsPatchSchema = z
  .object({
    /** Set when the welcome was closed; `null` clears it. */
    welcomeSeenAt: isoDateTime.nullable().optional(),
    /** Set when the Get started checklist was hidden; `null` clears it. */
    checklistDismissedAt: isoDateTime.nullable().optional(),
    /** Set when the Setup guide prompt was hidden; `null` clears it. */
    adminDismissedAt: isoDateTime.nullable().optional(),
    /** The skipped step ids, replacing the stored list; `null` clears it. */
    skipped: onboardingSettingsShape.skipped.unwrap().nullable().optional(),
  })
  .strict();

/**
 * A parsed `onboarding` PATCH branch.
 *
 * @stability experimental
 */
export type OnboardingSettingsPatch = z.infer<typeof onboardingSettingsPatchSchema>;

// =============================================================================
// GET /api/onboarding
// =============================================================================

/**
 * The query of `GET /api/onboarding`. `refresh` is a string enum, NOT a
 * coerced boolean: every query parameter is a string and `Boolean('false')` is
 * `true`.
 *
 * @stability experimental
 */
export const onboardingQuerySchema = z.object({
  /** `true` bypasses the Doctor's report cache for the Doctor-backed steps. */
  refresh: onboardingRefreshSchema
    .transform((value) => value === 'true')
    .optional(),
});

/**
 * One derived step.
 *
 * @stability experimental
 */
export const onboardingStepSchema = z.object({
  /** The permanent step id (`admin.storage`, `user.profile`, `<app>.<step>`). */
  id: z.string(),
  /** Who it is for. */
  audience: onboardingAudienceSchema,
  /** How much it matters. */
  tier: onboardingTierSchema,
  /** Derived now, never stored. */
  status: onboardingStatusSchema,
  /** The step's title. */
  title: z.string(),
  /** One sentence on what the step achieves. */
  description: z.string(),
  /** The label of the step's link. */
  actionLabel: z.string(),
  /** The web route where the step is completed. */
  href: z.string(),
  /** A `todo` step's hint (a Doctor step: the first non-passing check's remedy); otherwise `null`. */
  detail: z.string().nullable(),
  /** Why a `blocked` step cannot be done yet; otherwise `null`. */
  blockedReason: z.string().nullable(),
  /** Whether the user may skip it (never for a `required` step). */
  skippable: z.boolean(),
  /** The user skipped it (it is still listed, with its derived status). */
  skipped: z.boolean(),
});

/**
 * One derived step.
 *
 * @stability experimental
 */
export type OnboardingStep = z.infer<typeof onboardingStepSchema>;

/**
 * One audience's checklist.
 *
 * @stability experimental
 */
export const onboardingBlockSchema = z.object({
  /** The steps the caller can act on, in order. */
  steps: z.array(onboardingStepSchema),
  /** How many are `done`. */
  completed: z.number().int(),
  /** How many there are. */
  total: z.number().int(),
  /** Every `required` step is `done` (true when there is none). */
  requiredDone: z.boolean(),
  /** Every step is `done` or skipped: the checklist has nothing left to ask. */
  allResolved: z.boolean(),
});

/**
 * One audience's checklist.
 *
 * @stability experimental
 */
export type OnboardingBlock = z.infer<typeof onboardingBlockSchema>;

/**
 * The stored UI state as the response reports it: each platform field `null`
 * when unset, `skipped` without ids that are no longer registered and
 * skippable, plus any field an app added with `extendOnboardingSettings`.
 *
 * @stability experimental
 */
export const onboardingStateSchema = z
  .object({
    /** When the welcome was closed, or `null`. */
    welcomeSeenAt: z.string().nullable(),
    /** When the Get started checklist was hidden, or `null`. */
    checklistDismissedAt: z.string().nullable(),
    /** When the Setup guide prompt was hidden, or `null`. */
    adminDismissedAt: z.string().nullable(),
    /** The skipped ids that are still registered, skippable steps. */
    skipped: z.array(z.string()),
  })
  .passthrough();

/**
 * The stored UI state as the response reports it.
 *
 * @stability experimental
 */
export type OnboardingState = z.infer<typeof onboardingStateSchema>;

/**
 * The response of `GET /api/onboarding`.
 *
 * @stability experimental
 */
export const onboardingResponseSchema = z.object({
  /** The stored UI state. */
  settings: onboardingStateSchema,
  /** The caller's own checklist (always present, possibly empty). */
  user: onboardingBlockSchema,
  /** The Setup guide; non-null only for a caller holding the admin permission. */
  admin: onboardingBlockSchema.nullable(),
});

/**
 * The response of `GET /api/onboarding`.
 *
 * @stability experimental
 */
export type OnboardingResponse = z.infer<typeof onboardingResponseSchema>;

// =============================================================================
// GET /api/admin/onboarding/metrics
// =============================================================================

/**
 * The query of the metrics route: the cohort is the users created in the last
 * `days` days (1 to 365, default 30).
 *
 * @stability experimental
 */
export const onboardingMetricsQuerySchema = z.object({
  /** The cohort window, in days. */
  days: z.coerce.number().int().min(1).max(ONBOARDING_METRICS_DAYS_MAX).default(ONBOARDING_METRICS_DAYS_DEFAULT),
});

/**
 * One registered activation milestone, aggregated over the cohort.
 *
 * @stability experimental
 */
export const onboardingMilestoneMetricSchema = z.object({
  /** The milestone's id. */
  id: z.string(),
  /** Its label. */
  label: z.string(),
  /** A user counts as activated when they reach it within this many days of sign-up. */
  windowDays: z.number().int(),
  /** Cohort users created at least `windowDays` ago (their window has closed). */
  eligible: z.number().int(),
  /** Eligible users who reached it within `windowDays`. */
  activated: z.number().int(),
  /** `activated / eligible`; `null` when nobody is eligible. */
  activationRate: z.number().nullable(),
  /** Median hours from sign-up to reaching it, over cohort users who did; one decimal; `null` when none. */
  medianHours: z.number().nullable(),
});

/**
 * One milestone's aggregate.
 *
 * @stability experimental
 */
export type OnboardingMilestoneMetric = z.infer<typeof onboardingMilestoneMetricSchema>;

/**
 * One funnel row: how many cohort users have a step done now.
 *
 * @stability experimental
 */
export const onboardingFunnelStepSchema = z.object({
  /** The step's id. */
  id: z.string(),
  /** The step's title. */
  title: z.string(),
  /** Cohort users with the step done now. */
  completed: z.number().int(),
  /** `completed / cohortSize`; `null` for an empty cohort. */
  rate: z.number().nullable(),
});

/**
 * One funnel row.
 *
 * @stability experimental
 */
export type OnboardingFunnelStep = z.infer<typeof onboardingFunnelStepSchema>;

/**
 * The response of `GET /api/admin/onboarding/metrics`: aggregates only, never
 * a row about one user.
 *
 * @stability experimental
 */
export const onboardingMetricsResponseSchema = z.object({
  /** Echo of `days`. */
  windowDays: z.number().int(),
  /** Users created in the last `windowDays` days. */
  cohortSize: z.number().int(),
  /** One entry per registered milestone; empty when the app registered none. */
  milestones: z.array(onboardingMilestoneMetricSchema),
  /** One row per user step that declares a funnel query. */
  steps: z.array(onboardingFunnelStepSchema),
});

/**
 * The response of `GET /api/admin/onboarding/metrics`.
 *
 * @stability experimental
 */
export type OnboardingMetricsResponse = z.infer<typeof onboardingMetricsResponseSchema>;
