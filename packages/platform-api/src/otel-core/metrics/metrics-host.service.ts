// =============================================================================
// The metrics host (issue #600; split out of the app's AppMetricsService by
// issue #700)
// =============================================================================
//
// THE ONE PLACE INSTRUMENTS ARE CREATED. Every counter and histogram declared
// in the app-metric registry (`metric-name.registry.ts`) is created here, with
// exactly its declared name, unit, description and bucket boundaries; gauges
// are created by their providers (`gauge-provider.ts`). An app's own metrics
// service builds its typed recorders on top (the reference app:
// `apps/api/src/common/otel/app-metrics.service.ts`), and emits generic ones
// with `add(key, …)` / `record(key, …)`.
//
// -----------------------------------------------------------------------------
// OFF MEANS NO-OP, FOR FREE
// -----------------------------------------------------------------------------
//
// The meter is `metrics.getMeter('app')` from `@opentelemetry/api`. When
// `OTEL_ENABLED` is not `true`, `initializeOtel()` installs no SDK, the
// global MeterProvider is the API's no-op one, and every instrument is a
// no-op: a counter `add()` costs a function call. When the SDK IS installed
// but the runtime gate is closed, instruments still aggregate in memory and
// the gated exporter drops each batch (`sdk/telemetry-gate.ts`).
//
// Observable gauges are different, because their callbacks query something:
// a provider is called only when gauges are on for this process (the
// `gauges` option, default `OTEL_ENABLED === 'true'`), and each callback
// returns early while the gate is closed.
//
// -----------------------------------------------------------------------------
// NEVER THROWS
// -----------------------------------------------------------------------------
//
// `add`, `record` and `registerGaugeProvider` are wrapped: a metrics fault
// must never reach a job runner, an auth flow or a delivery.
// =============================================================================

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { metrics, type Attributes, type Counter, type Histogram, type Meter } from '@opentelemetry/api';

import { telemetryGate } from '../sdk/telemetry-gate';
import type { AppGaugeContext, AppMetricKeyLike, GaugeProvider } from './gauge-provider';
import { enumLabel, LabelBudget, nonNegative } from './labels';
import { appMetricRegistry, type AppMetricDef } from './metric-name.registry';

/**
 * The instrumentation scope every application metric is created under.
 *
 * @stability stable
 */
export const APP_METER_NAME = 'app';

/**
 * Injection token of the host's optional {@link MetricsHostOptions}: an
 * explicit meter, clock, gate and gauge switch. Unprovided in production
 * except for `gauges`; tests provide a meter from an in-memory
 * `MeterProvider`.
 *
 * @example
 * ```ts
 * OtelMetricsModule.forRootAsync({
 *   inject: [ConfigService],
 *   useFactory: (config: ConfigService) => ({ gauges: config.get('otel.enabled') === true }),
 * });
 * ```
 *
 * @extensionPoint token
 * @stability experimental
 */
export const METRICS_HOST_OPTIONS: unique symbol = Symbol.for('@marinoscar/platform/otel-core/METRICS_HOST_OPTIONS');

/**
 * Options of {@link MetricsHostService}, provided under {@link METRICS_HOST_OPTIONS}.
 *
 * @stability experimental
 */
export interface MetricsHostOptions {
  /** The meter instruments are created on. Default: `metrics.getMeter(APP_METER_NAME)`. */
  meter?: Meter;
  /** The clock, in epoch milliseconds. Default: `Date.now`. */
  now?: () => number;
  /** Whether the runtime export gate is open. Default: `telemetryGate.isEnabled()`. */
  gateOpen?: () => boolean;
  /** Forces gauge providers on or off. Default: `process.env.OTEL_ENABLED === 'true'`, read per call. */
  gauges?: boolean;
}

/** A created counter or histogram with its declaration and its enum sets, precomputed. */
interface RegisteredInstrument {
  def: AppMetricDef;
  instrument: Counter | Histogram;
  enums: ReadonlyMap<string, ReadonlySet<string>>;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The generic metrics host: creates every registered counter and histogram,
 * bounds labels, and hands gauge providers their context. Global through
 * `OtelMetricsModule`; an app builds its typed recorders on it.
 *
 * @stability experimental
 */
@Injectable()
export class MetricsHostService {
  private readonly logger = new Logger(MetricsHostService.name);

  /** The `app` meter: the SDK's when one is installed, the API's no-op meter otherwise. */
  readonly meter: Meter;
  /** The clock, in epoch milliseconds. */
  readonly now: () => number;
  /** Whether the runtime export gate is open. */
  readonly gateOpen: () => boolean;

  private readonly gaugesForced: boolean | undefined;

  /** Every registered counter and histogram, by code key, created from its declaration. */
  private readonly instruments = new Map<string, RegisteredInstrument>();
  /** Keys `add`/`record` were given that name no counter (or histogram) of that kind; each logged once. */
  private readonly unknownKeys = new Set<string>();
  private readonly labels = new LabelBudget();

  /**
   * @param options - See {@link MetricsHostOptions}; every field optional.
   */
  constructor(@Optional() @Inject(METRICS_HOST_OPTIONS) options?: MetricsHostOptions) {
    // Resolved at construction, which is after `initializeOtel()` has run (the
    // app loads it first), so this is the SDK's meter when there is one and
    // the API's no-op meter otherwise.
    this.meter = options?.meter ?? metrics.getMeter(APP_METER_NAME);
    this.now = options?.now ?? Date.now;
    this.gateOpen = options?.gateOpen ?? (() => telemetryGate.isEnabled());
    this.gaugesForced = options?.gauges;

    // Every counter and histogram registered so far, platform and app alike.
    // A declaration registered later is created on first use.
    for (const def of appMetricRegistry.list()) this.create(def);
  }

  // ===========================================================================
  // Instruments
  // ===========================================================================

  /**
   * The counter registered under `key`.
   *
   * @param key - A registry key declared as a counter.
   * @returns The counter.
   * @throws Error when `key` is not registered, or is not a counter.
   */
  counter(key: AppMetricKeyLike): Counter {
    return this.require(key, 'counter').instrument as Counter;
  }

  /**
   * The histogram registered under `key`.
   *
   * @param key - A registry key declared as a histogram.
   * @returns The histogram.
   * @throws Error when `key` is not registered, or is not a histogram.
   */
  histogram(key: AppMetricKeyLike): Histogram {
    return this.require(key, 'histogram').instrument as Histogram;
  }

  /**
   * Adds `value` (default 1) to the counter registered under `key`, with its
   * declared attributes only, each bounded (`enum`: the value or `other`;
   * `free`: {@link MetricsHostService.boundLabel}). An undeclared attribute
   * key is dropped. An unknown key, or a key that names a histogram or gauge,
   * is a no-op logged once at `debug`. A negative or non-finite value is
   * ignored (counters are monotonic). Never throws.
   *
   * @param key - The counter's registry key.
   * @param value - The amount; default 1.
   * @param attributes - Raw attributes, bounded per the declaration.
   */
  add(key: AppMetricKeyLike, value = 1, attributes?: Record<string, unknown>): void {
    this.safely(() => {
      const entry = this.instrumentFor(key, 'counter');
      const amount = nonNegative(value);
      if (!entry || amount === null) return;
      (entry.instrument as Counter).add(amount, this.boundAttributes(entry, attributes));
    });
  }

  /**
   * Records `value` on the histogram registered under `key`, with the same
   * attribute rules as {@link MetricsHostService.add}. A negative or
   * non-finite value is ignored. Never throws.
   *
   * @param key - The histogram's registry key.
   * @param value - The measurement, in the declared unit.
   * @param attributes - Raw attributes, bounded per the declaration.
   */
  record(key: AppMetricKeyLike, value: number, attributes?: Record<string, unknown>): void {
    this.safely(() => {
      const entry = this.instrumentFor(key, 'histogram');
      const amount = nonNegative(value);
      if (!entry || amount === null) return;
      (entry.instrument as Histogram).record(amount, this.boundAttributes(entry, attributes));
    });
  }

  // ===========================================================================
  // Label bounding
  // ===========================================================================

  /**
   * A free-form string as a low-cardinality label: `unknown` when empty,
   * `other` when it does not look like an identifier, is too long, or would
   * be the `MAX_DISTINCT_VALUES + 1`-th distinct value for `key` in this
   * process.
   *
   * @param key - The budget to charge (usually the attribute key).
   * @param value - The raw value.
   * @returns The bounded label.
   */
  boundLabel(key: string, value: unknown): string {
    return this.labels.bound(key, value);
  }

  // ===========================================================================
  // Gauges
  // ===========================================================================

  /**
   * Whether gauge providers run in this process: the `gauges` option, else
   * `OTEL_ENABLED === 'true'`.
   *
   * @returns `true` when gauges are on.
   */
  gaugesEnabled(): boolean {
    return this.gaugesForced ?? process.env.OTEL_ENABLED === 'true';
  }

  /**
   * The meter, clock and export gate for a gauge provider, or `null` when
   * gauges are off in this process (the caller then registers nothing).
   *
   * @returns The context, or `null`.
   */
  gaugeContext(): AppGaugeContext | null {
    if (!this.gaugesEnabled()) return null;
    return { meter: this.meter, now: this.now, gateOpen: this.gateOpen };
  }

  /**
   * Runs `provider` with the gauge context, once, when gauges are on. A
   * provider that throws is logged at `debug` and reported as not registered.
   * Never throws.
   *
   * @param provider - Creates its gauges (`createRegisteredGauge`) and their callback.
   * @returns Whether the provider ran to completion.
   *
   * @example
   * ```ts
   * metricsHost.registerGaugeProvider(({ meter, gateOpen }) => {
   *   const backlog = createRegisteredGauge(meter, 'coachBacklog');
   *   backlog.addCallback(async (result) => {
   *     if (!gateOpen()) return;
   *     result.observe(await countBacklog());
   *   });
   * });
   * ```
   *
   * @extensionPoint registry
   * @stability experimental
   */
  registerGaugeProvider(provider: GaugeProvider): boolean {
    const context = this.gaugeContext();
    if (!context) return false;
    try {
      provider(context);
      return true;
    } catch (error) {
      this.logger.debug(`Could not register application gauges: ${describe(error)}`);
      return false;
    }
  }

  // ===========================================================================
  // Internals
  // ===========================================================================

  private create(def: AppMetricDef): RegisteredInstrument | null {
    let instrument: Counter | Histogram;
    if (def.kind === 'counter') {
      instrument = this.meter.createCounter(def.name, { description: def.description, unit: def.unit });
    } else if (def.kind === 'histogram') {
      instrument = this.meter.createHistogram(def.name, {
        description: def.description,
        unit: def.unit,
        ...(def.buckets ? { advice: { explicitBucketBoundaries: [...def.buckets] } } : {}),
      });
    } else {
      return null;
    }

    const enums = new Map<string, ReadonlySet<string>>();
    for (const [key, rule] of Object.entries(def.attributes ?? {})) {
      if (rule.kind === 'enum') enums.set(key, new Set(rule.values));
    }
    const entry: RegisteredInstrument = { def, instrument, enums };
    this.instruments.set(def.key, entry);
    return entry;
  }

  /** The instrument for `key`, created on first use when it was registered after construction. */
  private lookup(key: string): RegisteredInstrument | null {
    const entry = this.instruments.get(key);
    if (entry) return entry;
    const def = appMetricRegistry.get(key);
    return def ? this.create(def) : null;
  }

  private require(key: string, kind: 'counter' | 'histogram'): RegisteredInstrument {
    const entry = this.lookup(key);
    if (entry && entry.def.kind === kind) return entry;
    const actual = entry?.def.kind ?? appMetricRegistry.get(key)?.kind;
    throw new Error(
      actual ? `App metric "${key}" is a ${actual}, not a ${kind}.` : `App metric "${key}" is not registered.`,
    );
  }

  private instrumentFor(key: string, kind: 'counter' | 'histogram'): RegisteredInstrument | null {
    const entry = this.lookup(key);
    if (entry && entry.def.kind === kind) return entry;

    if (!this.unknownKeys.has(key)) {
      this.unknownKeys.add(key);
      const why = entry ? `is a ${entry.def.kind}` : appMetricRegistry.has(key) ? 'is a gauge' : 'is not registered';
      this.logger.debug(`Metric "${String(key)}" ${why}; ${kind === 'counter' ? 'add' : 'record'}() ignored.`);
    }
    return null;
  }

  /** The declared attributes of the metric, bounded; every other key dropped. */
  private boundAttributes(entry: RegisteredInstrument, attributes: Record<string, unknown> | undefined): Attributes {
    const out: Attributes = {};
    if (!attributes || typeof attributes !== 'object') return out;

    for (const [key, rule] of Object.entries(entry.def.attributes ?? {})) {
      if (!Object.prototype.hasOwnProperty.call(attributes, key)) continue;
      const raw = attributes[key];
      if (raw === undefined || raw === null) continue;
      const value = typeof raw === 'number' || typeof raw === 'boolean' ? String(raw) : raw;
      const allowed = entry.enums.get(key);
      out[key] = rule.kind === 'enum' && allowed ? enumLabel(value, allowed) : this.boundLabel(key, value);
    }
    return out;
  }

  private safely(fn: () => void): void {
    try {
      fn();
    } catch (error) {
      this.logger.debug(`Metric recording skipped: ${describe(error)}`);
    }
  }
}
