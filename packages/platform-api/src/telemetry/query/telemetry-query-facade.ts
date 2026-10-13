import { TELEMETRY_ERROR_REASONS, TelemetryHttpError } from './telemetry-query.errors';
import type { TelemetryQueryService, TelemetryQuerySource } from './telemetry-query.service';
import { ident, literal, timestampLiteral, between } from '../dashboard/sql-literals';
import { TELEMETRY_SQL_MAX_LENGTH } from '../dto/telemetry-query.dto';
import type { TelemetrySqlDialect } from '../stores/telemetry-store';

// =============================================================================
// The guarded query facade (PP-14.18)
// =============================================================================
//
// What an app's code gets when it extends the telemetry slice: a dashboard
// panel's `data` function (`registerDashboardPanel`) and an assistant tool's
// `run` function (`registerTelemetryAssistantTool`). It is the ONLY way such
// code reaches the telemetry store:
//
//   - never a client, a pool, a connection or the store port: the facade is a
//     closure over the query service, frozen, with two members (`query`, `sql`)
//     and the dialect's pure spelling helpers;
//   - every statement goes through `TelemetryQueryService.run`, the same entry
//     point as the explorer: ONE statement, read-only (the SQL guard refuses
//     anything else, a write included), a row cap, the policy's timeout, and an
//     audit row naming the caller and the source (`panel` or `assistant`);
//   - bounded per facade (one panel read, one tool call): at most
//     `FACADE_MAX_STATEMENTS` statements and `FACADE_MAX_ROWS` rows each, so an
//     extension cannot turn a request into a scan loop;
//   - values go into SQL through `sql.literal` / `sql.ident` / `sql.timestamp`,
//     which quote (there are no bind parameters on the store's wire).
//
// The caller's identity is bound when the facade is made, from the request: the
// extension cannot pick another user, another source or another store.
// =============================================================================

/**
 * The most statements one facade runs (one panel read, one assistant tool call).
 *
 * @stability experimental
 */
export const FACADE_MAX_STATEMENTS = 10;

/**
 * The most rows one facade statement returns, whatever `maxRows` asks and the
 * `telemetry.query.maxRows` setting allows.
 *
 * @stability experimental
 */
export const FACADE_MAX_ROWS = 1_000;

/**
 * The rows a facade statement returns when it does not say.
 *
 * @stability experimental
 */
export const FACADE_DEFAULT_ROWS = 100;

/**
 * What a facade statement returns.
 *
 * @stability experimental
 */
export interface TelemetryFacadeResult {
  /** Column names and simplified types, in order. */
  readonly columns: ReadonlyArray<{ readonly name: string; readonly type: string }>;
  /** Rows as positional arrays, JSON-safe (timestamps and big numbers as strings). */
  readonly rows: ReadonlyArray<ReadonlyArray<unknown>>;
  /** How many rows came back. */
  readonly rowCount: number;
  /** More rows matched than the cap allowed. */
  readonly truncated: boolean;
}

/**
 * Builders for the parts of a statement that carry a value. Every one quotes;
 * a value is never concatenated into SQL any other way.
 *
 * @stability experimental
 */
export interface TelemetrySqlBuilders {
  /** `'text'`: a string literal, `'` doubled. */
  literal(value: string): string;
  /** `"name"`: an identifier, `"` doubled. */
  ident(name: string): string;
  /** `'2026-01-01T00:00:00.000Z'`: a timestamp literal from a valid Date. */
  timestamp(date: Date): string;
  /** `"column" >= '<from>' AND "column" < '<to>'`. */
  between(column: string, from: Date, to: Date): string;
}

/**
 * The guarded way to read the telemetry store from an extension.
 *
 * @example
 * ```ts
 * const result = await ctx.query.query(
 *   `SELECT feature, count(*) AS uses FROM app_events WHERE ${ctx.query.sql.between('timestamp', from, to)} GROUP BY feature ORDER BY uses DESC`,
 *   { maxRows: 5 },
 * );
 * ```
 *
 * @extensionPoint hook
 * @stability experimental
 */
export interface TelemetryQueryFacade {
  /**
   * Runs ONE read-only statement: the SQL guard, a row cap, the timeout and an
   * audit row, exactly as the explorer's. Rejects with a `TelemetryHttpError`
   * (`TELEMETRY_QUERY_REJECTED` for a write or several statements,
   * `TELEMETRY_QUERY_FAILED`, `TELEMETRY_QUERY_TIMEOUT`, `TELEMETRY_DISABLED`,
   * `TELEMETRY_NOT_CONFIGURED`, `TELEMETRY_UNREACHABLE`), or with a
   * `TelemetryFacadeLimitError` once the statement budget is spent.
   *
   * @param sql - one SELECT, WITH, SHOW, DESCRIBE or EXPLAIN statement.
   * @param options - `maxRows`: at most {@link FACADE_MAX_ROWS} (default {@link FACADE_DEFAULT_ROWS}).
   */
  query(sql: string, options?: { maxRows?: number }): Promise<TelemetryFacadeResult>;
  /** Quoting builders for values in a statement. */
  readonly sql: TelemetrySqlBuilders;
  /** The store's SQL spelling (time buckets, percentiles, row caps); pure functions. */
  readonly dialect: TelemetrySqlDialect;
}

/**
 * The statement budget of a facade is spent.
 *
 * @stability experimental
 */
export class TelemetryFacadeLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TelemetryFacadeLimitError';
  }
}

const SQL_BUILDERS: TelemetrySqlBuilders = Object.freeze({
  literal,
  ident,
  timestamp: timestampLiteral,
  between,
});

/** How a facade is made. */
export interface QueryFacadeOptions {
  /** The audit source (`panel`, `assistant`). */
  source: TelemetryQuerySource;
  /** The store's SQL spelling. */
  dialect: TelemetrySqlDialect;
  /** Abandons an in-flight statement. */
  signal?: AbortSignal;
  /** Statements allowed (default {@link FACADE_MAX_STATEMENTS}). */
  maxStatements?: number;
  /** Rows per statement, at most (default {@link FACADE_MAX_ROWS}). */
  maxRows?: number;
}

/**
 * Makes the facade for one request: bound to `userId`, a source and a budget.
 *
 * @param service - the query service every statement goes through.
 * @param userId - the user the request is for (the audit row names them).
 * @param options - the source, dialect, budget and abort signal.
 * @returns a frozen facade.
 *
 * @stability experimental
 */
export function createQueryFacade(
  service: TelemetryQueryService,
  userId: string,
  options: QueryFacadeOptions,
): TelemetryQueryFacade {
  const budget = options.maxStatements ?? FACADE_MAX_STATEMENTS;
  const rowCeiling = Math.min(options.maxRows ?? FACADE_MAX_ROWS, FACADE_MAX_ROWS);
  let used = 0;

  return Object.freeze({
    async query(sql: string, queryOptions: { maxRows?: number } = {}): Promise<TelemetryFacadeResult> {
      if (typeof sql !== 'string' || sql.trim() === '') {
        throw new TelemetryHttpError(TELEMETRY_ERROR_REASONS.QUERY_REJECTED, 'A telemetry query needs a SQL statement.');
      }
      if (sql.length > TELEMETRY_SQL_MAX_LENGTH) {
        throw new TelemetryHttpError(
          TELEMETRY_ERROR_REASONS.QUERY_REJECTED,
          `A telemetry query is at most ${TELEMETRY_SQL_MAX_LENGTH} characters.`,
        );
      }
      if (used >= budget) {
        throw new TelemetryFacadeLimitError(`This extension has used its ${budget} telemetry statements; combine them into fewer queries.`);
      }
      // Counted before it runs, so a refused statement (a write attempt, which the
      // query service refuses AND audits) spends budget like any other.
      used += 1;

      const requested = queryOptions.maxRows;
      const maxRows = Math.max(
        1,
        Math.min(Number.isFinite(requested) ? Math.floor(requested as number) : FACADE_DEFAULT_ROWS, rowCeiling),
      );
      const result = await service.run(userId, sql, { source: options.source, maxRows, signal: options.signal });
      return Object.freeze({
        columns: Object.freeze(result.columns.map((column) => Object.freeze({ name: column.name, type: String(column.type) }))),
        rows: result.rows,
        rowCount: result.rowCount,
        truncated: result.truncated,
      });
    },
    sql: SQL_BUILDERS,
    dialect: options.dialect,
  });
}
