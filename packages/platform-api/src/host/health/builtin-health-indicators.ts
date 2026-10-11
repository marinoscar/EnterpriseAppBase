// =============================================================================
// The platform's own health indicator (PP-14.13)
// =============================================================================
//
// `database`, registered through `registerHealthIndicator` exactly as an app
// registers its own. Critical: readiness is "the database answers". It reaches
// the Terminus indicator through the application's container, so a test that
// overrides `DatabaseHealthIndicator` still takes effect.
// =============================================================================

import { HealthCheckError, type HealthIndicatorResult as TerminusResult } from '@nestjs/terminus';

import { DatabaseHealthIndicator } from './database.indicator';
import {
  registerHealthIndicator,
  type HealthIndicatorDef,
  type HealthIndicatorOutcome,
} from './health-indicator.registry';

/** The key the built-in indicator reports under. */
export const DATABASE_HEALTH_INDICATOR_ID = 'database';

function outcomeOf(key: string, result: TerminusResult | undefined): HealthIndicatorOutcome {
  const entry = (result?.[key] ?? {}) as Record<string, unknown>;
  const { status, ...details } = entry;
  return {
    status: status === 'up' ? 'up' : 'down',
    details: details as HealthIndicatorOutcome['details'],
  };
}

/**
 * The `database` indicator: a timed `SELECT 1` through `DatabaseHealthIndicator`.
 *
 * @stability experimental
 */
export const DATABASE_HEALTH_INDICATOR: HealthIndicatorDef = {
  id: DATABASE_HEALTH_INDICATOR_ID,
  critical: true,
  async check(context) {
    const indicator = context.get<DatabaseHealthIndicator>(DatabaseHealthIndicator);
    try {
      return outcomeOf(DATABASE_HEALTH_INDICATOR_ID, await indicator.isHealthy(DATABASE_HEALTH_INDICATOR_ID));
    } catch (error) {
      if (error instanceof HealthCheckError) {
        return outcomeOf(DATABASE_HEALTH_INDICATOR_ID, error.causes as TerminusResult);
      }
      throw error;
    }
  },
};

registerHealthIndicator(DATABASE_HEALTH_INDICATOR);
