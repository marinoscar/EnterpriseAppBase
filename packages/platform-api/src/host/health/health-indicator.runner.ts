import { Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { HealthCheckError, type HealthIndicatorResult as TerminusResult } from '@nestjs/terminus';

import { BoundedTimeoutError, boundFacts, withTimeout } from '../internal/bounded';
import './builtin-health-indicators';
import {
  HEALTH_INDICATOR_DEFAULT_TIMEOUT_MS,
  healthIndicatorRegistry,
  type HealthIndicatorContext,
  type HealthIndicatorDef,
  type HealthIndicatorOutcome,
} from './health-indicator.registry';

/** Which indicators a probe runs. */
export type HealthProbeScope = 'ready' | 'full';

/**
 * Runs the registered health indicators for the probes and shapes each result
 * for Terminus (`info` when up, `error` when down).
 *
 * Every result is bounded before it leaves: the probes are public, so details
 * are capped and credential-looking keys dropped, and a throw or a timeout is
 * reported with a fixed message (the error's text goes to the log only).
 *
 * Exported for the reference app's wiring and tests; not a stable extension
 * point (register indicators with `registerHealthIndicator`).
 *
 * @internal
 */
@Injectable()
export class HealthIndicatorRunner {
  private readonly logger = new Logger(HealthIndicatorRunner.name);
  private readonly context: HealthIndicatorContext;

  constructor(moduleRef: ModuleRef) {
    this.context = { get: <T>(token: unknown): T => moduleRef.get<T>(token as never, { strict: false }) };
  }

  /**
   * The Terminus indicator functions for one probe.
   *
   * @param scope - `ready` runs the critical indicators, `full` runs all of them.
   * @returns one function per indicator, in registration order.
   */
  functions(scope: HealthProbeScope): Array<() => Promise<TerminusResult>> {
    return healthIndicatorRegistry
      .list()
      .filter((indicator) => scope === 'full' || indicator.critical)
      .map((indicator) => () => this.run(indicator));
  }

  /**
   * Runs one indicator.
   *
   * @param indicator - the definition.
   * @returns the Terminus result when up.
   * @throws HealthCheckError when down (Terminus reports it under `error` and answers 503).
   */
  async run(indicator: HealthIndicatorDef): Promise<TerminusResult> {
    const timeoutMs = indicator.timeoutMs ?? HEALTH_INDICATOR_DEFAULT_TIMEOUT_MS;
    let outcome: HealthIndicatorOutcome;
    try {
      outcome = this.normalise(indicator.id, await withTimeout(indicator.check(this.context), timeoutMs));
    } catch (error) {
      this.logger.warn(`Health indicator "${indicator.id}" failed: ${error instanceof Error ? error.message : String(error)}`);
      outcome = {
        status: 'down',
        details: { message: error instanceof BoundedTimeoutError ? `timed out after ${timeoutMs}ms` : 'check failed' },
      };
    }

    const entry = { status: outcome.status, ...boundFacts(outcome.details, ['status']) };
    const result: TerminusResult = { [indicator.id]: entry } as TerminusResult;
    if (outcome.status === 'down') {
      throw new HealthCheckError(`Health indicator "${indicator.id}" is down`, result);
    }
    return result;
  }

  private normalise(id: string, raw: unknown): HealthIndicatorOutcome {
    const status = (raw as { status?: unknown } | null)?.status;
    if (status !== 'up' && status !== 'down') {
      this.logger.warn(`Health indicator "${id}" returned neither { status: 'up' } nor { status: 'down' }; reporting it down`);
      return { status: 'down', details: { message: 'check returned an invalid result' } };
    }
    return { status, details: (raw as HealthIndicatorOutcome).details };
  }
}
