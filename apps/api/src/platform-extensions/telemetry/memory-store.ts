// =============================================================================
// The in-memory telemetry store: a worked example of `registerTelemetryStore`
// (PP-14.11)
// =============================================================================
//
// A telemetry store that keeps its rows in memory and answers the platform's
// SQL with a tiny engine (`./memory-sql.ts`). It exists to prove, in CI and
// without a database, that the telemetry slice works against a store the APP
// registered: select it with `TelemetryModule.forRoot({ store: 'memory' })`,
// load rows with `memoryTelemetryData.load(...)`, and the explorer, the
// dashboard summary, the status page and the Doctor read them.
//
// It is registered by `app-registrations/telemetry.ts` but INERT: nothing uses
// it until `forRoot` selects it, and the reference app does not. A fork that
// wants a real store copies this folder's SHAPE (a definition with settings and
// secrets, a `TelemetryStore`, a dialect), not the engine.
//
//   definition   id 'memory', its own settings (`latencyMs`, `database`)
//   store        `query` is read-only by construction (only SELECT parses),
//                honours `timeoutMs` and the abort signal, reads the shared rows
//   dialect      spells time buckets, percentiles, regex replace, JSON reads,
//                case-insensitive search and text casts its own way (the engine
//                above understands exactly these), proving the platform asks the
//                dialect instead of writing GreptimeDB SQL
// =============================================================================

import {
  TelemetryNotConfiguredError,
  TelemetryQueryAbortedError,
  TelemetryQueryTimeoutError,
  quoteSqlLiteral,
  type TelemetryPingResult,
  type TelemetryQueryResult,
  type TelemetrySchemaSnapshot,
  type TelemetrySqlDialect,
  type TelemetryStore,
  type TelemetryStoreDefinition,
  type TelemetryStoreQueryOptions,
} from '@marinoscar/platform-api/telemetry';
import { z } from 'zod';

import { runMemorySql, type MemoryRow } from './memory-sql';

/** The id the store registers under; select it with `TelemetryModule.forRoot({ store: 'memory' })`. */
export const MEMORY_TELEMETRY_STORE_ID = 'memory';

/**
 * The rows the store serves: tables by name, each with its columns. Shared by
 * every instance the definition builds, so rows survive a settings change.
 * Tests (and a fork's seed script) fill it with {@link MemoryTelemetryData.load}.
 */
export class MemoryTelemetryData {
  private readonly tables = new Map<string, { columns: string[]; rows: MemoryRow[] }>();

  /**
   * Replaces a table. `columns` defaults to the keys of the rows; a row missing
   * a column reads as NULL.
   *
   * @param name - the table name (`opentelemetry_traces`).
   * @param rows - its rows.
   * @param columns - the column list, when the rows do not carry every column.
   */
  load(name: string, rows: readonly MemoryRow[], columns?: readonly string[]): void {
    const names = columns ? [...columns] : [...new Set(rows.flatMap((row) => Object.keys(row)))];
    this.tables.set(name, {
      columns: names,
      rows: rows.map((row) => ({ ...Object.fromEntries(names.map((c) => [c, null])), ...row })),
    });
  }

  /** Removes every table. */
  clear(): void {
    this.tables.clear();
  }

  /** One table, or `undefined`. */
  get(name: string): { columns: string[]; rows: MemoryRow[] } | undefined {
    return this.tables.get(name);
  }

  /** Every table name, sorted. */
  names(): string[] {
    return [...this.tables.keys()].sort();
  }
}

/** The rows the registered `memory` store serves. */
export const memoryTelemetryData = new MemoryTelemetryData();

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
    signal?.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
  });
}

/** The store: rows in memory, SQL through the engine. */
export class MemoryTelemetryStore implements TelemetryStore {
  readonly id = MEMORY_TELEMETRY_STORE_ID;

  constructor(
    readonly database: string,
    private readonly data: MemoryTelemetryData,
    private readonly latencyMs: number,
    private readonly enabled: boolean,
  ) {}

  isConfigured(): boolean {
    return this.enabled;
  }

  configurationProblem(): string | null {
    return this.enabled ? null : 'The in-memory telemetry store is switched off (its "enabled" setting).';
  }

  async query(sql: string, params: readonly unknown[], options: TelemetryStoreQueryOptions): Promise<TelemetryQueryResult> {
    if (!this.enabled) throw new TelemetryNotConfiguredError('reader', this.configurationProblem() ?? undefined);
    if (options.signal?.aborted) throw new TelemetryQueryAbortedError();
    if (params.length > 0) throw new Error('The in-memory store takes no bind parameters.');

    // `latencyMs` stands in for a slow backend: the wait races the ceiling and the signal.
    if (this.latencyMs > 0) {
      if (this.latencyMs > options.timeoutMs) {
        await sleep(options.timeoutMs, options.signal);
        if (options.signal?.aborted) throw new TelemetryQueryAbortedError();
        throw new TelemetryQueryTimeoutError(options.timeoutMs);
      }
      await sleep(this.latencyMs, options.signal);
      if (options.signal?.aborted) throw new TelemetryQueryAbortedError();
    }

    return runMemorySql(sql, this.data);
  }

  async schema(): Promise<TelemetrySchemaSnapshot> {
    return {
      tables: this.data.names().map((name) => {
        const table = this.data.get(name)!;
        return {
          name,
          rows: table.rows.length,
          columns: table.columns.map((column) => ({ name: column, type: 'string', semanticType: null })),
        };
      }),
    };
  }

  async ping(): Promise<TelemetryPingResult> {
    return this.enabled
      ? { reachable: true, version: 'in-memory telemetry store 1.0' }
      : { reachable: false, error: 'The in-memory telemetry store is switched off.' };
  }

  async close(): Promise<void> {
    // Nothing to release: the rows belong to `MemoryTelemetryData`.
  }
}

/** Undoes the LIKE escaping `likeContainsPattern` applied (`\%`, `\_`, `\\`). */
function unescapeLike(pattern: string): string {
  return pattern.replace(/\\([\\%_])/g, '$1');
}

/**
 * The memory store's SQL spelling. Each member renders the function the engine
 * in `./memory-sql.ts` understands, which is deliberately NOT GreptimeDB's.
 */
export const MEMORY_SQL_DIALECT: TelemetrySqlDialect = Object.freeze({
  id: 'memory',
  // The same layout the collector's exporter gives the metric tables.
  timestampColumn: 'greptime_timestamp',
  valueColumn: 'greptime_value',
  timeBucket: (column: string, intervalSeconds: number) => `bucket_start(${intervalSeconds}, ${column})`,
  percentile: (fraction: number, valueExpr: string) => `percentile_of(${fraction}, ${valueExpr})`,
  regexpReplaceAll: (expr: string, pattern: string, replacement: string) =>
    `regex_replace_all(${expr}, ${quoteSqlLiteral(pattern)}, ${quoteSqlLiteral(replacement)})`,
  jsonString: (column: string, key: string) => `json_text(${column}, ${quoteSqlLiteral(key)})`,
  containsIgnoreCase: (expr: string, escapedPattern: string) =>
    `icontains(${expr}, ${quoteSqlLiteral(unescapeLike(escapedPattern.replace(/''/g, "'")))})`,
  castText: (expr: string) => `to_text(${expr})`,
  limit: (rows: number) => `LIMIT ${rows}`,
});

/**
 * The definition `app-registrations/telemetry.ts` registers. Settings are what
 * a generated form at /admin/settings/telemetry edits; there are no secrets.
 */
export const memoryTelemetryStore: TelemetryStoreDefinition = {
  id: MEMORY_TELEMETRY_STORE_ID,
  label: 'In-memory (example)',
  description: 'Rows held in this process, queried with a tiny SQL engine. A worked example, not for production.',
  settingsSchema: z.object({
    enabled: z.boolean().default(true).describe('Whether the store answers queries.'),
    database: z.string().min(1).max(63).default('memory').describe('The name shown as the telemetry database.'),
    latencyMs: z.number().int().min(0).max(60_000).default(0).describe('An artificial delay per query, in milliseconds (to try the timeout).'),
  }),
  defaults: { enabled: true, database: 'memory', latencyMs: 0 },
  build: ({ settings }) => ({
    store: new MemoryTelemetryStore(
      String(settings.database),
      memoryTelemetryData,
      Number(settings.latencyMs),
      settings.enabled === true,
    ),
    dialect: MEMORY_SQL_DIALECT,
  }),
};
