// =============================================================================
// TelemetryStoreResolver: the selected store, built from its settings (PP-14.11)
// =============================================================================
//
// The `TELEMETRY_STORE` provider for a store that is NOT the built-in
// `greptime` (which `TelemetryModule` binds straight to its `GreptimeClient`,
// whose connection comes from `TelemetryConnectionService`). It finds the
// implementation `TelemetryModule.forRoot({ store })` selected in the registry,
// reads that store's own settings from the `telemetry_store` settings row and
// its declared secrets from the credential store, hands them to `build`, and
// keeps the result until they change.
//
//   - It IS a `TelemetryStore`: every member delegates to the built store, so
//     the explorer, the dashboard and the Doctor inject this token and never
//     see which implementation is behind it.
//   - A SAVE TAKES EFFECT EVERYWHERE WITHIN `REFRESH_INTERVAL_MS`: the settings
//     row version and the declared secrets' update times are the fingerprint;
//     when it moves the previous store is `close()`d and a new one is built.
//     The synchronous members (`isConfigured`, `database`, `retention`) read
//     the last built store, so they never wait on the database.
//   - IT NEVER THROWS A CONFIGURATION PROBLEM AT BOOT: stored settings that no
//     longer parse and a `build` that throws leave the store unbuilt, `ping()`
//     reports why, `query()` and `schema()` fail with a `TelemetryNotConfiguredError`
//     and `lastError()` is what the admin page shows. Fix the settings and the
//     next refresh recovers.
//   - NO SECRET IS EVER LOGGED OR HELD: `secret(name)` reads the credential
//     store for the call that asks.
// =============================================================================

import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

import { PluggableSettingsError } from '../../core/index';
import {
  TELEMETRY_CREDENTIAL_STORE,
  TELEMETRY_SETTINGS_STORE,
  type TelemetryCredentialStore,
  type TelemetrySettingsStore,
} from '../ports';
import { TelemetryConnectionService } from '../connection/telemetry-connection.service';
import { TELEMETRY_OPTIONS, type ResolvedTelemetryModuleOptions } from '../telemetry.options';
import { TelemetryNotConfiguredError } from './telemetry-store.errors';
import {
  telemetryStoreCredentialPurpose,
  telemetryStoreKind,
  type TelemetryPingResult,
  type TelemetryQueryResult,
  type TelemetryRetentionControl,
  type TelemetrySchemaSnapshot,
  type TelemetrySqlDialect,
  type TelemetryStore,
  type TelemetryStoreInstance,
  type TelemetryStoreQueryOptions,
} from './telemetry-store';

/**
 * The key of the system-settings row that holds the non-greptime stores'
 * settings: `{ [storeId]: <that store's settings> }`.
 *
 * @stability experimental
 */
export const TELEMETRY_STORE_SETTINGS_KEY = 'telemetry_store';

/** How long boot waits for the first build of the store. */
const BOOT_WAIT_MS = 3_000;

/** How often a running instance re-reads the settings row, so a save elsewhere reaches it. */
export const TELEMETRY_STORE_REFRESH_INTERVAL_MS = 5_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describeError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.length > 500 ? `${text.slice(0, 500)}…` : text;
}

interface Built {
  instance: TelemetryStoreInstance;
  fingerprint: string;
}

/**
 * The store `forRoot({ store })` selected, built from the `telemetry_store`
 * settings row and the store's secrets, and rebuilt when they change.
 *
 * @stability experimental
 */
@Injectable()
export class TelemetryStoreResolver implements TelemetryStore, OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('TelemetryStore');
  private current: Built | null = null;
  private problem: string | null = null;
  private timer: NodeJS.Timeout | null = null;
  private inFlight: Promise<void> | null = null;
  private lastRefreshAt = 0;
  private started = false;
  private settings: Record<string, unknown> | undefined;

  /** The store id `forRoot` selected. */
  readonly id: string;

  constructor(
    @Inject(TELEMETRY_OPTIONS) options: Pick<ResolvedTelemetryModuleOptions, 'store'>,
    @Inject(TELEMETRY_SETTINGS_STORE) private readonly settingsStore: TelemetrySettingsStore,
    @Inject(TELEMETRY_CREDENTIAL_STORE) private readonly credentials: TelemetryCredentialStore,
    private readonly connection: TelemetryConnectionService,
  ) {
    this.id = options.store;
  }

  /**
   * Builds the store once and then keeps it fresh. Boot waits for the first
   * build only briefly (`BOOT_WAIT_MS`) and never fails because of a store: a
   * database that is slow to answer leaves the store unbuilt until the next
   * refresh.
   */
  async onModuleInit(): Promise<void> {
    this.started = true;
    let waiting: NodeJS.Timeout | undefined;
    await Promise.race([
      this.refresh(),
      new Promise<void>((resolve) => {
        waiting = setTimeout(resolve, BOOT_WAIT_MS);
        waiting.unref?.();
      }),
    ]);
    if (waiting) clearTimeout(waiting);
    this.timer = setInterval(() => void this.refresh(), TELEMETRY_STORE_REFRESH_INTERVAL_MS);
    this.timer.unref?.();
  }

  async onModuleDestroy(): Promise<void> {
    this.started = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const built = this.current;
    this.current = null;
    await this.release(built);
  }

  /**
   * Re-reads the settings and secrets and rebuilds the store when they moved.
   * Concurrent calls share one run. Never throws: a problem is `lastError()`.
   */
  refresh(): Promise<void> {
    if (!this.inFlight) {
      this.inFlight = this.run().finally(() => {
        this.inFlight = null;
        this.lastRefreshAt = Date.now();
      });
    }
    return this.inFlight;
  }

  /** Why the store could not be built (no secret material), or `null`. */
  lastError(): string | null {
    return this.problem;
  }

  /** The parsed settings the built store was made from, `undefined` while unbuilt. */
  currentSettings(): Record<string, unknown> | undefined {
    return this.settings;
  }

  /** The built store's dialect. */
  get dialect(): TelemetrySqlDialect {
    if (!this.current) {
      throw new TelemetryNotConfiguredError('reader', this.notReadyMessage());
    }
    return this.current.instance.dialect;
  }

  // ---- TelemetryStore ----------------------------------------------------------

  get database(): string {
    return this.current?.instance.store.database ?? this.id;
  }

  get retention(): TelemetryRetentionControl | undefined {
    return this.current?.instance.store.retention;
  }

  isConfigured(): boolean {
    return this.current?.instance.store.isConfigured() ?? false;
  }

  configurationProblem(): string | null {
    return this.current?.instance.store.configurationProblem() ?? this.problem;
  }

  async query(sql: string, params: readonly unknown[], options: TelemetryStoreQueryOptions): Promise<TelemetryQueryResult> {
    return (await this.ready()).query(sql, params, options);
  }

  async schema(options?: { timeoutMs?: number }): Promise<TelemetrySchemaSnapshot> {
    return (await this.ready()).schema(options);
  }

  async ping(): Promise<TelemetryPingResult> {
    try {
      return await (await this.ready()).ping();
    } catch (error) {
      return { reachable: false, error: describeError(error) };
    }
  }

  async close(): Promise<void> {
    await this.onModuleDestroy();
  }

  // ---- internals ---------------------------------------------------------------

  private notReadyMessage(): string {
    return (
      this.problem ??
      `The telemetry store "${this.id}" is not configured. Configure it at /admin/settings/telemetry.`
    );
  }

  /** The built store, refreshed when stale; throws `TelemetryNotConfiguredError` when none could be built. */
  private async ready(): Promise<TelemetryStore> {
    if (!this.started || Date.now() - this.lastRefreshAt > TELEMETRY_STORE_REFRESH_INTERVAL_MS || !this.current) {
      await this.refresh();
    }
    if (!this.current) throw new TelemetryNotConfiguredError('reader', this.notReadyMessage());
    return this.current.instance.store;
  }

  private async run(): Promise<void> {
    let fingerprint: string;
    let settings: Record<string, unknown>;

    try {
      const row = await this.settingsStore.readRow(TELEMETRY_STORE_SETTINGS_KEY);
      const stored = isRecord(row?.value) ? (row.value as Record<string, unknown>)[this.id] : undefined;
      settings = telemetryStoreKind.parseSettings(this.id, stored);

      const definition = telemetryStoreKind.get(this.id);
      const purpose = telemetryStoreCredentialPurpose(this.id);
      const stamps: string[] = [];
      for (const secret of definition.secrets ?? []) {
        const info = await this.credentials.describe(purpose, secret.name);
        stamps.push(`${secret.name}:${info ? info.updatedAt.toISOString() : '-'}`);
      }
      fingerprint = createHash('sha256')
        .update(JSON.stringify({ settings, stamps }))
        .digest('hex');
    } catch (error) {
      this.problem =
        error instanceof PluggableSettingsError
          ? `The stored settings of the telemetry store "${this.id}" are invalid at: ${[
              ...new Set(error.issues.map((issue) => issue.path.join('.') || '(root)')),
            ].join(', ')}. Save them again at /admin/settings/telemetry.`
          : `The settings of the telemetry store "${this.id}" could not be read: ${describeError(error)}`;
      // A transient read failure keeps the store that is already running.
      if (!(error instanceof PluggableSettingsError) && this.current) return;
      const previous = this.current;
      this.current = null;
      await this.release(previous);
      return;
    }

    if (this.current?.fingerprint === fingerprint) {
      this.problem = null;
      return;
    }

    let instance: TelemetryStoreInstance;
    try {
      const definition = telemetryStoreKind.get(this.id);
      const purpose = telemetryStoreCredentialPurpose(this.id);
      instance = await definition.build({
        logger: new Logger(`TelemetryStore:${this.id}`),
        connection: this.connection,
        settings,
        secret: async (name: string) => this.credentials.getSecret(purpose, name),
      });
    } catch (error) {
      this.problem = `The telemetry store "${this.id}" could not be built: ${describeError(error)}`;
      this.logger.warn(this.problem);
      const previous = this.current;
      this.current = null;
      await this.release(previous);
      return;
    }

    // Read AGAIN after the awaits: the previous one is whatever is current now.
    const previous = this.current;
    this.current = { instance, fingerprint };
    this.settings = settings;
    this.problem = null;
    if (previous) this.logger.log(`Telemetry store "${this.id}" settings changed; replaced the running store`);
    await this.release(previous);
  }

  private async release(built: Built | null): Promise<void> {
    if (!built) return;
    try {
      await built.instance.store.close();
    } catch (error) {
      this.logger.warn(`Telemetry store "${this.id}" failed to release its resources: ${describeError(error)}`);
    }
  }
}

/**
 * The `TELEMETRY_SQL_DIALECT` of a resolver-backed store: a dialect whose every
 * member asks the resolver for the built store's. Services construct their SQL
 * through it per call, so a rebuilt store's dialect is picked up with no
 * re-injection.
 *
 * @param resolver - the resolver.
 * @stability experimental
 */
export function delegatingDialect(resolver: Pick<TelemetryStoreResolver, 'dialect' | 'id'>): TelemetrySqlDialect {
  return {
    get id() {
      return resolver.dialect.id;
    },
    get timestampColumn() {
      return resolver.dialect.timestampColumn;
    },
    get valueColumn() {
      return resolver.dialect.valueColumn;
    },
    timeBucket: (column, seconds) => resolver.dialect.timeBucket(column, seconds),
    percentile: (fraction, expr) => resolver.dialect.percentile(fraction, expr),
    regexpReplaceAll: (expr, pattern, replacement) => resolver.dialect.regexpReplaceAll(expr, pattern, replacement),
    jsonString: (column, key) => resolver.dialect.jsonString(column, key),
    containsIgnoreCase: (expr, pattern) => resolver.dialect.containsIgnoreCase(expr, pattern),
    castText: (expr) => resolver.dialect.castText(expr),
    limit: (rows) => resolver.dialect.limit(rows),
  };
}
