import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { PLATFORM_PRISMA } from '../core/index';
import { DEFAULT_NODES_POLICY } from '../jobs/index';
import { NodeLifecycleService } from '../nodes/index';
import {
  TELEMETRY_ERROR_REASONS,
  TELEMETRY_SQL_DIALECT,
  TelemetryDashboardService,
  TelemetryHttpError,
  TelemetryQueryService,
  TelemetrySchemaService,
  createQueryFacade,
  type TelemetryFacadeResult,
  type TelemetryQueryFacade,
  type TelemetrySqlDialect,
} from '../telemetry/index';
import { AlertStoreUnavailableError } from './alerts.errors';
import type { AlertEvaluationContext, AlertMetricTable, AlertTelemetryAccess, AlertVerdict } from './alerts.types';
import type { AlertsPrisma } from './data/alerts-db';

/** Statements one rule evaluation may run. */
const STATEMENTS_PER_EVALUATION = 5;

const UNAVAILABLE_REASONS: ReadonlySet<string> = new Set([
  TELEMETRY_ERROR_REASONS.NOT_CONFIGURED,
  TELEMETRY_ERROR_REASONS.DISABLED,
  TELEMETRY_ERROR_REASONS.UNREACHABLE,
  TELEMETRY_ERROR_REASONS.QUERY_TIMEOUT,
]);

/**
 * Maps a telemetry failure to the evaluator's vocabulary: a store that cannot
 * be reached is `AlertStoreUnavailableError` (the rule's incidents are left
 * alone); anything else (a refused or failed statement) is the rule's own bug
 * and surfaces as itself.
 *
 * @param error - what the telemetry slice threw.
 * @returns the error to throw.
 *
 * @stability experimental
 */
export function toAlertStoreError(error: unknown): unknown {
  if (error instanceof AlertStoreUnavailableError) return error;
  if (error instanceof TelemetryHttpError && UNAVAILABLE_REASONS.has(error.reason)) {
    return new AlertStoreUnavailableError(describe(error), error);
  }
  return error;
}

function describe(error: unknown): string {
  if (error instanceof TelemetryHttpError) {
    const body = error.getResponse() as { message?: string };
    return body?.message ?? error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * Derives the metric tables of a store schema: tables with the dialect's time
 * and value columns, and their tag columns.
 *
 * @param schema - the store's schema.
 * @param dialect - the store's SQL spelling.
 * @returns the tables by name.
 *
 * @stability experimental
 */
export function metricTablesOfSchema(
  schema: { tables: ReadonlyArray<{ name: string; columns: ReadonlyArray<{ name: string; semanticType: string | null }> }> },
  dialect: Pick<TelemetrySqlDialect, 'timestampColumn' | 'valueColumn'>,
): Map<string, AlertMetricTable> {
  const tables = new Map<string, AlertMetricTable>();
  for (const table of schema.tables) {
    const names = new Set(table.columns.map((c) => c.name));
    if (!names.has(dialect.timestampColumn) || !names.has(dialect.valueColumn)) continue;
    const reported = table.columns.some((c) => c.semanticType);
    const tags = table.columns
      .filter((c) =>
        reported ? String(c.semanticType).toUpperCase() === 'TAG' : c.name !== dialect.timestampColumn && c.name !== dialect.valueColumn,
      )
      .map((c) => c.name)
      .sort();
    tables.set(table.name, { name: table.name, columns: names, tags });
  }
  return tables;
}

/**
 * Builds the {@link AlertEvaluationContext} of one rule evaluation from the
 * app's services. The telemetry, nodes and dashboard services are optional: a
 * kind that needs one that is not installed gets `AlertStoreUnavailableError`.
 *
 * @stability experimental
 */
@Injectable()
export class AlertContextService {
  private readonly logger = new Logger(AlertContextService.name);

  constructor(
    @Inject(PLATFORM_PRISMA) private readonly prisma: AlertsPrisma,
    @Optional() private readonly queries?: TelemetryQueryService,
    @Optional() private readonly schema?: TelemetrySchemaService,
    @Optional() @Inject(TELEMETRY_SQL_DIALECT) private readonly dialect?: TelemetrySqlDialect,
    @Optional() private readonly dashboard?: TelemetryDashboardService,
    @Optional() private readonly lifecycle?: NodeLifecycleService,
  ) {}

  /**
   * The context for one evaluation.
   *
   * @param signal - aborted when the rule's time budget is spent.
   * @param now - the instant the evaluation is for.
   * @returns the context; its lazy members memoise per context.
   */
  create(signal: AbortSignal, now: Date = new Date()): AlertEvaluationContext {
    let telemetry: Promise<AlertTelemetryAccess> | null = null;
    let verdict: Promise<AlertVerdict> | null = null;
    let stale: Promise<number> | null = null;

    return {
      now,
      signal,
      db: this.prisma,
      telemetry: () => (telemetry ??= this.openTelemetry(signal)),
      verdict: () => (verdict ??= this.readVerdict()),
      staleHeartbeatSeconds: () => (stale ??= this.readStale()),
    };
  }

  private async openTelemetry(signal: AbortSignal): Promise<AlertTelemetryAccess> {
    if (!this.queries || !this.schema || !this.dialect) {
      throw new AlertStoreUnavailableError('The telemetry slice is not installed in this application.');
    }
    try {
      const schema = await this.schema.getSchema();
      const inner = createQueryFacade(this.queries, null, {
        source: 'alert',
        dialect: this.dialect,
        signal,
        maxStatements: STATEMENTS_PER_EVALUATION,
      });
      const query: TelemetryQueryFacade = Object.freeze({
        sql: inner.sql,
        dialect: inner.dialect,
        query: async (sql: string, options?: { maxRows?: number }): Promise<TelemetryFacadeResult> => {
          try {
            return await inner.query(sql, options);
          } catch (error) {
            throw toAlertStoreError(error);
          }
        },
      });
      return { query, tables: metricTablesOfSchema(schema, this.dialect) };
    } catch (error) {
      throw toAlertStoreError(error);
    }
  }

  private async readVerdict(): Promise<AlertVerdict> {
    if (!this.dashboard) throw new AlertStoreUnavailableError('The telemetry slice is not installed in this application.');
    try {
      const summary = await this.dashboard.summary(null, {});
      return { level: summary.verdict.level, reasons: summary.verdict.reasons };
    } catch (error) {
      throw toAlertStoreError(error);
    }
  }

  private async readStale(): Promise<number> {
    if (!this.lifecycle) {
      this.logger.debug('NodeLifecycleService is not available; using the shipped stale window.');
      return DEFAULT_NODES_POLICY.staleHeartbeatSeconds;
    }
    return (await this.lifecycle.getPolicy()).staleHeartbeatSeconds;
  }
}
