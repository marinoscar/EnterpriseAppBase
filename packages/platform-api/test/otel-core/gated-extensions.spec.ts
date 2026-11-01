import { ExportResultCode, type ExportResult } from '@opentelemetry/core';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  BatchLogRecordProcessor,
  InMemoryLogRecordExporter,
  LoggerProvider,
} from '@opentelemetry/sdk-logs';
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  InstrumentType,
  MeterProvider,
  MetricReader,
  PeriodicExportingMetricReader,
  type CollectionResult,
} from '@opentelemetry/sdk-metrics';
import { BasicTracerProvider, BatchSpanProcessor, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';

import { ATTR_APP_INSTANCE_ID } from '../../src/otel-core/sdk/instance-id';
import {
  GatedLogRecordProcessor,
  GatedMetricReader,
  GatedSpanExporter,
  GatedSpanProcessor,
  telemetryGate,
} from '../../src/otel-core/sdk/telemetry-gate';

// =============================================================================
// Extra outputs are behind the runtime gate (PP-14.18)
// =============================================================================
//
// `initializeOtel({ spanProcessors, logRecordProcessors, metricReaders })` lets
// an app add outputs next to the OTLP ones. The acceptance rule: NOTHING exports
// while the telemetry gate is closed. These cases drive real SDK providers with
// real in-memory exporters (which keep whatever they are handed) through the
// Gated* wrappers `initializeOtel` puts on every extra, and check the exporters
// stay empty while the gate is closed and fill when it opens.
// =============================================================================

const resetGate = () => {
  telemetryGate.setEnabled(false);
  telemetryGate.setInstanceId('my-app');
};

beforeEach(resetGate);
afterAll(resetGate);

describe('GatedSpanProcessor', () => {
  function setup() {
    const memory = new InMemorySpanExporter();
    const provider = new BasicTracerProvider({
      resource: resourceFromAttributes({ 'service.name': 'svc' }),
      spanProcessors: [new GatedSpanProcessor(new SimpleSpanProcessor(memory))],
    });
    return { memory, provider, tracer: provider.getTracer('test') };
  }

  it('exports nothing while the gate is closed, even with a processor that exports on end', async () => {
    const { memory, provider, tracer } = setup();
    expect(telemetryGate.isEnabled()).toBe(false);

    tracer.startSpan('while-closed').end();
    await provider.forceFlush();

    expect(memory.getFinishedSpans()).toEqual([]);
  });

  it('exports once the gate opens, and stops again when it closes', async () => {
    const { memory, provider, tracer } = setup();

    telemetryGate.setEnabled(true);
    tracer.startSpan('open-1').end();
    telemetryGate.setEnabled(false);
    tracer.startSpan('closed-again').end();
    telemetryGate.setEnabled(true);
    tracer.startSpan('open-2').end();
    await provider.forceFlush();

    expect(memory.getFinishedSpans().map((span) => span.name)).toEqual(['open-1', 'open-2']);
  });

  it('keeps the wrapped processor off onStart while closed (an enricher or a streaming exporter sees nothing)', () => {
    const inner = { onStart: jest.fn(), onEnd: jest.fn(), forceFlush: jest.fn().mockResolvedValue(undefined), shutdown: jest.fn().mockResolvedValue(undefined) };
    const tracer = new BasicTracerProvider({ spanProcessors: [new GatedSpanProcessor(inner)] }).getTracer('t');

    tracer.startSpan('x').end();
    expect(inner.onStart).not.toHaveBeenCalled();
    expect(inner.onEnd).not.toHaveBeenCalled();

    telemetryGate.setEnabled(true);
    tracer.startSpan('y').end();
    expect(inner.onStart).toHaveBeenCalledTimes(1);
    expect(inner.onEnd).toHaveBeenCalledTimes(1);
  });

  it('always delegates forceFlush and shutdown: a shutdown flushes even when export is off', async () => {
    const inner = { onStart: jest.fn(), onEnd: jest.fn(), forceFlush: jest.fn().mockResolvedValue(undefined), shutdown: jest.fn().mockResolvedValue(undefined) };
    const gated = new GatedSpanProcessor(inner);

    await gated.forceFlush();
    await gated.shutdown();

    expect(inner.forceFlush).toHaveBeenCalledTimes(1);
    expect(inner.shutdown).toHaveBeenCalledTimes(1);
  });
});

describe('GatedLogRecordProcessor', () => {
  function setup() {
    const memory = new InMemoryLogRecordExporter();
    const provider = new LoggerProvider({
      resource: resourceFromAttributes({ 'service.name': 'svc' }),
      processors: [new GatedLogRecordProcessor(new BatchLogRecordProcessor({ exporter: memory }))],
    });
    return { memory, provider, logger: provider.getLogger('test') };
  }

  it('exports nothing while the gate is closed, and the records after it opens', async () => {
    const { memory, provider, logger } = setup();

    logger.emit({ body: 'dropped' });
    await provider.forceFlush();
    expect(memory.getFinishedLogRecords()).toEqual([]);

    telemetryGate.setEnabled(true);
    logger.emit({ body: 'kept' });
    await provider.forceFlush();
    expect(memory.getFinishedLogRecords().map((record) => record.body)).toEqual(['kept']);
  });

  it('a batching inner processor receives nothing while closed, and shuts down with the provider', async () => {
    const memory = new InMemoryLogRecordExporter();
    const provider = new LoggerProvider({ processors: [new GatedLogRecordProcessor(new BatchLogRecordProcessor({ exporter: memory }))] });
    provider.getLogger('t').emit({ body: 'while closed' });
    await provider.forceFlush();
    expect(memory.getFinishedLogRecords()).toEqual([]);
    await provider.shutdown();
  });
});

describe('GatedMetricReader', () => {
  function setup() {
    const memory = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const reader = new GatedMetricReader(new PeriodicExportingMetricReader({ exporter: memory, exportIntervalMillis: 3_600_000 }));
    const provider = new MeterProvider({ resource: resourceFromAttributes({ 'service.name': 'svc' }), readers: [reader] });
    const counter = provider.getMeter('test').createCounter('requests');
    const points = () => memory.getMetrics().flatMap((batch) => batch.scopeMetrics.flatMap((scope) => scope.metrics));
    return { memory, provider, reader, counter, points };
  }

  it('exports no data point while the gate is closed', async () => {
    const { provider, counter, points } = setup();

    counter.add(5);
    await provider.forceFlush();

    expect(points()).toEqual([]);
  });

  it('exports once the gate opens, with the instance id stamped on the batch', async () => {
    const { memory, provider, counter, points } = setup();

    telemetryGate.setEnabled(true);
    telemetryGate.setInstanceId('prod-eu');
    counter.add(7);
    await provider.forceFlush();

    expect(points().map((metric) => metric.descriptor.name)).toEqual(['requests']);
    expect(memory.getMetrics()[0]!.resource.attributes[ATTR_APP_INSTANCE_ID]).toBe('prod-eu');
    expect(memory.getMetrics()[0]!.resource.attributes['service.name']).toBe('svc');
  });

  it('serves nothing to a PULL reader while closed: collect() answers an empty collection', async () => {
    class PullReader extends MetricReader {
      protected async onShutdown(): Promise<void> {}
      protected async onForceFlush(): Promise<void> {}
    }
    const pull = new PullReader();
    const provider = new MeterProvider({ readers: [new GatedMetricReader(pull)] });
    provider.getMeter('t').createCounter('scraped').add(3);

    const closed: CollectionResult = await pull.collect();
    expect(closed.resourceMetrics.scopeMetrics).toEqual([]);

    telemetryGate.setEnabled(true);
    const open: CollectionResult = await pull.collect();
    expect(open.resourceMetrics.scopeMetrics.flatMap((scope) => scope.metrics).map((metric) => metric.descriptor.name)).toEqual(['scraped']);
  });

  it('does not export a collection the gate closed on while it was being made', async () => {
    const memory = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const reader = new GatedMetricReader(new PeriodicExportingMetricReader({ exporter: memory, exportIntervalMillis: 3_600_000 }));
    const provider = new MeterProvider({ readers: [reader] });
    const meter = provider.getMeter('t');
    telemetryGate.setEnabled(true);
    // An observable callback runs during the collection: it closes the gate half-way.
    meter.createObservableGauge('depth').addCallback((result) => {
      result.observe(1);
      telemetryGate.setEnabled(false);
    });

    await provider.forceFlush();

    expect(memory.getMetrics().flatMap((batch) => batch.scopeMetrics)).toEqual([]);
  });

  it("keeps the inner reader's aggregation temporality, aggregation and cardinality choices", () => {
    const memory = new InMemoryMetricExporter(AggregationTemporality.DELTA);
    const inner = new PeriodicExportingMetricReader({ exporter: memory, exportIntervalMillis: 3_600_000 });
    const gated = new GatedMetricReader(inner);

    expect(gated.selectAggregationTemporality(InstrumentType.COUNTER)).toBe(AggregationTemporality.DELTA);
    expect(gated.selectAggregation(InstrumentType.COUNTER)).toEqual(inner.selectAggregation(InstrumentType.COUNTER));
    expect(gated.selectCardinalityLimit(InstrumentType.COUNTER)).toBe(inner.selectCardinalityLimit(InstrumentType.COUNTER));
  });

  it('shuts the inner reader down and flushes it, whatever the gate says', async () => {
    const memory = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const shutdown = jest.spyOn(memory, 'shutdown');
    const provider = new MeterProvider({
      readers: [new GatedMetricReader(new PeriodicExportingMetricReader({ exporter: memory, exportIntervalMillis: 3_600_000 }))],
    });

    await provider.shutdown();

    expect(shutdown).toHaveBeenCalledTimes(1);
  });
});

describe('the exporter-level guarantee beside the processors', () => {
  it('a batching processor over a gated exporter drops a span handed over while open if the gate closed before the export', async () => {
    const sent: unknown[] = [];
    const capture = {
      export: (spans: unknown[], cb: (r: ExportResult) => void) => {
        sent.push(...spans);
        cb({ code: ExportResultCode.SUCCESS });
      },
      shutdown: async () => undefined,
    };
    const provider = new BasicTracerProvider({
      // Not wrapped by GatedSpanProcessor on purpose: this is the exporter-level form.
      spanProcessors: [new BatchSpanProcessor(new GatedSpanExporter(capture as never))],
    });

    telemetryGate.setEnabled(true);
    provider.getTracer('t').startSpan('queued while open').end();
    telemetryGate.setEnabled(false);
    await provider.forceFlush();

    expect(sent).toEqual([]);
  });
});
