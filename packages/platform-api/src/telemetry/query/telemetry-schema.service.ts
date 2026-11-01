import { Inject, Injectable } from '@nestjs/common';

import type { TelemetrySchema, TelemetrySchemaTable } from '../dto/telemetry-query.dto';
import { TELEMETRY_STORE, type TelemetryStore } from '../stores/telemetry-store';
import { TelemetrySettingsService } from '../telemetry-settings.service';
import { requireQueryablePolicy, toTelemetryHttpError } from './telemetry-availability';

// =============================================================================
// TelemetrySchemaService — which tables and columns the store has
// (issue #535, epic #528)
// =============================================================================
//
// Feeds the explorer's schema tree and editor autocompletion, and — through
// `tableExists` / `describeTable` — lets the assistant (#536) validate an
// identifier before quoting it into SQL (there are no bind parameters, spike
// #529).
//
// The store describes itself (`TelemetryStore.schema()`; the built-in reads
// `information_schema` twice, filtered to the configured database). Cached for
// `TELEMETRY_SCHEMA_CACHE_MS`: tables appear on first write and attribute
// columns as new attributes arrive, so a short cache is fresh enough and saves
// a round trip per keystroke of autocompletion.
//
// Not audited: this reads metadata, not telemetry. The same preconditions as
// a query apply (503 unconfigured, 409 disabled).
// =============================================================================

export const TELEMETRY_SCHEMA_CACHE_MS = 30_000;

/**
 * The telemetry store's tables and columns, cached briefly. Exported by
 * `TelemetryModule`.
 *
 * @stability experimental
 */
@Injectable()
export class TelemetrySchemaService {
  private cache: { value: TelemetrySchema; readAt: number } | null = null;
  private inflight: Promise<TelemetrySchema> | null = null;

  constructor(
    @Inject(TELEMETRY_STORE) private readonly store: TelemetryStore,
    private readonly settings: TelemetrySettingsService,
  ) {}

  /** Every table with its columns, both sorted by name / position. */
  async getSchema(opts: { fresh?: boolean } = {}): Promise<TelemetrySchema> {
    const policy = await requireQueryablePolicy(this.store, this.settings);

    if (!opts.fresh && this.cache && Date.now() - this.cache.readAt < TELEMETRY_SCHEMA_CACHE_MS) {
      return this.cache.value;
    }

    // Concurrent callers share one read.
    if (!this.inflight) {
      this.inflight = this.read(policy.query.timeoutSeconds * 1000)
        .then((value) => {
          this.cache = { value, readAt: Date.now() };
          return value;
        })
        .finally(() => {
          this.inflight = null;
        });
    }

    return this.inflight;
  }

  /** Whether `name` is exactly (case-sensitively) a table of the telemetry database. */
  async tableExists(name: string): Promise<boolean> {
    return (await this.describeTable(name)) !== null;
  }

  /** One table's schema, or null when there is no such table. */
  async describeTable(name: string): Promise<TelemetrySchemaTable | null> {
    const schema = await this.getSchema();

    return schema.tables.find((table) => table.name === name) ?? null;
  }

  /** Drops the cached schema so the next read asks the store. */
  invalidateCache(): void {
    this.cache = null;
  }

  private async read(timeoutMs: number): Promise<TelemetrySchema> {
    try {
      return await this.store.schema({ timeoutMs });
    } catch (error) {
      throw toTelemetryHttpError(error);
    }
  }
}

// Kept here for the callers that import it from the schema service.
export { groupSchema } from '../stores/greptime/greptime.schema';
