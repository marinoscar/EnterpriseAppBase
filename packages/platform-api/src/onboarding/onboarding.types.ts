// =============================================================================
// The onboarding slice's declarations (issue #745, PP-9.3)
// =============================================================================
//
// A STEP is pure data plus two synchronous functions over FACTS. A FACT is the
// only thing that may read anything (the database, the Doctor, a feature
// switch), and the service resolves each fact AT MOST ONCE per request, and
// only when a step that applies to the caller needs it (kvox's cost rule: "a
// per-step query makes the endpoint's cost a function of the registry's
// length"). `evaluate` is synchronous on purpose: it cannot await a query.
// =============================================================================

import type { DoctorCheckReport } from '@marinoscar/platform-contract/doctor';
import type { OnboardingAudience, OnboardingStatus, OnboardingTier } from '@marinoscar/platform-contract/onboarding';

import type { OnboardingDataPort } from './ports';

/**
 * What a step's `evaluate` returns.
 *
 * @stability experimental
 */
export interface OnboardingEvaluation {
  /** `done`, `todo` or `blocked`. */
  status: OnboardingStatus;
  /** A `todo` step's hint (shown under its title); `null` or absent for none. */
  detail?: string | null;
  /** Why a `blocked` step cannot be done yet. REQUIRED when `status` is `blocked`. */
  blockedReason?: string;
}

/**
 * The resolved facts a step reads, by fact id. A step only ever sees the
 * facts it declared.
 *
 * @stability experimental
 */
export type OnboardingFacts = Readonly<Record<string, unknown>>;

/**
 * One onboarding step. Register it with `registerOnboardingStep`; the id is
 * permanent (it is stored in a user's `skipped` list).
 *
 * @typeParam F - the facts object `applies` and `evaluate` receive.
 *
 * @stability experimental
 */
export interface OnboardingStepDef<F extends OnboardingFacts = OnboardingFacts> {
  /** Permanent, namespaced: `admin.*`, `user.*` or `<app>.*` (`ONBOARDING_STEP_ID_PATTERN`). */
  readonly id: string;
  /** `admin` (the Setup guide) or `user` (Get started). */
  readonly audience: OnboardingAudience;
  /** `required`, `recommended` or `optional`. */
  readonly tier: OnboardingTier;
  /** Stable sort key within the audience; ties sort by id. */
  readonly order: number;
  /** The step's title. */
  readonly title: string;
  /** One sentence on what the step achieves. */
  readonly description: string;
  /** The label of the step's link ("Connect storage"). */
  readonly actionLabel: string;
  /** The web route where the step is completed; must exist. */
  readonly href: string;
  /** The exact API permission the step's page needs; the step is OMITTED (never shown blocked) when the caller lacks it. */
  readonly permission?: string;
  /** A deployment feature (`ai`, `telemetry`, ...); the step is omitted while it is off. */
  readonly feature?: string;
  /** Whether the user may skip it. A `required` step never is (refused at registration). */
  readonly skippable: boolean;
  /** The fact ids the step reads; an id no registered fact has fails at bootstrap. */
  readonly facts: readonly string[];
  /**
   * Doctor check ids. Sugar: adds the `doctor` fact, omits the step when a
   * check is not registered, and (without `evaluate`) maps every `pass` to
   * `done` and anything else to `todo` with the first non-passing check's
   * remedy (falling back to its detail) as `detail`. A `skip` is NOT a pass.
   */
  readonly doctorChecks?: readonly string[];
  /**
   * The step counted in the activation funnel: an SQL boolean expression over
   * the cohort user `c.id` (`EXISTS (SELECT 1 FROM projects p WHERE p.owner_id = c.id)`).
   * Trusted, developer-authored SQL; never built from input. `user` steps only.
   */
  readonly funnelSql?: string;
  /** Whether the step applies to this caller at all (false: omitted). Synchronous, facts only. */
  applies?(facts: F): boolean;
  /** The step's status from its facts. Synchronous, facts only. Required unless `doctorChecks` is set. */
  evaluate?(facts: F): OnboardingEvaluation;
}

/**
 * Who is asking, as a fact resolver sees it.
 *
 * @stability experimental
 */
export interface OnboardingCaller {
  /** The user's id. */
  readonly id: string;
  /** Effective permissions (system grants plus the active organization's). */
  readonly permissions: readonly string[];
  /** System role names plus the active org role name. */
  readonly roles: readonly string[];
  /** The active organization, when the credential carries one. */
  readonly activeOrgId: string | null;
}

/**
 * The Doctor, as the built-in `doctor` fact reaches it.
 *
 * @stability experimental
 */
export interface OnboardingDoctorAccess {
  /** Whether a check with this id is registered. */
  has(checkId: string): boolean;
  /** The reports of `checkIds` (one Doctor run per category they span, honouring `refresh`). */
  reports(checkIds: readonly string[], refresh: boolean): Promise<ReadonlyMap<string, DoctorCheckReport>>;
}

/**
 * What a fact's `resolve` receives: built once per request.
 *
 * @stability experimental
 */
export interface OnboardingRequestContext {
  /** Who is asking. */
  readonly caller: OnboardingCaller;
  /** `refresh=true` was sent: bypass caches (the Doctor's). */
  readonly refresh: boolean;
  /** The app's data port (`ONBOARDING_DATA`). */
  readonly data: OnboardingDataPort;
  /** The Doctor, or `null` when the app has none. */
  readonly doctor: OnboardingDoctorAccess | null;
  /** Every Doctor check id the applicable steps reference (the `doctor` fact's input). */
  readonly doctorCheckIds: readonly string[];
  /** `INITIAL_ADMIN_EMAIL` (trimmed), or `null` when unset. */
  readonly initialAdminEmail: string | null;
  /** Whether a deployment feature is on (`ONBOARDING_FEATURES`; memoised per request). */
  isFeatureEnabled(feature: string): Promise<boolean>;
  /** Another fact's value (memoised: resolving it twice runs it once). */
  fact<T = unknown>(id: string): Promise<T>;
  /** An app provider by token, for an app fact (`ModuleRef.get(token, { strict: false })`). */
  get<T = unknown>(token: unknown): T;
}

/**
 * One fact: a value read once per request, shared by every step that needs it.
 *
 * @typeParam T - the value.
 *
 * @stability experimental
 */
export interface OnboardingFactDef<T = unknown> {
  /** The fact's id (`doctor`, `aiEnabled`, `<app>.<fact>`). */
  readonly id: string;
  /** Reads the value. A rejection omits every step that needs the fact (logged), never fails the response. */
  resolve(ctx: OnboardingRequestContext): Promise<T>;
}

/**
 * A derived step, as the ordering hook sees it.
 *
 * @stability experimental
 */
export interface OnboardingOrderableStep {
  /** The step's definition. */
  readonly def: OnboardingStepDef;
  /** Its derived evaluation. */
  readonly evaluation: OnboardingEvaluation;
}

/**
 * One audience's ordering hook (EvoPath orders the user steps by the goal the
 * user chose). At most one per audience. Default: the `order` field.
 *
 * @stability experimental
 */
export interface OnboardingOrderingDef {
  /** The audience it orders. */
  readonly audience: OnboardingAudience;
  /** The facts it reads. */
  readonly facts: readonly string[];
  /** The steps in the order to show; a step left out is dropped. Synchronous, facts only. */
  order(steps: readonly OnboardingOrderableStep[], facts: OnboardingFacts): readonly OnboardingOrderableStep[];
}

/**
 * One activation milestone: the event onboarding exists to cause (an app's
 * first created project, say). Optional; without one the metrics report the
 * cohort and the step funnel only.
 *
 * @stability experimental
 */
export interface ActivationMilestoneDef {
  /** Lower-case id, unique (`first_project`). */
  readonly id: string;
  /** Shown in the Activation section. */
  readonly label: string;
  /** Activated = reached within this many days of sign-up (1 to 365). */
  readonly windowDays: number;
  /**
   * An SQL expression yielding the `timestamptz` at which the cohort user
   * `c.id` first reached the milestone, or `NULL`
   * (`(SELECT MIN(p.created_at) FROM projects p WHERE p.owner_id = c.id)`).
   * Trusted, developer-authored SQL; never built from input.
   */
  readonly firstReachedAtSql: string;
}
