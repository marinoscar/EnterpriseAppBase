import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, types as pgTypes, type PoolClient, type PoolConfig, type QueryArrayResult } from 'pg';

import {
  TelemetryMultiStatementError,
  TelemetryNotConfiguredError,
  TelemetryQueryFailedError,
  TelemetryQueryTimeoutError,
  TelemetryQueryAbortedError,
} from './greptime.errors';

// =============================================================================
// GreptimeClient — the API's only connection to the telemetry store
// (issue #534, epic #528)
// =============================================================================
//
// GreptimeDB speaks the PostgreSQL wire protocol on `GREPTIME_PG_PORT` (4003),
// so this is `pg` — the driver the API already ships — pointed at it. Two
// lazily-created pools, one per credential:
//
//   reader  `GREPTIME_READER_*` — a GreptimeDB `readonly` user. SELECT, SHOW,
//           DESCRIBE, information_schema. Everything user-driven (the status
//           page here; the explorer #535 and the assistant #536) runs on it.
//   admin   `GREPTIME_ADMIN_*` — used for exactly the statements the reader is
//           refused: `ALTER DATABASE … SET 'ttl'` (retention) and
//           `SHOW CREATE DATABASE`. A route never runs caller-supplied SQL on
//           it.
//
// WHAT THE SPIKE (#529) FOUND, AND WHAT THIS FILE DOES ABOUT IT
// -----------------------------------------------------------------------------
//
//   - NO BIND PARAMETERS. `$1` fails with "Placeholder '$1' was not provided a
//     value". So `query*` take a finished SQL string and nothing else; a
//     caller that interpolates a value quotes it itself (`quoteIdent` /
//     `quoteLiteral` below) and validates it first.
//   - NO SERVER-SIDE TIMEOUT. The read-only user cannot `SET
//     statement_timeout` and the startup parameter is ignored, so every call
//     takes a `timeoutMs` and enforces it HERE: the statement runs on a
//     dedicated pooled client, and on timeout that client is DESTROYED
//     (`release(true)`) rather than returned — a socket with a query still in
//     flight must never be handed to the next caller — and a typed
//     `TelemetryQueryTimeoutError` is thrown.
//   - MULTI-STATEMENT STRINGS RUN EVERY STATEMENT. A result that comes back as
//     an array of result sets is refused with `TelemetryMultiStatementError`
//     (after the fact — rejecting the text up front is the explorer's guard).
//   - int8 AND numeric ARRIVE AS STRINGS, and stay strings (UInt64 shows up as
//     numeric; a JS number would lose precision). Timestamp types are kept as
//     the server's text too, because GreptimeDB's nanosecond timestamps do not
//     survive a round trip through `Date`. See `greptimeTypeParser`.
//
// Rows come back in ARRAY mode, positionally matching `fields`: telemetry SQL
// routinely selects two columns with the same name (`a.trace_id`,
// `b.trace_id`), which object rows would silently collapse. `rowsAsObjects`
// is there for the callers (like the status service) that know their column
// names are unique.
//
// ⚠ NEVER LOG A CREDENTIAL. Nothing here logs the pool configuration, and
// every error this file raises is built from fixed text or the server's own
// error message.
// =============================================================================

/** A column of a result, as the wire protocol describes it. */
export interface TelemetryField {
  name: string;
  /** PostgreSQL type OID (1043 varchar, 20 int8, 1700 numeric, 1114/1184 timestamp, …). */
  dataTypeID: number;
}

/** One statement's result. `rows[i][j]` is the value of `fields[j]`. */
export interface TelemetryQueryResult {
  fields: TelemetryField[];
  rows: unknown[][];
}

export interface TelemetryQueryOptions {
  /** Hard client-side ceiling on the statement's wall-clock time. */
  timeoutMs: number;
  /**
   * Abandons the statement (destroying its connection, exactly as a timeout
   * does) when aborted — `TelemetryQueryAbortedError`. Issue #536: a closed
   * assistant stream stops its in-flight query.
   */
  signal?: AbortSignal;
}

export interface TelemetryPingResult {
  reachable: boolean;
  /** `SELECT version()` — e.g. `PostgreSQL 16.3 GreptimeDB 1.2.1`. */
  version?: string;
  error?: string;
}

/** The `greptime` block of `config/configuration.ts`. */
export interface GreptimeConfig {
  host: string;
  pgPort: number;
  database: string;
  readerUser: string;
  readerPassword: string;
  adminUser: string;
  adminPassword: string;
  available: boolean;
}

/** The subset of `pg.Pool` this class uses — what a test substitutes. */
export interface GreptimePool {
  connect(): Promise<PoolClient>;
  end(): Promise<void>;
  on(event: 'error', listener: (error: Error) => void): unknown;
}

type Role = 'reader' | 'admin';

/** Pool sizes. Small on purpose: telemetry reads are admin-only and rare. */
export const GREPTIME_READER_POOL_MAX = 4;
export const GREPTIME_ADMIN_POOL_MAX = 1;

/** How long to wait for a TCP connection + authentication before giving up. */
export const GREPTIME_CONNECT_TIMEOUT_MS = 5_000;

/** Timeout for `ping()`. */
export const GREPTIME_PING_TIMEOUT_MS = 5_000;

/** Type OIDs whose text form is kept verbatim instead of parsed by `pg`. */
const KEEP_AS_TEXT_OIDS = new Set<number>([
  20, // int8 — beyond Number.MAX_SAFE_INTEGER in practice (durations in ns)
  1700, // numeric — how UInt64 columns arrive
  1082, // date
  1083, // time
  1114, // timestamp
  1184, // timestamptz
  1266, // timetz
]);

/**
 * Per-pool type parser: the types above come back as the server's text,
 * everything else as `pg` would parse it (booleans, int2/int4, floats, json).
 */
export function greptimeTypeParser(oid: number, format?: 'text' | 'binary'): (value: string) => unknown {
  if (KEEP_AS_TEXT_OIDS.has(oid)) {
    return (value: string) => value;
  }

  return pgTypes.getTypeParser(oid, format ?? 'text') as (value: string) => unknown;
}

/**
 * Double-quotes an SQL identifier. Only for a value that was already
 * validated (from configuration, or checked against `information_schema`) —
 * quoting makes an identifier unambiguous, it does not make an arbitrary
 * string safe to accept.
 */
export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** Single-quotes an SQL string literal. Same caveat as `quoteIdent`. */
export function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** `rows` as objects keyed by field name. Only when the names are unique. */
export function rowsAsObjects(result: TelemetryQueryResult): Record<string, unknown>[] {
  return result.rows.map((row) =>
    Object.fromEntries(result.fields.map((field, index) => [field.name, row[index]])),
  );
}

@Injectable()
export class GreptimeClient implements OnModuleDestroy {
  private readonly logger = new Logger(GreptimeClient.name);
  private readonly config: GreptimeConfig;
  private readonly pools: Partial<Record<Role, GreptimePool>> = {};

  constructor(configService: ConfigService) {
    const raw = configService.get<Partial<GreptimeConfig>>('greptime') ?? {};

    this.config = {
      host: raw.host ?? '',
      pgPort: raw.pgPort ?? 4003,
      database: raw.database || 'public',
      readerUser: raw.readerUser ?? '',
      readerPassword: raw.readerPassword ?? '',
      adminUser: raw.adminUser ?? '',
      adminPassword: raw.adminPassword ?? '',
      available: raw.available ?? false,
    };
  }

  /** Whether the reader connection is configured — i.e. the telemetry overlay is deployed. */
  isConfigured(): boolean {
    return this.config.available;
  }

  /** Whether the admin connection is configured as well (retention, `SHOW CREATE DATABASE`). */
  isAdminConfigured(): boolean {
    return this.isConfigured() && Boolean(this.config.adminUser && this.config.adminPassword);
  }

  /** The GreptimeDB database telemetry is written to (`GREPTIME_DB`, default `public`). */
  get database(): string {
    return this.config.database;
  }

  /**
   * Runs one statement as the read-only user. The SQL is sent as-is: see the
   * header for why there are no parameters.
   */
  async queryReader(sql: string, options: TelemetryQueryOptions): Promise<TelemetryQueryResult> {
    return this.run('reader', sql, options);
  }

  /**
   * Runs one statement as the admin user. NEVER with caller-supplied SQL: this
   * connection can alter retention and drop data.
   */
  async queryAdmin(sql: string, options: TelemetryQueryOptions): Promise<TelemetryQueryResult> {
    return this.run('admin', sql, options);
  }

  /** Reachability probe over the reader connection. Never throws. */
  async ping(): Promise<TelemetryPingResult> {
    if (!this.isConfigured()) {
      return { reachable: false, error: new TelemetryNotConfiguredError('reader').message };
    }

    try {
      const result = await this.queryReader('SELECT version()', { timeoutMs: GREPTIME_PING_TIMEOUT_MS });
      const version = result.rows[0]?.[0];

      return { reachable: true, ...(typeof version === 'string' ? { version } : {}) };
    } catch (error) {
      return { reachable: false, error: describeError(error) };
    }
  }

  async onModuleDestroy(): Promise<void> {
    const pools = Object.values(this.pools);

    for (const role of Object.keys(this.pools) as Role[]) {
      delete this.pools[role];
    }

    await Promise.all(
      pools.map((pool) =>
        pool.end().catch((error: unknown) => {
          this.logger.warn(`Closing a GreptimeDB pool failed: ${describeError(error)}`);
        }),
      ),
    );
  }

  /** Builds a pool. A seam for tests; production code never overrides it. */
  protected createPool(config: PoolConfig): GreptimePool {
    return new Pool(config);
  }

  // ---------------------------------------------------------------------------

  private async run(
    role: Role,
    sql: string,
    { timeoutMs, signal }: TelemetryQueryOptions,
  ): Promise<TelemetryQueryResult> {
    if (signal?.aborted) throw new TelemetryQueryAbortedError();

    const pool = this.pool(role);
    const client = await this.connect(pool);

    if (signal?.aborted) {
      client.release();
      throw new TelemetryQueryAbortedError();
    }

    let timer: NodeJS.Timeout | undefined;
    let timedOut = false;
    let onAbort: (() => void) | undefined;

    const query = client.query({ text: sql, rowMode: 'array' }) as unknown as Promise<
      QueryArrayResult | QueryArrayResult[]
    >;

    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        reject(new TelemetryQueryTimeoutError(timeoutMs));
      }, timeoutMs);
      timer.unref?.();
    });

    // Abandoned like a timeout: `timedOut` routes it to the destroy branch.
    const aborted = new Promise<never>((_, reject) => {
      if (!signal) return;
      onAbort = () => {
        timedOut = true;
        reject(new TelemetryQueryAbortedError());
      };
      signal.addEventListener('abort', onAbort, { once: true });
    });

    try {
      const result = await Promise.race([query, timeout, aborted]);

      client.release();

      if (Array.isArray(result)) {
        throw new TelemetryMultiStatementError();
      }

      return {
        fields: result.fields.map((field) => ({ name: field.name, dataTypeID: field.dataTypeID })),
        rows: result.rows,
      };
    } catch (error) {
      if (timedOut) {
        // The query is still in flight on this socket: destroy it, and make
        // sure its eventual rejection (the socket closing under it) is not an
        // unhandled one.
        query.catch(() => undefined);
        client.release(true);
        throw error;
      }

      if (error instanceof TelemetryMultiStatementError) {
        throw error;
      }

      // A server-side error (it has a `severity`) leaves the connection
      // usable; anything else (a reset socket) does not.
      const fromServer = isServerError(error);
      client.release(fromServer ? undefined : true);

      throw new TelemetryQueryFailedError(
        describeError(error),
        sqlState(error),
        fromServer ? 'server' : 'connection',
      );
    } finally {
      if (timer) clearTimeout(timer);
      if (onAbort) signal?.removeEventListener('abort', onAbort);
    }
  }

  private async connect(pool: GreptimePool): Promise<PoolClient> {
    try {
      return await pool.connect();
    } catch (error) {
      throw new TelemetryQueryFailedError(
        `Could not connect to GreptimeDB: ${describeError(error)}`,
        sqlState(error),
        'connection',
      );
    }
  }

  private pool(role: Role): GreptimePool {
    const existing = this.pools[role];
    if (existing) return existing;

    if (role === 'reader' ? !this.isConfigured() : !this.isAdminConfigured()) {
      throw new TelemetryNotConfiguredError(role);
    }

    const pool = this.createPool({
      host: this.config.host,
      port: this.config.pgPort,
      database: this.config.database,
      user: role === 'reader' ? this.config.readerUser : this.config.adminUser,
      password: role === 'reader' ? this.config.readerPassword : this.config.adminPassword,
      max: role === 'reader' ? GREPTIME_READER_POOL_MAX : GREPTIME_ADMIN_POOL_MAX,
      application_name: `api-telemetry-${role}`,
      connectionTimeoutMillis: GREPTIME_CONNECT_TIMEOUT_MS,
      idleTimeoutMillis: 30_000,
      allowExitOnIdle: true,
      types: { getTypeParser: greptimeTypeParser } as PoolConfig['types'],
    });

    // An idle client's socket dying emits `error` on the pool; unhandled, that
    // is an uncaught exception that would take the API down with it.
    pool.on('error', (error) => {
      this.logger.warn(`GreptimeDB ${role} connection error: ${describeError(error)}`);
    });

    this.pools[role] = pool;

    return pool;
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isServerError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'severity' in error;
}

function sqlState(error: unknown): string | undefined {
  const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;

  return typeof code === 'string' ? code : undefined;
}
