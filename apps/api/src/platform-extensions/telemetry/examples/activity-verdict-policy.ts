import { Injectable } from '@nestjs/common';
import {
  DefaultVerdictPolicy,
  type DashboardVerdict,
  type VerdictInput,
  type VerdictPolicy,
  type VerdictThresholds,
} from '@marinoscar/platform-api/telemetry';

// =============================================================================
// EXAMPLE, NOT WIRED: an app verdict policy (PP-4.6)
// =============================================================================
//
// Rung 3 of the extension ladder: `VERDICT_POLICY` is the seam through which
// the Telemetry Dashboard asks "how is the deployment". The platform's rules are
// `DefaultVerdictPolicy` (always provided); an app policy INJECTS it, delegates
// every platform rule to it and adds its own, so the platform's verdict is the
// floor and an upgrade of a platform rule reaches the app untouched.
//
// This example adds ONE rule: a window in which the API served no request at
// all while telemetry is still arriving is `degraded` (a quiet app behind a
// healthy-looking collector usually means the traffic stopped reaching it).
// It never lowers a level the platform reached: `critical` stays `critical`,
// and `no_data` (no telemetry at all) is left alone.
//
// WHY IT IS NOT WIRED. Binding it
// (`TelemetryModule.forRoot({ dashboard: { verdictPolicy: { useClass: ActivityVerdictPolicy } } })`)
// would turn every idle fork's dashboard `degraded`: the base's verdict would
// change for everyone. It is compiled with the app and exercised by
// `test/telemetry/telemetry-extension-points.integration.spec.ts` instead.
//
// To use it in a fork: add the `verdictPolicy` option above in
// `platform/telemetry/telemetry.config.ts`. `DefaultVerdictPolicy` needs no
// `imports`: the telemetry module provides it.
// =============================================================================

/** The reason line the example rule adds. */
export const ACTIVITY_QUIET_REASON = 'App activity: no requests were served in the window';

/**
 * The platform verdict plus one app rule (no requests in the window).
 */
@Injectable()
export class ActivityVerdictPolicy implements VerdictPolicy {
  constructor(private readonly platform: DefaultVerdictPolicy) {}

  compute(input: VerdictInput, thresholds: VerdictThresholds): DashboardVerdict {
    // Every platform rule first: this policy only ever adds to it.
    const verdict = this.platform.compute(input, thresholds);

    // `no_data` already says more than this rule could; a busy window has nothing to add.
    if (verdict.level === 'no_data' || input.requests > 0) return verdict;

    return {
      level: verdict.level === 'healthy' ? 'degraded' : verdict.level,
      reasons: [...verdict.reasons, ACTIVITY_QUIET_REASON],
    };
  }
}
