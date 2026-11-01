import type { DynamicModule, ForwardReference, Type } from '@nestjs/common';

import { ALERTS_OPTIONS } from './alerts.constants';

export { ALERTS_OPTIONS };

/**
 * A module the slice needs from the app: the configured telemetry module
 * (`TelemetryQueryService`, `TELEMETRY_SQL_DIALECT`, `TelemetrySchemaService`,
 * `TelemetryDashboardService`), when the app has one.
 *
 * @stability experimental
 */
export type AlertsImport = Type<unknown> | DynamicModule | Promise<DynamicModule> | ForwardReference;

/**
 * `AlertsModule.forRoot` options.
 *
 * @extensionPoint option
 * @stability experimental
 */
export interface AlertsModuleOptions {
  /** Which crons this process runs. Each defaults to on. */
  tasks?: {
    /** The every-minute evaluation (`alerts.evaluate`). */
    evaluate?: boolean;
    /** The daily purge of resolved incidents (`alerts.incidents_purge`). */
    purge?: boolean;
  };
  /** Days a RESOLVED incident is kept (whole days, 1 to 3650). Default 90. */
  incidentRetentionDays?: number;
  /** Milliseconds one rule may take to evaluate before it is abandoned (1 000 to 110 000). Default 20 000. */
  evaluationBudgetMs?: number;
  /** Seed the disabled starter rules at start. Default `true`. */
  seedStarterRules?: boolean;
  /** Modules to import: normally the app's configured telemetry module. */
  imports?: AlertsImport[];
}

/**
 * The options after defaults and validation.
 *
 * @stability experimental
 */
export interface ResolvedAlertsModuleOptions {
  /** Whether the evaluation cron runs here. */
  readonly evaluateTask: boolean;
  /** Whether the purge cron runs here. */
  readonly purgeTask: boolean;
  /** Retention of resolved incidents, in days. */
  readonly incidentRetentionDays: number;
  /** Per-rule evaluation budget, in milliseconds. */
  readonly evaluationBudgetMs: number;
  /** Whether the starter rules are seeded. */
  readonly seedStarterRules: boolean;
  /** The imports. */
  readonly imports: readonly AlertsImport[];
}

/**
 * Applies the defaults and validates.
 *
 * @param options - the app's options.
 * @returns the resolved, frozen options.
 * @throws Error naming the option when one is out of range.
 *
 * @stability experimental
 */
export function resolveAlertsModuleOptions(options: AlertsModuleOptions = {}): ResolvedAlertsModuleOptions {
  const retention = options.incidentRetentionDays ?? 90;
  if (!Number.isInteger(retention) || retention < 1 || retention > 3650) {
    throw new Error(`AlertsModule.forRoot: incidentRetentionDays must be a whole number from 1 to 3650 (got ${retention})`);
  }
  const budget = options.evaluationBudgetMs ?? 20_000;
  if (!Number.isInteger(budget) || budget < 1_000 || budget > 110_000) {
    throw new Error(`AlertsModule.forRoot: evaluationBudgetMs must be a whole number from 1000 to 110000 (got ${budget})`);
  }
  return Object.freeze({
    evaluateTask: options.tasks?.evaluate !== false,
    purgeTask: options.tasks?.purge !== false,
    incidentRetentionDays: retention,
    evaluationBudgetMs: budget,
    seedStarterRules: options.seedStarterRules !== false,
    imports: Object.freeze([...(options.imports ?? [])]),
  });
}
