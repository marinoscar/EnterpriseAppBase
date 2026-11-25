// =============================================================================
// The telemetry store port and its registry (PP-14.11)
// =============================================================================
//
// Where the telemetry the collector exports is KEPT AND QUERIED. The slice's
// services (the explorer, the dashboard, the schema reader, the status page,
// the retention job, the Doctor checks, the assistant) depend on exactly two
// things and never on a concrete database client:
//
//   TelemetryStore        the connection: run a read-only statement, describe
//                         the schema, answer a ping, optionally control
//                         retention
//   TelemetrySqlDialect   the spelling of the handful of constructs the
//                         server-authored dashboard SQL cannot write in
//                         portable SQL (time buckets, percentiles, ...)
//
// `greptime` (GreptimeDB over the PostgreSQL wire protocol) is the built-in
// implementation; it registers through `registerTelemetryStore`, the same
// function an app uses (`./greptime/greptime.store.ts`). An app registers its
// own at import time and selects it with `TelemetryModule.forRoot({ store })`.
//
// WHAT STAYS IN THE PLATFORM, ABOVE THE STORE: the explorer's guard (one
// read-only statement, the row cap, the timeout, the audit row) is applied by
// `TelemetryQueryService` BEFORE a statement reaches `TelemetryStore.query`, so
// a store can be as permissive as its database and still never see a write from
// a route. The store's own `readOnly: true` option is the second line of
// defence (the built-in logs in with a read-only user); the conformance kit
// proves a store refuses a write.
//
// FRAMEWORK-LIGHT, AND A LEAF: this file imports the pluggable-kind primitive,
// the credential purpose registry and types, so it can be imported from a
// seed, a script or an app registration without a Nest container.
// =============================================================================

import type { Logger } from '@nestjs/common';
import type { TelemetrySchema, TelemetryTtl } from '@marinoscar/platform-contract/telemetry';
import type { PluggableDescriptor } from '@marinoscar/platform-contract/settings';
import { PLUGGABLE_ID_PATTERN } from '@marinoscar/platform-contract/settings';

import {
  definePluggableKind,
  type PluggableBuildInput,
  type PluggableImplementation,
  type PluggableKind,
  type PluggableSecretPresence,
} from '../../core/index';
import { credentialPurposeRegistry, registerCredentialPurpose } from '../../credentials/index';

// ---- injection tokens ----------------------------------------------------------------

/**
 * Injection token of the active {@link TelemetryStore}: what the explorer, the
 * dashboard, the status page, the retention job and the Doctor checks inject.
 * Provided by `TelemetryModule` for the store `forRoot({ store })` selects.
 *
 * @extensionPoint token
 * @stability experimental
 */
export const TELEMETRY_STORE: unique symbol = Symbol.for('@marinoscar/platform/telemetry/STORE');

/**
 * Injection token of the active store's {@link TelemetrySqlDialect}.
 *
 * @extensionPoint token
 * @stability experimental
 */
export const TELEMETRY_SQL_DIALECT: unique symbol = Symbol.for('@marinoscar/platform/telemetry/SQL_DIALECT');

// ---- the wire shapes of a result ---------------------------------------------------

/**
 * A column of a result, as the store describes it.
 *
 * @stability experimental
 */
export interface TelemetryField {
  /** The column name. */
  name: string;
  /**
   * PostgreSQL type OID (1043 varchar, 20 int8, 1700 numeric, 1114/1184
   * timestamp, ...). The explorer maps it to the simplified type name it shows;
   * a store that is not PostgreSQL-shaped reports the closest OID (25 for text,
   * 701 for floating point, 1114 for a timestamp), and 0 for "unknown".
   */
  dataTypeID: number;
}

/**
 * One statement's result. `rows[i][j]` is the value of `fields[j]`. Positional
 * on purpose: telemetry SQL routinely selects two columns with the same name
 * (`a.trace_id`, `b.trace_id`), which object rows would silently collapse.
 *
 * @stability experimental
 */
export interface TelemetryQueryResult {
  /** The columns. */
  fields: TelemetryField[];
  /** The rows, in column order. 64-bit integers, decimals and timestamps arrive as the store's text (a JS number would lose precision). */
  rows: unknown[][];
}

/**
 * How one statement runs. Every store honours both members.
 *
 * @stability experimental
 */
export interface TelemetryQueryOptions {
  /** Hard ceiling on the statement's wall-clock time. Exceeding it is a `TelemetryQueryTimeoutError`. */
  timeoutMs: number;
  /**
   * Abandons the statement when aborted (`TelemetryQueryAbortedError`): a
   * closed assistant stream stops its in-flight query.
   */
  signal?: AbortSignal;
}

/**
 * What {@link TelemetryStore.query} receives: the options above plus the
 * declaration that the statement must not change anything.
 *
 * @stability experimental
 */
export interface TelemetryStoreQueryOptions extends TelemetryQueryOptions {
  /** Always `true`. A store refuses a statement that would write, whatever the text says. */
  readOnly: true;
}

/**
 * The outcome of {@link TelemetryStore.ping}.
 *
 * @stability experimental
 */
export interface TelemetryPingResult {
  /** Whether the store answered. */
  reachable: boolean;
  /** The store's version string, when it reports one (`PostgreSQL 16.3 GreptimeDB 1.2.1`). */
  version?: string;
  /** Why it did not answer (no secret material). */
  error?: string;
}

/**
 * The tables and columns of the store, in the explorer's shape: tables sorted
 * by name, columns by position.
 *
 * @stability experimental
 */
export type TelemetrySchemaSnapshot = TelemetrySchema;

/**
 * A store's retention control: the platform states `telemetry.retentionDays`
 * and the store makes it so. Optional on a store; a store without it simply has
 * no retention knob and the platform skips the job.
 *
 * @stability experimental
 */
export interface TelemetryRetentionControl {
  /**
   * Whether retention can be changed right now. For the built-in store this is
   * "the admin login is configured". Pure and synchronous.
   */
  isApplicable(): boolean;
  /**
   * Makes the store keep telemetry for `retentionDays` (1 to 3650). Idempotent.
   * Throws a {@link TelemetryStoreError} subclass on failure so the queue's
   * retry applies.
   *
   * @param retentionDays - the policy, in whole days.
   * @param options - the statement's ceiling.
   */
  apply(retentionDays: number, options: { timeoutMs: number }): Promise<void>;
  /**
   * The retention in force, or `null` when none is set or it cannot be read.
   *
   * @param options - the read's ceiling.
   */
  current(options: { timeoutMs: number }): Promise<TelemetryTtl | null>;
}

// ---- the port ---------------------------------------------------------------------

/**
 * The telemetry store: a read-only SQL connection to wherever the exported
 * traces, logs and metrics are kept. Implementations throw the typed errors of
 * `./telemetry-store.errors.ts` so the explorer maps them to HTTP responses.
 *
 * @example
 * ```ts
 * const store: TelemetryStore = {
 *   id: 'my-store',
 *   isConfigured: () => true,
 *   configurationProblem: () => null,
 *   database: 'telemetry',
 *   query: async (sql, _params, { timeoutMs }) => myDriver.select(sql, { timeoutMs }),
 *   schema: async () => ({ tables: [] }),
 *   ping: async () => ({ reachable: true }),
 *   close: async () => undefined,
 * };
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export interface TelemetryStore {
  /** The store id it was registered under (`greptime`). */
  readonly id: string;
  /**
   * The name of the database or namespace telemetry lives in. Shown on the
   * status page and recorded as the audit target of every query.
   */
  readonly database: string;
  /**
   * Whether the store can be queried: a connection is configured. Pure and
   * synchronous (the telemetry export gate reads it on a timer). An
   * unconfigured store is a supported state, not a fault.
   */
  isConfigured(): boolean;
  /**
   * Why a configured-looking deployment cannot use the store, in administrator
   * language, or `null`. Shown on the status page.
   */
  configurationProblem(): string | null;
  /**
   * Runs one read-only statement and returns its rows.
   *
   * MUST refuse a statement that writes (`options.readOnly` is always `true`),
   * MUST honour `options.timeoutMs` (a `TelemetryQueryTimeoutError`) and
   * `options.signal` (a `TelemetryQueryAbortedError`), and MUST throw
   * `TelemetryNotConfiguredError` when `isConfigured()` is false.
   *
   * @param sql - one finished statement. The platform authors or guards it first.
   * @param params - bind parameters, in order. The platform passes `[]` today: the built-in store's wire protocol has no placeholders, so values are quoted into the text. A store may accept parameters; one that cannot refuses a non-empty list.
   * @param options - the ceiling, the abort signal and `readOnly: true`.
   */
  query(sql: string, params: readonly unknown[], options: TelemetryStoreQueryOptions): Promise<TelemetryQueryResult>;
  /**
   * The tables and columns, for the explorer's schema tree and the dashboard's
   * discovery of which tables and attribute columns exist.
   *
   * @param options - the read's ceiling.
   */
  schema(options?: { timeoutMs?: number }): Promise<TelemetrySchemaSnapshot>;
  /** Reachability probe. NEVER throws: a failure is `{ reachable: false, error }`. */
  ping(): Promise<TelemetryPingResult>;
  /** Releases connections. Called when the store is replaced and at shutdown; never throws. */
  close(): Promise<void>;
  /** The retention control, when the store has one. */
  readonly retention?: TelemetryRetentionControl;
}

// ---- the dialect --------------------------------------------------------------------

/**
 * The constructs the server-authored dashboard SQL (`dashboard/telemetry-dashboard.sql.ts`,
 * the metric catalog's series builders) cannot write in portable SQL. Every
 * argument that names a column or an expression is ALREADY a quoted SQL
 * fragment; every `pattern`, `replacement` and `key` is a RAW string the
 * dialect quotes itself (with {@link quoteSqlLiteral}).
 *
 * The rest of the SQL is assumed to be ANSI-flavoured and is not abstracted:
 * `"double-quoted"` identifiers, `'single-quoted'` literals, `CASE WHEN`,
 * `GROUP BY` an alias, `UNION`, subqueries in `FROM`, scalar subqueries,
 * `count`/`sum`/`min`/`max`/`avg`, `substr`, ISO timestamp literals compared
 * with a timestamp column, and `lag(...) OVER (...)` in the metric catalog.
 *
 * @example
 * ```ts
 * const dialect: TelemetrySqlDialect = {
 *   ...BASE,
 *   timeBucket: (column, seconds) => `time_bucket(${seconds}, ${column})`,
 * };
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export interface TelemetrySqlDialect {
  /** A short id for logs (`greptime`). */
  readonly id: string;
  /** The time-index column of the metric tables (`greptime_timestamp`). */
  readonly timestampColumn: string;
  /** The value column of the metric tables (`greptime_value`). */
  readonly valueColumn: string;
  /**
   * The start of the fixed-width bucket containing `column`, aligned to the
   * epoch: `date_bin(INTERVAL '60 seconds', "timestamp")`.
   *
   * @param column - a quoted column or expression of timestamp type.
   * @param intervalSeconds - one of the dashboard's bucket sizes (10 to 21600).
   */
  timeBucket(column: string, intervalSeconds: number): string;
  /**
   * The aggregate `fraction` quantile (0 to 1) of `valueExpr`, ignoring NULLs:
   * `approx_percentile_cont(0.95) WITHIN GROUP (ORDER BY "duration_nano")`.
   *
   * @param fraction - 0.95 for p95.
   * @param valueExpr - a numeric expression; may contain a `CASE ... THEN NULL`.
   */
  percentile(fraction: number, valueExpr: string): string;
  /**
   * Every match of the regular expression `pattern` in `expr` replaced by
   * `replacement` (which may reference group 2 as `$2`).
   *
   * @param expr - a quoted text column or expression.
   * @param pattern - the raw pattern.
   * @param replacement - the raw replacement.
   */
  regexpReplaceAll(expr: string, pattern: string, replacement: string): string;
  /**
   * The string at top-level `key` of the JSON column `column` (a log record's
   * `resource_attributes`), `NULL` when absent.
   *
   * @param column - a quoted column.
   * @param key - the raw key (`service.name`).
   */
  jsonString(column: string, key: string): string;
  /**
   * Case-insensitive substring match: `expr` contains the text whose LIKE
   * body is `escapedPattern` (control characters stripped, `\`, `%` and `_`
   * escaped with `\`, `'` doubled; the dialect wraps it in `%...%` and the
   * escape clause).
   *
   * @param expr - a quoted text column.
   * @param escapedPattern - the output of `likeContainsPattern`.
   */
  containsIgnoreCase(expr: string, escapedPattern: string): string;
  /**
   * `expr` as text with full precision: `CAST("timestamp" AS STRING)`.
   *
   * @param expr - any expression.
   */
  castText(expr: string): string;
  /**
   * The row-cap clause: `LIMIT 100`.
   *
   * @param rows - a positive safe integer.
   */
  limit(rows: number): string;
}

/**
 * A result's rows as objects keyed by column name. Only when the names are
 * unique; use the positional `rows` otherwise.
 *
 * @param result - a query result.
 * @stability experimental
 */
export function rowsAsObjects(result: TelemetryQueryResult): Record<string, unknown>[] {
  return result.rows.map((row) => Object.fromEntries(result.fields.map((field, index) => [field.name, row[index]])));
}

/**
 * Double-quotes an SQL identifier (doubling `"`). For a dialect implementation.
 *
 * @param name - the identifier.
 * @stability experimental
 */
export function quoteSqlIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * Single-quotes an SQL string literal (doubling `'`). For a dialect
 * implementation; callers validate the value first.
 *
 * @param value - the text.
 * @stability experimental
 */
export function quoteSqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

// ---- the registry ---------------------------------------------------------------------

/**
 * What an implementation's `build` returns: the store and the dialect its SQL
 * is written in.
 *
 * @stability experimental
 */
export interface TelemetryStoreInstance {
  /** The connection. */
  store: TelemetryStore;
  /** The dialect of the dashboard SQL for this store. */
  dialect: TelemetrySqlDialect;
}

/**
 * What the slice passes to `build` besides the store's own settings and
 * secrets.
 *
 * @stability experimental
 */
export interface TelemetryStoreBuildContext {
  /** A logger scoped to the telemetry slice. Never log a secret through it. */
  logger: Logger;
  /**
   * The runtime GreptimeDB connection resolver, which the built-in `greptime`
   * store builds its pools from (its connection is configured at
   * /admin/settings/telemetry, not in a settings record). Every other store
   * ignores it.
   */
  connection: unknown;
}

/**
 * The argument of a store definition's `build`.
 *
 * @stability experimental
 */
export type TelemetryStoreBuildInput = PluggableBuildInput<TelemetryStoreBuildContext, Record<string, unknown>>;

/**
 * A telemetry store implementation: an id, a label, its own settings schema,
 * defaults and secrets (the pluggable-kind shape), and `build`, which returns
 * the store and its dialect.
 *
 * @extensionPoint registry
 * @stability experimental
 */
export type TelemetryStoreDefinition = PluggableImplementation<TelemetryStoreInstance, TelemetryStoreBuildContext, any>;

/**
 * The `telemetry-store` pluggable kind. Use {@link registerTelemetryStore} and
 * the helpers below rather than the kind directly.
 *
 * @extensionPoint registry
 * @stability experimental
 */
export const telemetryStoreKind: PluggableKind<TelemetryStoreInstance, TelemetryStoreBuildContext> = definePluggableKind<
  TelemetryStoreInstance,
  TelemetryStoreBuildContext
>({
  kind: 'telemetry-store',
  label: 'Telemetry store',
});

/**
 * The id of the built-in store.
 *
 * @stability stable
 */
export const BUILTIN_TELEMETRY_STORE_ID = 'greptime';

/**
 * The credential purpose a store's secrets use (`telemetry_<id>`).
 *
 * @param id - the store id.
 * @stability experimental
 */
export function telemetryStoreCredentialPurpose(id: string): string {
  return `telemetry_${id}`;
}

const SECRET_LOOKING_FIELD = /key|secret|token|password/i;

/**
 * Registers a telemetry store. Call it at import time, before the application
 * bootstraps (the reference app does it from `apps/api/src/app-registrations/telemetry.ts`,
 * which `platform/telemetry/telemetry.config.ts` imports before it builds the
 * module). The built-in `greptime` store registers through this same function.
 *
 * Registering is not selecting: the store the slice uses is
 * `TelemetryModule.forRoot({ store: '<id>' })`, default `greptime`. Once
 * selected, every consumer (the explorer, the dashboard, the status page, the
 * retention job, the Doctor) uses it, the store's non-secret settings are read
 * from the `telemetry_store` settings row and its secrets from the credential
 * purpose `telemetry_<id>`, and `GET /api/admin/telemetry/store` describes it
 * for a generated form.
 *
 * @param def - the implementation.
 * @throws Error when the definition is malformed (a secret-looking settings field, defaults that do not parse, `build` missing).
 * @throws RegistryError `DUPLICATE_ID` when the id is taken, `FROZEN` after the application bootstrapped, `INVALID_ID` for a malformed id.
 *
 * @example
 * ```ts
 * registerTelemetryStore({
 *   id: 'memory',
 *   label: 'In-memory (example)',
 *   settingsSchema: z.object({ latencyMs: z.number().int().min(0).default(0) }),
 *   defaults: { latencyMs: 0 },
 *   build: ({ settings }) => ({ store: new MemoryTelemetryStore(settings.latencyMs), dialect: MEMORY_DIALECT }),
 * });
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function registerTelemetryStore(def: TelemetryStoreDefinition): void {
  if (typeof def.id !== 'string' || !PLUGGABLE_ID_PATTERN.test(def.id)) {
    throw new Error(`Invalid telemetry store id ${JSON.stringify(def.id)}: it must match ${PLUGGABLE_ID_PATTERN}.`);
  }
  const where = `Telemetry store "${def.id}"`;
  if (typeof def.build !== 'function') throw new Error(`${where}: build must be a function.`);
  if (typeof def.settingsSchema?.shape !== 'object') throw new Error(`${where}: settingsSchema must be a z.object(...).`);
  for (const field of Object.keys(def.settingsSchema.shape)) {
    if (SECRET_LOOKING_FIELD.test(field)) {
      throw new Error(
        `${where}: settingsSchema declares "${field}", which looks like a secret. A secret is never a setting: ` +
          'declare it in `secrets`; it is stored encrypted in the credential store.',
      );
    }
  }
  const parsedDefaults = def.settingsSchema.safeParse(def.defaults);
  if (!parsedDefaults.success) {
    throw new Error(
      `${where}: defaults do not parse with settingsSchema: ` +
        parsedDefaults.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; '),
    );
  }

  const secrets = def.secrets ?? [];
  const purpose = telemetryStoreCredentialPurpose(def.id);
  const ownsPurpose = secrets.length > 0;
  if (ownsPurpose && credentialPurposeRegistry.has(purpose)) {
    throw new Error(`${where}: the credential purpose "${purpose}" is already registered by another owner. Pick another store id.`);
  }

  telemetryStoreKind.register(def);

  if (ownsPurpose) {
    registerCredentialPurpose({ purpose, owner: 'telemetry', label: `${def.label} secrets`, tiers: ['system'] });
  }
}

/**
 * Every registered store id, in registration order (the built-in first).
 *
 * @stability experimental
 */
export function telemetryStoreIds(): string[] {
  return telemetryStoreKind.ids();
}

/**
 * The store implementation registered under `id`.
 *
 * @param id - the store id.
 * @throws PluggableUnknownError when none is registered; the message names the registered ids.
 * @stability experimental
 */
export function requireTelemetryStore(id: string): TelemetryStoreDefinition {
  return telemetryStoreKind.get(id);
}

/**
 * The generated-form descriptor of one store: its non-secret fields, then one
 * write-only `secret` field per declared secret carrying only presence.
 *
 * @param id - a registered store id.
 * @param presence - which of its declared secrets are stored.
 * @stability experimental
 */
export function describeTelemetryStore(id: string, presence: PluggableSecretPresence): PluggableDescriptor {
  return telemetryStoreKind.describe(id, presence);
}
