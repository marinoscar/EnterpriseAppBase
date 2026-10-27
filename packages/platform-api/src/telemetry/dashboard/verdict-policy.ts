// =============================================================================
// VERDICT_POLICY: the dashboard's health verdict as a seam (issue #703,
// Extension Contract rung 3)
// =============================================================================
//
// `TelemetryDashboardService` asks the policy bound to `VERDICT_POLICY` for
// the summary's verdict, with the resolved thresholds. The default is
// `DefaultVerdictPolicy`, which is exactly `computeVerdict`. An app that adds
// a metric group with a rule of its own binds its own policy and DELEGATES to
// the default for every platform rule:
//
//   @Injectable()
//   export class AppVerdictPolicy implements VerdictPolicy {
//     constructor(private readonly platform: DefaultVerdictPolicy) {}
//     compute(input: VerdictInput, thresholds: VerdictThresholds): DashboardVerdict {
//       const verdict = this.platform.compute(input, thresholds);
//       // ...add the app's own rule, never weaken a platform one
//       return verdict;
//     }
//   }
//
//   TelemetryModule.forRoot({ ..., dashboard: { verdictPolicy: { useClass: AppVerdictPolicy } } })
//
// and a test swaps it with `.overrideProvider(VERDICT_POLICY).useValue(...)`.
// =============================================================================

import { Injectable } from '@nestjs/common';

import { computeVerdict, type DashboardVerdict, type VerdictInput, type VerdictThresholds } from './telemetry-dashboard.verdict';

/**
 * Computes the dashboard summary's health verdict.
 *
 * @stability experimental
 */
export interface VerdictPolicy {
  /**
   * The verdict for one summary.
   *
   * @param input - the numbers the summary computed.
   * @param thresholds - the resolved thresholds (`TELEMETRY_VERDICT_THRESHOLDS`).
   * @returns the level and one reason per fired rule.
   */
  compute(input: VerdictInput, thresholds: VerdictThresholds): DashboardVerdict;
}

/**
 * Injection token of the {@link VerdictPolicy} the dashboard uses. Bound by
 * `TelemetryModule.forRoot()` to {@link DefaultVerdictPolicy}, or to the
 * app's `dashboard.verdictPolicy`.
 *
 * @example
 * ```ts
 * const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
 *   .overrideProvider(VERDICT_POLICY)
 *   .useValue({ compute: () => ({ level: 'critical', reasons: ['test'] }) })
 *   .compile();
 * ```
 *
 * @extensionPoint token
 * @stability experimental
 */
export const VERDICT_POLICY: unique symbol = Symbol.for('@marinoscar/platform/telemetry/VERDICT_POLICY');

/**
 * The platform's verdict rules (`computeVerdict`). Always provided by the
 * telemetry module, so an app policy can inject it and delegate.
 *
 * @stability experimental
 */
@Injectable()
export class DefaultVerdictPolicy implements VerdictPolicy {
  /**
   * The platform rules: no data, 5xx rate, p95, error logs, unknown routes and
   * the infrastructure rules.
   *
   * @param input - the numbers the summary computed.
   * @param thresholds - the resolved thresholds.
   * @returns the level and one reason per fired rule.
   */
  compute(input: VerdictInput, thresholds: VerdictThresholds): DashboardVerdict {
    return computeVerdict(input, thresholds);
  }
}
