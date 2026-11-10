import type { HealthIndicatorDef } from '@marinoscar/platform-api/host';

// =============================================================================
// EXAMPLE: an app health indicator that decides readiness (PP-14.13)
// =============================================================================
//
// `GET /api/health/ready` runs every CRITICAL indicator registered with
// `registerHealthIndicator`; one that reports `down` makes the probe answer 503
// and a load balancer drains this instance. `GET /api/health` runs all of them,
// critical or not. The platform's own `database` indicator registers the same
// way, so this one sits beside it in the response.
//
// THE PROBES ARE PUBLIC. What `details` carries is readable by anyone who can
// reach the API: the runner bounds it (16 keys, primitive values, 200-character
// strings, credential-looking keys dropped) and reports a throw or a timeout
// with a fixed message, but the indicator must still keep secrets, hostnames
// and stack traces out of it. Here: one number.
//
// Opt in with `registerHostExamples()` (`app-registrations/host.ts`).
// =============================================================================

/** The id the indicator registers under (a key in the probe response). */
export const QUEUE_READINESS_INDICATOR_ID = 'example-queue';

/**
 * The example's stand-in for a dependency: flip `up` to flip readiness. A real
 * indicator would ping its dependency (a broker, a provider's status endpoint)
 * inside `check`, cheaply and read-only.
 */
export const exampleQueue = { up: true, depth: 3 };

/** A critical indicator: when `exampleQueue.up` is false, `/api/health/ready` answers 503. */
export const queueReadinessIndicator: HealthIndicatorDef = {
  id: QUEUE_READINESS_INDICATOR_ID,
  critical: true,
  timeoutMs: 1000,
  check: () => ({ status: exampleQueue.up ? 'up' : 'down', details: { depth: exampleQueue.depth } }),
};
