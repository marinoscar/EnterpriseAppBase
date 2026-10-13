// =============================================================================
// The runtime telemetry gate (issue #532, epic #528; packaged by issue #700)
// =============================================================================
//
// TWO SWITCHES, AND THEY ARE NOT THE SAME SWITCH
// -----------------------------------------------------------------------------
//
//   1. `OTEL_ENABLED` (environment, infra). Decides whether the OpenTelemetry
//      SDK is installed in this process AT ALL — read once by
//      `initializeOtel()` (`initialize-otel.ts`, called from the app's
//      `instrumentation.ts`) before Nest exists. It is `true` when the
//      deployment ships the telemetry overlay (collector + storage backend),
//      and it cannot change without a restart, because auto-instrumentation
//      can only patch modules required AFTER `sdk.start()`.
//
//   2. `telemetry.enabled` (system setting, admin UI). Decides whether what
//      the installed SDK produces is actually EXPORTED. An administrator
//      flips it at runtime with no restart; the app's telemetry module calls
//      `telemetryGate.setEnabled()` on boot (once settings have loaded) and on
//      every settings refresh.
//
// The SDK keeps running either way — spans are still created, log records
// still correlated, metrics still aggregated — and the gated exporters below
// simply drop each batch while the gate is closed. Dropping is the intended
// behaviour, not a failure: a batch is acknowledged as SUCCESS so the
// processors neither retry it nor log an export error for it.
//
// The gate is read at EXPORT time, not when a span or record is created: a
// batch that was queued while closed and is flushed after the gate opens is
// sent. At worst that is one batch interval (the batch processors' scheduled
// delay, or the metric reader's 60s) on either side of a toggle.
//
// THE GATE STARTS CLOSED. Nothing leaves the process until settings have been
// read and an administrator's choice is known; a deployment that has switched
// telemetry off must not leak the first minute of every boot.
//
// THE INSTANCE IDENTIFIER IS STAMPED HERE TOO (issue #565)
// -----------------------------------------------------------------------------
//
// Every exported span, log record and metric batch carries the resource
// attribute `app.instance.id` (`instance-id.ts`), which an administrator
// changes at runtime (`telemetry.instanceId`). The SDK resource cannot carry
// it: `initializeOtel()` hands the resource to `NodeSDK` once, before
// `sdk.start()`, and it is immutable from then on — every span and record
// holds a reference to that one object. A runtime-changeable identity must
// therefore be applied at EXPORT time, and the gate is already the one place
// every batch passes through on its way out. The telemetry module pushes the
// resolved value with `telemetryGate.setInstanceId()` at the same moments it
// pushes `setEnabled()`: on boot, every refresh interval, and after a save.
//
// The value is read per batch, like the gate itself, so a change applies to
// the next batch exported. It starts at the app's default rather than empty
// (`initializeOtel({ instanceId })` seeds it with the app's slug before
// `sdk.start()`; the package's own placeholder is `DEFAULT_INSTANCE_ID`), so
// the first batch after the gate opens is never unlabelled even if it races
// the first settings read.
//
// HOW A RECORD IS RE-LABELLED WITHOUT TOUCHING IT
// -----------------------------------------------------------------------------
//
//   - Metrics: `ResourceMetrics` is a plain object built per collection, so
//     the batch is shallow-copied with a replaced `resource`.
//
//   - Spans and log records are SDK class instances (`SpanImpl`,
//     `LogRecordImpl`), shared with every other processor, and much of what
//     the OTLP transformer reads is a prototype GETTER over an underscored
//     field (`droppedAttributesCount`, `hrTime`, `severityText`, `body`,
//     `spanContext`…). A spread would lose every getter; mutating the
//     original would leak the label into other processors. So each record is
//     presented as `Object.create(record)` with ONE own property, `resource`:
//     every getter and method still resolves through the prototype chain with
//     `this` bound to the wrapper, which falls through to the original's
//     fields. (Neither class uses `#private` fields, which a wrapper could not
//     reach — checked against sdk-trace / sdk-logs 0.221.)
//
//   - The OTLP transformer (`@opentelemetry/otlp-transformer`, `trace/
//     internal.js` and `logs/internal.js`) groups records into
//     `ResourceSpans` / `ResourceLogs` with a `Map` KEYED BY THE RESOURCE
//     OBJECT'S IDENTITY. A fresh merged resource per record would emit one
//     `ResourceSpans` per span. The merged resource is therefore cached per
//     (original resource, instance id) pair in a `WeakMap`, so every record in
//     a batch that shared a resource still shares one — and a change of id
//     simply replaces the entry.
//
//   - `resource.merge(other)` gives `other`'s attributes precedence
//     (`ResourceImpl.merge` lists the incoming attributes first and
//     `attributes` keeps the first of each key), so the stamped id wins over
//     anything a detector or `OTEL_RESOURCE_ATTRIBUTES` put there, and every
//     other attribute (`service.name`, …) is preserved.
//
//   - The batch processors settle a resource's async (detector) attributes
//     BEFORE calling `export`, so the merged copy is built from settled
//     values. A cache entry built while its source was still pending is
//     rebuilt once the source has settled.
//
// EXTENSIONS ARE GATED TOO (PP-14.18)
// -----------------------------------------------------------------------------
//
// An app can add span processors, log record processors and metric readers to
// `initializeOtel` (a console exporter in development, a second backend). It
// hands the SDK objects whose exporters this file cannot see, so each one is
// wrapped before the SDK gets it:
//
//   - `GatedSpanProcessor` / `GatedLogRecordProcessor` forward `onStart`,
//     `onEnd` and `onEmit` only while the gate is open. Nothing reaches a
//     wrapped processor while it is closed, so a `SimpleSpanProcessor` that
//     exports on end exports nothing. `forceFlush` and `shutdown` always
//     delegate, like the exporters': a flush sends only what was accepted while
//     the gate was open.
//
//   - `GatedMetricReader` hands the inner reader a PRODUCER that answers an
//     empty collection while the gate is closed (and stamps `app.instance.id`
//     when it is open). Whatever the inner reader does with that (push it with a
//     periodic exporter, serve it on a Prometheus scrape) it has nothing to
//     send or serve while closed.
//
// The residual window is the same one the built-in batch processors have: a
// processor that batches on its own timer may export a batch it accepted
// shortly BEFORE the gate closed. Where that matters, build the processor over a
// `GatedSpanExporter` / `GatedLogRecordExporter` / `GatedPushMetricExporter`
// instead: those check the gate at the moment of export, and they stamp the
// instance id. `test/otel-core/telemetry-gate.spec.ts` proves nothing exports
// while the gate is closed, for every kind.
//
// SAFE TO IMPORT BEFORE THE SDK STARTS
// -----------------------------------------------------------------------------
//
// Like `service-name.ts`, this module is part of the `sdk` subpath, loaded
// ahead of `sdk.start()`. It is kept trivial and side-effect-free on purpose:
// module-level state, three thin wrapper classes, and imports only from the
// OpenTelemetry SDK packages themselves and `instance-id.ts` (never `http`,
// `pg`, `pino` or any other module the auto-instrumentation needs to patch).
// There is no Nest DI here because Nest does not exist yet when this runs.
//
// ONE COPY PER PROCESS. The gate is module-level state: two copies of
// `@marinoscar/platform-api` in one process would be two gates, and the app
// would open one while the SDK exports through the other. The platform
// single-instance check (issue #695) guards the package name.
// =============================================================================

import { ExportResultCode, type ExportResult } from '@opentelemetry/core';
import { resourceFromAttributes, type Resource } from '@opentelemetry/resources';
import type { Context } from '@opentelemetry/api';
import type { LogRecordExporter, LogRecordProcessor, ReadableLogRecord, SdkLogRecord } from '@opentelemetry/sdk-logs';
import {
  AggregationTemporality,
  InstrumentType,
  MetricReader,
  type AggregationOption,
  type CollectionResult,
  type MetricCollectOptions,
  type MetricProducer,
  type PushMetricExporter,
  type ResourceMetrics,
} from '@opentelemetry/sdk-metrics';
import type { ReadableSpan, Span, SpanExporter, SpanProcessor } from '@opentelemetry/sdk-trace-base';

import { ATTR_APP_INSTANCE_ID, DEFAULT_INSTANCE_ID } from './instance-id';

let enabled = false;
let instanceId = DEFAULT_INSTANCE_ID;

/**
 * The shape of {@link telemetryGate}.
 *
 * @stability stable
 */
export interface TelemetryGate {
  /** Whether exporting is allowed right now. Read at export time, per batch. */
  isEnabled(): boolean;
  /** Opens (`true`) or closes (`false`) the gate; applies to the next batch exported. */
  setEnabled(next: boolean): void;
  /** The instance identifier stamped on everything the gate lets through. */
  instanceId(): string;
  /** Replaces the instance identifier. Callers pass an already-resolved value (`resolveTelemetryInstanceId`). */
  setInstanceId(next: string): void;
}

/**
 * Process-wide runtime export switch (starts closed, `false`) and the instance
 * identifier stamped on everything it lets through (starts at
 * `DEFAULT_INSTANCE_ID` until `initializeOtel({ instanceId })` or the app's
 * settings set it).
 *
 * @example
 * ```ts
 * telemetryGate.setInstanceId(resolveTelemetryInstanceId(settings.instanceId, APP_SLUG));
 * telemetryGate.setEnabled(settings.enabled);
 * ```
 *
 * @extensionPoint hook
 * @stability stable
 */
export const telemetryGate: TelemetryGate = {
  isEnabled(): boolean {
    return enabled;
  },
  setEnabled(next: boolean): void {
    enabled = next;
  },
  instanceId(): string {
    return instanceId;
  },
  setInstanceId(next: string): void {
    instanceId = next;
  },
};

/** Per source resource: the merged copy last built, and for which id. */
const stamped = new WeakMap<Resource, { id: string; merged: Resource }>();

/**
 * `resource` with `app.instance.id` set to the current instance id: the SAME
 * object for every call with the same source and id (see the file header: the
 * OTLP transformer groups by resource identity).
 *
 * @param resource - The SDK resource a span, log record or metric batch carries.
 * @returns The merged resource, cached per (source, id).
 *
 * @stability experimental
 */
export function stampResource(resource: Resource): Resource {
  const id = instanceId;
  const hit = stamped.get(resource);

  if (hit && hit.id === id && !(hit.merged.asyncAttributesPending && !resource.asyncAttributesPending)) {
    return hit.merged;
  }

  const merged = resource.merge(resourceFromAttributes({ [ATTR_APP_INSTANCE_ID]: id }));
  stamped.set(resource, { id, merged });

  return merged;
}

/**
 * `record` presented with a stamped `resource`, without copying or mutating
 * it: an object whose prototype IS the record, so getters and methods still
 * work (see the header).
 */
function withStampedResource<T extends { resource: Resource }>(record: T): T {
  return Object.create(record, {
    resource: { value: stampResource(record.resource), enumerable: true },
  }) as T;
}

const DROPPED: ExportResult = { code: ExportResultCode.SUCCESS };

/**
 * Forwards spans to `inner`, stamped with the instance id, only while the
 * telemetry gate is open. A closed gate acknowledges each batch as SUCCESS.
 *
 * @stability stable
 */
export class GatedSpanExporter implements SpanExporter {
  constructor(private readonly inner: SpanExporter) {}

  /** Drops the batch (SUCCESS) while the gate is closed; otherwise stamps and delegates. */
  export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
    if (!telemetryGate.isEnabled()) {
      resultCallback(DROPPED);
      return;
    }
    this.inner.export(spans.map(withStampedResource), resultCallback);
  }

  /** Always delegates, whatever the gate says: a shutdown must flush even when export is off. */
  shutdown(): Promise<void> {
    return this.inner.shutdown();
  }

  /** Always delegates, whatever the gate says. */
  forceFlush(): Promise<void> {
    return this.inner.forceFlush ? this.inner.forceFlush() : Promise.resolve();
  }
}

/**
 * Forwards log records to `inner`, stamped with the instance id, only while
 * the telemetry gate is open. A closed gate acknowledges each batch as SUCCESS.
 *
 * @stability stable
 */
export class GatedLogRecordExporter implements LogRecordExporter {
  constructor(private readonly inner: LogRecordExporter) {}

  /** Drops the batch (SUCCESS) while the gate is closed; otherwise stamps and delegates. */
  export(logs: ReadableLogRecord[], resultCallback: (result: ExportResult) => void): void {
    if (!telemetryGate.isEnabled()) {
      resultCallback(DROPPED);
      return;
    }
    this.inner.export(logs.map(withStampedResource), resultCallback);
  }

  /** Always delegates, whatever the gate says: a shutdown must flush even when export is off. */
  shutdown(): Promise<void> {
    return this.inner.shutdown();
  }

  /** Always delegates, whatever the gate says. */
  forceFlush(): Promise<void> {
    return this.inner.forceFlush();
  }
}

/**
 * Forwards metrics to `inner`, stamped with the instance id, only while the
 * telemetry gate is open.
 *
 * The optional aggregation selector is delegated so the reader keeps the inner
 * exporter's aggregation preferences, and so is its temporality (OTLP defaults
 * to cumulative) for every instrument EXCEPT gauges: wrapping must not change
 * what is measured, only whether it is sent.
 *
 * ⚠ GAUGES ARE SELECTED DELTA, AND THIS IS NOT A CHANGE TO THE DATA. An OTLP
 * gauge carries no temporality on the wire; the choice only decides what the
 * SDK keeps between collections. Under cumulative, `@opentelemetry/sdk-metrics`
 * (2.x, verified) re-exports EVERY attribute set a gauge callback ever
 * observed, at its last value, on every later collection — so a worker node
 * that went offline, or a job type whose backlog drained, would keep reporting
 * its final reading with a fresh timestamp for the life of the process. Under
 * delta, a collection exports exactly what the callback observed this time.
 * The `app.nodes.*` per-node gauges (#606) depend on it: a node dropping out of
 * the exported set must disappear from the store, not freeze.
 *
 * @stability stable
 */
export class GatedPushMetricExporter implements PushMetricExporter {
  /** Delta for gauges, the inner exporter's choice (default cumulative) for everything else. */
  readonly selectAggregationTemporality: (instrumentType: InstrumentType) => AggregationTemporality;
  /** The inner exporter's aggregation selector, when it has one. */
  readonly selectAggregation?: (instrumentType: InstrumentType) => AggregationOption;

  constructor(private readonly inner: PushMetricExporter) {
    const innerTemporality = inner.selectAggregationTemporality?.bind(inner);
    this.selectAggregationTemporality = (instrumentType) =>
      instrumentType === InstrumentType.OBSERVABLE_GAUGE || instrumentType === InstrumentType.GAUGE
        ? AggregationTemporality.DELTA
        : (innerTemporality?.(instrumentType) ?? AggregationTemporality.CUMULATIVE);
    if (inner.selectAggregation) {
      this.selectAggregation = inner.selectAggregation.bind(inner);
    }
  }

  /** Drops the batch (SUCCESS) while the gate is closed; otherwise stamps and delegates. */
  export(metrics: ResourceMetrics, resultCallback: (result: ExportResult) => void): void {
    if (!telemetryGate.isEnabled()) {
      resultCallback(DROPPED);
      return;
    }
    this.inner.export({ ...metrics, resource: stampResource(metrics.resource) }, resultCallback);
  }

  /** Always delegates, whatever the gate says: a shutdown must flush even when export is off. */
  shutdown(): Promise<void> {
    return this.inner.shutdown();
  }

  /** Always delegates, whatever the gate says. */
  forceFlush(): Promise<void> {
    return this.inner.forceFlush();
  }
}

/**
 * Wraps a span processor so it sees spans only while the telemetry gate is open:
 * `onStart` and `onEnd` are forwarded when the gate is open and dropped when it
 * is closed. `forceFlush` and `shutdown` always delegate (a flush sends what was
 * accepted while the gate was open). For the strictest guarantee, build the
 * processor over a {@link GatedSpanExporter}, which checks at export time.
 *
 * `initializeOtel({ spanProcessors })` wraps every processor it is given with
 * this; use it yourself only when you register a processor another way.
 *
 * @example
 * ```ts
 * new GatedSpanProcessor(new SimpleSpanProcessor(new ConsoleSpanExporter()));
 * ```
 *
 * @extensionPoint hook
 * @stability experimental
 */
export class GatedSpanProcessor implements SpanProcessor {
  constructor(private readonly inner: SpanProcessor) {}

  /** Forwards the span start only while the gate is open. */
  onStart(span: Span, parentContext: Context): void {
    if (telemetryGate.isEnabled()) this.inner.onStart(span, parentContext);
  }

  /** Forwards the span's ending only while the gate is open. */
  onEnding(span: Span): void {
    if (telemetryGate.isEnabled()) this.inner.onEnding?.(span);
  }

  /** Forwards the finished span only while the gate is open. */
  onEnd(span: ReadableSpan): void {
    if (telemetryGate.isEnabled()) this.inner.onEnd(span);
  }

  /** Always delegates, whatever the gate says. */
  forceFlush(): Promise<void> {
    return this.inner.forceFlush();
  }

  /** Always delegates, whatever the gate says: a shutdown must flush even when export is off. */
  shutdown(): Promise<void> {
    return this.inner.shutdown();
  }
}

/**
 * Wraps a log record processor so it sees records only while the telemetry gate
 * is open (`onEmit` forwards while open, drops while closed). `forceFlush` and
 * `shutdown` always delegate. For the strictest guarantee, build the processor
 * over a {@link GatedLogRecordExporter}.
 *
 * @extensionPoint hook
 * @stability experimental
 */
export class GatedLogRecordProcessor implements LogRecordProcessor {
  constructor(private readonly inner: LogRecordProcessor) {}

  /** Forwards the record only while the gate is open. */
  onEmit(logRecord: SdkLogRecord, context?: Context): void {
    if (telemetryGate.isEnabled()) this.inner.onEmit(logRecord, context);
  }

  /** Always delegates, whatever the gate says. */
  forceFlush(): Promise<void> {
    return this.inner.forceFlush();
  }

  /** Always delegates, whatever the gate says. */
  shutdown(): Promise<void> {
    return this.inner.shutdown();
  }
}

/** What a gated producer answers while the gate is closed: nothing collected, no error. */
function emptyCollection(): CollectionResult {
  return { resourceMetrics: { resource: resourceFromAttributes({}), scopeMetrics: [] }, errors: [] };
}

/**
 * The metric producer a {@link GatedMetricReader} gives its inner reader: the
 * SDK's own producer while the gate is open (its batches stamped with the
 * instance id), an empty collection while it is closed.
 */
class GatedMetricProducer implements MetricProducer {
  constructor(private readonly inner: MetricProducer) {}

  async collect(options?: MetricCollectOptions): Promise<CollectionResult> {
    if (!telemetryGate.isEnabled()) return emptyCollection();
    const result = await this.inner.collect(options);
    // The gate may have closed while the SDK was collecting: nothing leaves then.
    if (!telemetryGate.isEnabled()) return emptyCollection();
    return { ...result, resourceMetrics: { ...result.resourceMetrics, resource: stampResource(result.resourceMetrics.resource) } };
  }
}

/**
 * Wraps a metric reader so it reads nothing while the telemetry gate is closed.
 * The inner reader (a periodic exporting reader, a Prometheus pull reader, your
 * own) is handed a producer that answers an empty collection while the gate is
 * closed, so there is nothing for it to push or to serve; open, its batches
 * carry `app.instance.id`. The inner reader keeps its own aggregation,
 * temporality and cardinality choices.
 *
 * ⚠ A push reader's gauges keep the temporality the inner exporter chose
 * (cumulative by default); build it over a {@link GatedPushMetricExporter} to get
 * the delta gauges the platform's own metrics use (see that class).
 *
 * `initializeOtel({ metricReaders })` wraps every reader it is given with this.
 *
 * @example
 * ```ts
 * new GatedMetricReader(new PeriodicExportingMetricReader({ exporter: new ConsoleMetricExporter(), exportIntervalMillis: 10_000 }));
 * ```
 *
 * @extensionPoint hook
 * @stability experimental
 */
export class GatedMetricReader extends MetricReader {
  constructor(private readonly inner: MetricReader) {
    super({
      aggregationSelector: (instrumentType) => inner.selectAggregation(instrumentType),
      aggregationTemporalitySelector: (instrumentType) => inner.selectAggregationTemporality(instrumentType),
      cardinalitySelector: (instrumentType) => inner.selectCardinalityLimit(instrumentType),
    });
  }

  /** Hands the inner reader the gated producer instead of the SDK's own. */
  override setMetricProducer(metricProducer: MetricProducer): void {
    super.setMetricProducer(metricProducer);
    this.inner.setMetricProducer(new GatedMetricProducer(metricProducer));
  }

  /** Collects through the inner reader, hence through the gated producer. */
  override collect(options?: Parameters<MetricReader['collect']>[0]): ReturnType<MetricReader['collect']> {
    return this.inner.collect(options);
  }

  /** Shuts the inner reader down (always, whatever the gate says). */
  protected async onShutdown(): Promise<void> {
    await this.inner.shutdown();
  }

  /** Flushes the inner reader (always; what it flushes was collected while the gate was open). */
  protected async onForceFlush(): Promise<void> {
    await this.inner.forceFlush();
  }
}
