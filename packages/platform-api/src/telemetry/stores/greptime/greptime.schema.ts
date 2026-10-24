// =============================================================================
// GreptimeDB schema discovery: the built-in store's `schema()` (issue #535;
// PP-14.11)
// =============================================================================
//
// Two `information_schema` reads on the reader connection, filtered to the
// configured database (from configuration, quoted): the tables with their row
// estimates and the columns with their types. The platform's
// `TelemetrySchemaService` caches the result; the store itself reads fresh.
// =============================================================================

import type { TelemetrySchema } from '@marinoscar/platform-contract/telemetry';

import { quoteSqlLiteral, type TelemetryQueryOptions, type TelemetryQueryResult } from '../telemetry-store';

/** The part of `GreptimeClient` schema discovery uses. */
export interface GreptimeSchemaHost {
  /** The database telemetry is written to. */
  readonly database: string;
  /** One statement as the read-only user. */
  queryReader(sql: string, options: TelemetryQueryOptions): Promise<TelemetryQueryResult>;
}

/**
 * Reads every table of the telemetry database with its columns.
 *
 * @param host - the client.
 * @param timeoutMs - the ceiling of each of the two reads.
 * @returns the schema, tables sorted by name and columns by position.
 */
export async function readGreptimeSchema(host: GreptimeSchemaHost, timeoutMs: number): Promise<TelemetrySchema> {
  const database = quoteSqlLiteral(host.database);

  const [tables, columns] = await Promise.all([
    host.queryReader(
      `SELECT table_name, table_rows FROM information_schema.tables WHERE table_schema = ${database}`,
      { timeoutMs },
    ),
    host.queryReader(
      'SELECT table_name, column_name, data_type, semantic_type, ordinal_position ' +
        `FROM information_schema.columns WHERE table_schema = ${database}`,
      { timeoutMs },
    ),
  ]);

  return groupSchema(tables.rows, columns.rows);
}

/**
 * Builds the response from `[table_name, table_rows]` and
 * `[table_name, column_name, data_type, semantic_type, ordinal_position]`
 * rows. A column whose table is not in the table list still gets its table
 * (a view, or a table created between the two reads).
 */
export function groupSchema(tableRows: unknown[][], columnRows: unknown[][]): TelemetrySchema {
  const tables = new Map<string, { rows: number | null; columns: { name: string; type: string; semanticType: string | null; position: number }[] }>();

  const ensure = (name: string) => {
    let table = tables.get(name);
    if (!table) {
      table = { rows: null, columns: [] };
      tables.set(name, table);
    }
    return table;
  };

  for (const [name, rows] of tableRows) {
    ensure(String(name)).rows = toCount(rows);
  }

  for (const [table, column, type, semantic, position] of columnRows) {
    ensure(String(table)).columns.push({
      name: String(column),
      type: type === null || type === undefined ? 'unknown' : String(type),
      semanticType: semantic === null || semantic === undefined || semantic === '' ? null : String(semantic),
      position: toCount(position) ?? Number.MAX_SAFE_INTEGER,
    });
  }

  return {
    tables: [...tables.entries()]
      .sort(([a], [b]) => compare(a, b))
      .map(([name, table]) => ({
        name,
        rows: table.rows,
        columns: table.columns
          .sort((a, b) => a.position - b.position || compare(a.name, b.name))
          .map(({ name: column, type, semanticType }) => ({ name: column, type, semanticType })),
      })),
  };
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function toCount(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;

  const n = typeof value === 'number' ? value : Number(value);

  return Number.isFinite(n) ? n : null;
}
