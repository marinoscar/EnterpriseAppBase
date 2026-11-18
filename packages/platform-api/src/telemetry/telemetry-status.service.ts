import { Inject, Injectable, Logger } from '@nestjs/common';

import type { TelemetryStatus, TelemetryTtl } from './dto/telemetry-status.dto';
import { TELEMETRY_STORE, type TelemetryStore } from './stores/telemetry-store';
import { TelemetrySettingsService } from './telemetry-settings.service';

// =============================================================================
// TelemetryStatusService — GET /api/admin/telemetry/status (issue #534)
// =============================================================================
//
// What the telemetry store looks like right now: is it configured, does it
// answer, which version, which TTL is in force, and which tables exist.
//
// ALWAYS ANSWERS. An unconfigured deployment, an unreachable store, a missing
// admin credential, or one of the two follow-up reads failing are all FIELDS
// of the response (`configured`, `reachable`, `ttl: null`, `error`), never a
// 500 — the admin page is where an operator goes to find out what is wrong,
// so it must be able to render while things are wrong.
//
// What it reads, all through the store port: `ping()` (reachable, version),
// `retention.current()` (the TTL in force; the built-in store reads
// `SHOW CREATE DATABASE` on the admin connection when it is configured, else on
// the reader) and `schema()` (the tables with their row estimates). A store
// with no retention control reports `ttl: null`.
// =============================================================================

/** Per-statement ceiling for the status reads. A status page must not hang. */
export const TELEMETRY_STATUS_TIMEOUT_MS = 5_000;

@Injectable()
export class TelemetryStatusService {
  private readonly logger = new Logger(TelemetryStatusService.name);

  constructor(
    @Inject(TELEMETRY_STORE) private readonly store: TelemetryStore,
    private readonly settings: TelemetrySettingsService,
  ) {}

  async getStatus(): Promise<TelemetryStatus> {
    const { retentionDays } = await this.settings.getPolicy();
    const database = this.store.database;

    const base: TelemetryStatus = {
      configured: this.store.isConfigured(),
      reachable: false,
      version: null,
      database,
      ttl: null,
      retentionDays,
      tables: [],
      error: null,
    };

    if (!base.configured) {
      // The deployment's own GreptimeDB lacking a login is something an
      // administrator must be told in their terms (issue #570); any other
      // unconfigured state is just `configured: false`.
      return { ...base, error: this.store.configurationProblem() };
    }

    const ping = await this.store.ping();

    if (!ping.reachable) {
      return { ...base, error: ping.error ?? 'The telemetry store did not answer.' };
    }

    const errors: string[] = [];

    const [ttl, tables] = await Promise.all([
      this.readTtl().catch((error: unknown) => {
        errors.push(`TTL: ${message(error)}`);
        return null;
      }),
      this.readTables().catch((error: unknown) => {
        errors.push(`tables: ${message(error)}`);
        return [];
      }),
    ]);

    if (errors.length > 0) {
      this.logger.warn(`Telemetry status partially unavailable: ${errors.join('; ')}`);
    }

    return {
      ...base,
      reachable: true,
      version: ping.version ?? null,
      ttl,
      tables,
      error: errors.length > 0 ? errors.join('; ') : null,
    };
  }

  private async readTtl(): Promise<TelemetryTtl | null> {
    return (await this.store.retention?.current({ timeoutMs: TELEMETRY_STATUS_TIMEOUT_MS })) ?? null;
  }

  private async readTables(): Promise<TelemetryStatus['tables']> {
    const schema = await this.store.schema({ timeoutMs: TELEMETRY_STATUS_TIMEOUT_MS });

    return schema.tables.map((table) => ({ name: table.name, rows: table.rows }));
  }
}

// Kept here for the callers that import them from the status service.
export { parseHumantimeSeconds, parseTtlFromCreateDatabase } from './stores/greptime/greptime.retention';

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
