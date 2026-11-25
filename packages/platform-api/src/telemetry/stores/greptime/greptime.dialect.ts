// =============================================================================
// The GreptimeDB SQL dialect (PP-14.11)
// =============================================================================
//
// The only place the server-authored dashboard SQL names a GreptimeDB (Apache
// DataFusion) spelling. Every constructor below renders EXACTLY the text the
// dashboard templates carried before the dialect was extracted
// (`telemetry-dashboard.sql.spec.ts` and its snapshot pin the result).
//
// Verified on GreptimeDB v1.2.1 (2026-09-27): `date_bin(INTERVAL 'n seconds',
// ts)`, `approx_percentile_cont(0.95) WITHIN GROUP (ORDER BY x)` (ignores
// NULLs), `regexp_replace(x, pattern, replacement, 'g')`,
// `json_get_string(json_column, '["key"]')` (a bare `'key'` path is NULL: `.`
// is a path separator), `ILIKE ... ESCAPE '\'` (a `\` is not an escape in a
// string literal, only `''` is), `CAST(x AS STRING)`.
// =============================================================================

import { bucketInterval } from '../../dashboard/sql-literals';
import { quoteSqlLiteral, type TelemetrySqlDialect } from '../telemetry-store';

/**
 * The dialect of the built-in `greptime` store.
 *
 * @stability experimental
 */
export const GREPTIME_SQL_DIALECT: TelemetrySqlDialect = Object.freeze({
  id: 'greptime',
  timestampColumn: 'greptime_timestamp',
  valueColumn: 'greptime_value',

  timeBucket(column: string, intervalSeconds: number): string {
    return `date_bin(${bucketInterval(intervalSeconds)}, ${column})`;
  },

  percentile(fraction: number, valueExpr: string): string {
    return `approx_percentile_cont(${fraction}) WITHIN GROUP (ORDER BY ${valueExpr})`;
  },

  regexpReplaceAll(expr: string, pattern: string, replacement: string): string {
    return `regexp_replace(${expr}, ${quoteSqlLiteral(pattern)}, ${quoteSqlLiteral(replacement)}, 'g')`;
  },

  jsonString(column: string, key: string): string {
    return `json_get_string(${column}, ${quoteSqlLiteral(`["${key}"]`)})`;
  },

  containsIgnoreCase(expr: string, escapedPattern: string): string {
    return `${expr} ILIKE '%${escapedPattern}%' ESCAPE '\\'`;
  },

  castText(expr: string): string {
    return `CAST(${expr} AS STRING)`;
  },

  limit(rows: number): string {
    return `LIMIT ${rows}`;
  },
});
