// =============================================================================
// The health indicator registry (PP-14.13)
// =============================================================================
//
// Rung 2 of the extension contract. `GET /api/health` and `/api/health/ready`
// run the indicators registered here. The platform's own `database` indicator
// registers through the SAME function an app uses (`./builtin-health-indicators.ts`),
// so there is no private fast path.
//
// An app (or a package it installs) registers AT IMPORT TIME, before the
// application bootstraps; the registry freezes once it has
// (`RegistryFreezeService`). Registering from `apps/api/src/app-registrations/`
// is the convention.
//
//   * `/api/health/ready` runs the CRITICAL indicators: all up is `200`, any
//     down is `503`. A load balancer drains the instance on that answer.
//   * `/api/health` runs EVERY indicator: any down is `503` as well, and the
//     body lists them all under Terminus' `info` (up) and `error` (down) maps.
//   * `/api/health/live` runs none: it answers for the process only.
//
// ⚠ BOTH PROBES ARE PUBLIC. What an indicator reports in `details` is readable
// by anyone who can reach the API, so the runner bounds it
// (`../internal/bounded.ts`: 16 keys, primitive values, 200-character strings,
// credential-looking keys dropped) and an indicator that throws is reported as
// `down` with a fixed message, never with the error's text. An indicator must
// still not put a secret, a hostname or a stack trace in `details`.
// =============================================================================

import { defineRegistry, type Registry } from '../../core/index';
import type { BoundedFacts } from '../internal/bounded';

/**
 * The id pattern of a health indicator: lower-case, 2 to 32 characters,
 * starting with a letter (`database`, `redis`, `assemblyai`). The id is a JSON
 * key in the public probe response.
 *
 * @stability experimental
 */
export const HEALTH_INDICATOR_ID_PATTERN = /^[a-z][a-z0-9-]{1,31}$/;

/**
 * How long an indicator may take when it declares no `timeoutMs`.
 *
 * @stability experimental
 */
export const HEALTH_INDICATOR_DEFAULT_TIMEOUT_MS = 3000;

/**
 * The longest `timeoutMs` an indicator may declare. A probe that waits longer
 * than this is worse than the failure it is waiting for.
 *
 * @stability experimental
 */
export const HEALTH_INDICATOR_MAX_TIMEOUT_MS = 30_000;

/**
 * What an indicator's `check` returns.
 *
 * @stability experimental
 */
export interface HealthIndicatorOutcome {
  /** `up` or `down`. */
  status: 'up' | 'down';
  /**
   * Facts shown beside the status in the PUBLIC probe response. Bounded by the
   * runner; keep it to a few short, non-sensitive values (a latency, a count, a
   * version). Never a secret, a connection string or a stack trace.
   */
  details?: BoundedFacts;
}

/**
 * What an indicator's `check` receives: a way to reach the application's own
 * providers (a Nest service the check needs) without a module of its own.
 *
 * @stability experimental
 */
export interface HealthIndicatorContext {
  /**
   * Resolves a provider from the running application (any module).
   *
   * @param token - the provider's class or injection token.
   * @returns the instance.
   * @throws Error when nothing provides `token`.
   */
  get<T>(token: unknown): T;
}

/**
 * One health indicator.
 *
 * @stability experimental
 */
export interface HealthIndicatorDef {
  /** The id: a key in the probe response. See {@link HEALTH_INDICATOR_ID_PATTERN}. */
  readonly id: string;
  /**
   * Whether this indicator decides readiness. A critical indicator that is down
   * makes `GET /api/health/ready` answer `503`; a non-critical one is reported
   * by `GET /api/health` only.
   */
  readonly critical: boolean;
  /**
   * Probes the dependency. Resolve `{ status: 'down' }` for a dependency that
   * answered unhealthy; a throw or a timeout is also reported as `down`.
   * Keep it cheap and read-only: probes run often, and during maintenance the
   * readiness probe answers before it ever gets here.
   *
   * @param context - see {@link HealthIndicatorContext}.
   * @returns the outcome.
   */
  check(context: HealthIndicatorContext): Promise<HealthIndicatorOutcome> | HealthIndicatorOutcome;
  /** The cap on one run of `check`, in milliseconds. Default {@link HEALTH_INDICATOR_DEFAULT_TIMEOUT_MS}; at most {@link HEALTH_INDICATOR_MAX_TIMEOUT_MS}. */
  readonly timeoutMs?: number;
}

/**
 * Every registered health indicator, in registration order (the built-in
 * `database` first). Frozen when the application has bootstrapped.
 *
 * @extensionPoint registry
 * @stability experimental
 */
export const healthIndicatorRegistry: Registry<HealthIndicatorDef> = defineRegistry<HealthIndicatorDef>({
  name: 'host.health-indicators',
  idOf: (indicator) => indicator.id,
  idPattern: HEALTH_INDICATOR_ID_PATTERN,
  validate: (indicator) => {
    if (typeof indicator.critical !== 'boolean') {
      throw new Error(`health indicator "${indicator.id}": critical must be a boolean`);
    }
    if (typeof indicator.check !== 'function') {
      throw new Error(`health indicator "${indicator.id}": check must be a function`);
    }
    if (indicator.timeoutMs !== undefined) {
      if (!Number.isInteger(indicator.timeoutMs) || indicator.timeoutMs < 1 || indicator.timeoutMs > HEALTH_INDICATOR_MAX_TIMEOUT_MS) {
        throw new Error(
          `health indicator "${indicator.id}": timeoutMs must be an integer from 1 to ${HEALTH_INDICATOR_MAX_TIMEOUT_MS}`,
        );
      }
    }
  },
});

/**
 * Registers a health indicator. Call it at module load, before the application
 * is created; a duplicate id throws.
 *
 * @param indicator - the indicator.
 * @throws RegistryError `INVALID_ID`, `INVALID_ENTRY`, `DUPLICATE_ID` or `FROZEN`.
 *
 * @example
 * ```ts
 * // apps/api/src/app-registrations/host.ts
 * registerHealthIndicator({
 *   id: 'transcribe',
 *   critical: false,
 *   check: async () => ({ status: (await provider.ping()) ? 'up' : 'down', details: { region: 'eu' } }),
 * });
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function registerHealthIndicator(indicator: HealthIndicatorDef): void {
  healthIndicatorRegistry.register(indicator);
}
