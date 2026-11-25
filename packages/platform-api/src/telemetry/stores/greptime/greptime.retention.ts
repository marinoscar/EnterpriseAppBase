// =============================================================================
// GreptimeDB retention: the `TelemetryRetentionControl` of the built-in store
// (issue #534; PP-14.11)
// =============================================================================
//
// Makes GreptimeDB's database-level TTL match `telemetry.retentionDays`:
//
//     ALTER DATABASE <database> SET 'ttl'='<N>d'
//
// The database name is deliberately UNQUOTED: GreptimeDB v1.2.1 resolves a
// double-quoted name in ALTER DATABASE literally (`"public"` fails with
// "Failed to find schema"), so the name is instead restricted to a plain
// identifier and refused otherwise.
//
// One database TTL covers every telemetry table, including the per-metric and
// per-attribute tables GreptimeDB creates later (spike #529: tables inherit
// it). GreptimeDB enforces the TTL itself during compaction; the platform only
// states the policy.
//
// The ALTER needs the ADMIN login (the reader is refused); the current TTL is
// read with `SHOW CREATE DATABASE` on the admin connection when it is
// configured, else on the reader (GreptimeDB lets a read-only user SHOW).
// =============================================================================

import type { TelemetryTtl } from '@marinoscar/platform-contract/telemetry';

import { quoteSqlIdent, type TelemetryQueryOptions, type TelemetryQueryResult, type TelemetryRetentionControl } from '../telemetry-store';

/** A bare SQL identifier; the only database names the statement accepts. */
const PLAIN_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** The one statement the retention job runs. Exported so its text is pinned by a test. */
export function retentionStatement(database: string, retentionDays: number): string {
  // Defence in depth: the value came through `systemTelemetrySchema`
  // (an integer in 1..3650), and it is interpolated into SQL — GreptimeDB
  // has no bind parameters — so it is checked again right here.
  if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 3650) {
    throw new Error(`Refusing to apply an invalid telemetry retention of ${String(retentionDays)} day(s).`);
  }

  if (!PLAIN_IDENTIFIER.test(database)) {
    throw new Error(`Refusing to apply retention to a non-plain database name: ${JSON.stringify(database)}.`);
  }

  return `ALTER DATABASE ${database} SET 'ttl'='${retentionDays}d'`;
}

/**
 * The TTL out of a `SHOW CREATE DATABASE` statement, e.g.
 * `CREATE DATABASE IF NOT EXISTS public\nWITH(\n  ttl = '7days'\n)` →
 * `{ raw: '7days', days: 7 }`. Null when the statement sets no TTL.
 */
export function parseTtlFromCreateDatabase(statement: string): TelemetryTtl | null {
  const match = /\bttl\s*=\s*'([^']*)'/i.exec(statement);
  if (!match) return null;

  const raw = match[1].trim();
  const seconds = parseHumantimeSeconds(raw);

  return { raw, days: seconds === null ? null : Math.round(seconds / 86_400) };
}

/**
 * GreptimeDB prints durations with Rust's `humantime` (`7days`, `30days`,
 * `1month 13h 26m 24s`, `1year`). Its month is 30.44 days and its year 365.25
 * days, which is why 31 days does not print as `31days`. Returns seconds, or
 * null for `forever`/`instant`/anything unrecognised.
 */
export function parseHumantimeSeconds(value: string): number | null {
  const UNITS: Record<string, number> = {
    ns: 1e-9, nsec: 1e-9, nanos: 1e-9,
    us: 1e-6, usec: 1e-6, micros: 1e-6,
    ms: 1e-3, msec: 1e-3, millis: 1e-3,
    s: 1, sec: 1, secs: 1, second: 1, seconds: 1,
    m: 60, min: 60, mins: 60, minute: 60, minutes: 60,
    h: 3_600, hr: 3_600, hrs: 3_600, hour: 3_600, hours: 3_600,
    d: 86_400, day: 86_400, days: 86_400,
    w: 604_800, week: 604_800, weeks: 604_800,
    M: 2_630_016, month: 2_630_016, months: 2_630_016,
    y: 31_557_600, year: 31_557_600, years: 31_557_600,
  };

  const text = value.trim();
  if (text === '') return null;

  const pattern = /(\d+)\s*([a-zA-Z]+)/g;
  let total = 0;
  let consumed = '';
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const unit = UNITS[match[2]] ?? UNITS[match[2].toLowerCase()];
    if (unit === undefined) return null;

    total += Number(match[1]) * unit;
    consumed += match[0];
  }

  // Everything but whitespace must have been a `<number><unit>` pair.
  if (consumed.replace(/\s+/g, '') !== text.replace(/\s+/g, '')) return null;

  return total;
}

/** The part of `GreptimeClient` the retention control uses. */
export interface GreptimeRetentionHost {
  /** The database telemetry is written to. */
  readonly database: string;
  /** Whether the admin login is configured. */
  isAdminConfigured(): boolean;
  /** One statement as the admin user. */
  queryAdmin(sql: string, options: TelemetryQueryOptions): Promise<TelemetryQueryResult>;
  /** One statement as the read-only user. */
  queryReader(sql: string, options: TelemetryQueryOptions): Promise<TelemetryQueryResult>;
}

/**
 * The retention control of the built-in store, over a client's two logins.
 *
 * @param host - the client.
 * @returns the control.
 * @stability experimental
 */
export function createGreptimeRetention(host: GreptimeRetentionHost): TelemetryRetentionControl {
  return {
    isApplicable: () => host.isAdminConfigured(),

    async apply(retentionDays, { timeoutMs }) {
      await host.queryAdmin(retentionStatement(host.database, retentionDays), { timeoutMs });
    },

    async current({ timeoutMs }) {
      const sql = `SHOW CREATE DATABASE ${quoteSqlIdent(host.database)}`;
      const result = host.isAdminConfigured()
        ? await host.queryAdmin(sql, { timeoutMs })
        : await host.queryReader(sql, { timeoutMs });

      for (const row of result.rows) {
        for (const cell of row) {
          if (typeof cell !== 'string') continue;

          const ttl = parseTtlFromCreateDatabase(cell);
          if (ttl) return ttl;
        }
      }

      return null;
    },
  };
}
