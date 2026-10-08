// =============================================================================
// The onboarding slice's host ports (issue #745, PP-9.3)
// =============================================================================
//
// The slice reads app data only through these, bound by the app
// (`OnboardingModule.forRoot({ imports: [OnboardingHostModule] })`). Every
// method is a READ: the endpoint never writes, and in particular never
// creates the `user_settings` row `UserSettingsService.getSettings` would.
// =============================================================================

/**
 * The data the built-in facts and the metrics read. Bound by the app.
 *
 * @stability experimental
 */
export interface OnboardingDataPort {
  /** The caller's raw `user_settings.value`, or `null` when there is no row. Selects; never creates the row. */
  readUserSettingsValue(userId: string): Promise<unknown>;
  /** How many allowlist entries exist other than `exceptEmail` (compared case-insensitively; `null`: all of them). */
  countAllowlistEntriesExcept(exceptEmail: string | null): Promise<number>;
  /** Whether the user has at least one active Web Push subscription. Optional: absent reads as `false`. */
  hasPushSubscription?(userId: string): Promise<boolean>;
  /** In the organization: active members other than `userId`, and pending invites. Optional: absent omits `admin.org-invite`. */
  orgInviteProgress?(orgId: string, userId: string): Promise<{ otherMembers: number; pendingInvites: number }>;
  /** Runs ONE read-only aggregate statement with positional parameters (`$1`, ...). The metrics' only query. */
  queryAggregate<T>(sql: string, values: readonly unknown[]): Promise<T[]>;
}

/**
 * Binds {@link OnboardingDataPort}.
 *
 * @extensionPoint token
 * @stability experimental
 */
export const ONBOARDING_DATA: unique symbol = Symbol('ONBOARDING_DATA');

/**
 * Whether a deployment feature is on: the same switches that hide settings
 * cards (`ai`, `telemetry`, ...). Bound by the app.
 *
 * @stability experimental
 */
export interface OnboardingFeatureGate {
  /** Whether `feature` is on. A feature the app does not know is off. */
  isEnabled(feature: string): Promise<boolean>;
}

/**
 * Binds {@link OnboardingFeatureGate}. Optional: unbound, every feature-gated
 * step is omitted.
 *
 * @extensionPoint token
 * @stability experimental
 */
export const ONBOARDING_FEATURES: unique symbol = Symbol('ONBOARDING_FEATURES');
