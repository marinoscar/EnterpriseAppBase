// =============================================================================
// Telemetry explorer (issue #535; moved here from the API's
// `telemetry/dto/telemetry-query.dto.ts` by #702)
// =============================================================================
//
//   POST /api/admin/telemetry/query    telemetryQueryRequestSchema  → telemetryQueryResultSchema
//   GET  /api/admin/telemetry/schema                                → telemetrySchemaSchema
//   POST /api/admin/telemetry/export   telemetryExportRequestSchema → file (binary)
// =============================================================================

import { z } from 'zod';

import {
  TELEMETRY_COLUMN_TYPES,
  TELEMETRY_EXPORT_FORMATS,
  TELEMETRY_QUERY_MAX_ROWS_CEILING,
  TELEMETRY_SQL_MAX_LENGTH,
} from './constants.js';

/**
 * One read-only SQL statement, at most {@link TELEMETRY_SQL_MAX_LENGTH}
 * characters. Whether it is read-only is the API's SQL guard's decision.
 *
 * @extensionPoint schema
 * @stability stable
 */
export const telemetrySqlSchema = z
  .string()
  .min(1)
  .max(TELEMETRY_SQL_MAX_LENGTH)
  .describe(
    'One read-only statement: SELECT, WITH, SHOW, DESCRIBE or EXPLAIN. Comments are allowed; a ' +
      'trailing semicolon is ignored; a second statement is refused. Columns such as ' +
      '`"span_attributes.http.route"` must be double-quoted.',
  );

/**
 * `POST /api/admin/telemetry/query` body: `sql` and an optional `maxRows`
 * (1..{@link TELEMETRY_QUERY_MAX_ROWS_CEILING}, clamped by the setting).
 *
 * @extensionPoint schema
 * @stability stable
 */
export const telemetryQueryRequestSchema = z.object({
  sql: telemetrySqlSchema,
  maxRows: z
    .number()
    .int()
    .min(1)
    .max(TELEMETRY_QUERY_MAX_ROWS_CEILING)
    .optional()
    .describe('Row cap for this query. Clamped to the `telemetry.query.maxRows` setting, which is also the default.'),
});

/**
 * The `POST /api/admin/telemetry/query` body.
 *
 * @stability stable
 */
export type TelemetryQueryRequest = z.infer<typeof telemetryQueryRequestSchema>;

/**
 * One result column: `name` and its simplified wire `type`
 * ({@link TELEMETRY_COLUMN_TYPES}).
 *
 * @extensionPoint schema
 * @stability stable
 */
export const telemetryColumnSchema = z.object({
  /** As the server named it. GreptimeDB suffixes a repeated name (`host`, `host:1`), but do not rely on uniqueness. */
  name: z.string(),
  /**
   * Wire type, simplified. `int8` and `numeric` values are STRINGS (they
   * exceed JavaScript's safe integers — durations in ns, UInt64); `timestamp`,
   * `date` and `time` values are the server's text (microseconds on this wire:
   * `CAST(ts AS STRING)` returns a TIMESTAMP(9)'s nanoseconds as `text`);
   * `json` values are parsed;
   * `bytea` values are base64.
   */
  type: z.enum(TELEMETRY_COLUMN_TYPES),
});

/**
 * One result column.
 *
 * @stability stable
 */
export type TelemetryColumn = z.infer<typeof telemetryColumnSchema>;

/**
 * `POST /api/admin/telemetry/query` response: `columns`, positional `rows`,
 * `rowCount`, `truncated` and `elapsedMs`.
 *
 * @extensionPoint schema
 * @stability stable
 */
export const telemetryQueryResultSchema = z.object({
  columns: z.array(telemetryColumnSchema),
  /** Positional: `rows[i][j]` is the value of `columns[j]`. */
  rows: z.array(z.array(z.unknown())),
  /** `rows.length`. */
  rowCount: z.number().int(),
  /** More rows matched than the cap allowed; `rows` holds the first `rowCount`. */
  truncated: z.boolean(),
  /** Wall-clock time of the round trip to the telemetry store. */
  elapsedMs: z.number().int(),
});

/**
 * The `POST /api/admin/telemetry/query` response.
 *
 * @stability stable
 */
export type TelemetryQueryResult = z.infer<typeof telemetryQueryResultSchema>;

/**
 * One column of a table in `GET /api/admin/telemetry/schema`: `name`, the
 * store's SQL `type` and `semanticType` (`TAG`, `FIELD`, `TIMESTAMP` or `null`).
 *
 * @extensionPoint schema
 * @stability stable
 */
export const telemetrySchemaColumnSchema = z.object({
  name: z.string(),
  /** GreptimeDB's SQL type, e.g. `timestamp(9)`, `string`, `double`, `json`. */
  type: z.string(),
  /** `TAG`, `FIELD` or `TIMESTAMP`, or null when the store does not report it. */
  semanticType: z.string().nullable(),
});

/**
 * One column of a schema table.
 *
 * @stability stable
 */
export type TelemetrySchemaColumn = z.infer<typeof telemetrySchemaColumnSchema>;

/**
 * One table in `GET /api/admin/telemetry/schema`: `name`, `rows` (estimate or
 * `null`) and `columns`.
 *
 * @extensionPoint schema
 * @stability stable
 */
export const telemetrySchemaTableSchema = z.object({
  name: z.string(),
  /** GreptimeDB's row estimate, or null when not reported. */
  rows: z.number().nullable(),
  columns: z.array(telemetrySchemaColumnSchema),
});

/**
 * One table of the telemetry schema.
 *
 * @stability stable
 */
export type TelemetrySchemaTable = z.infer<typeof telemetrySchemaTableSchema>;

/**
 * `GET /api/admin/telemetry/schema` response: `tables`.
 *
 * @extensionPoint schema
 * @stability stable
 */
export const telemetrySchemaSchema = z.object({
  tables: z.array(telemetrySchemaTableSchema),
});

/**
 * The `GET /api/admin/telemetry/schema` response.
 *
 * @stability stable
 */
export type TelemetrySchema = z.infer<typeof telemetrySchemaSchema>;

/**
 * `POST /api/admin/telemetry/export` body: `sql` and `format`
 * ({@link TELEMETRY_EXPORT_FORMATS}).
 *
 * @extensionPoint schema
 * @stability stable
 */
export const telemetryExportRequestSchema = z.object({
  sql: telemetrySqlSchema,
  format: z.enum(TELEMETRY_EXPORT_FORMATS),
});

/**
 * The `POST /api/admin/telemetry/export` body.
 *
 * @stability stable
 */
export type TelemetryExportRequest = z.infer<typeof telemetryExportRequestSchema>;
