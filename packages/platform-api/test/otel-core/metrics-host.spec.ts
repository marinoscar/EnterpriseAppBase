import { Injectable, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { metrics } from '@opentelemetry/api';
import { DataPointType, MeterProvider, MetricReader, type MetricData } from '@opentelemetry/sdk-metrics';

import { withTemporaryEntries } from '../../src/core/index';
import {
  APP_METER_NAME,
  appMetricRegistry,
  createRegisteredGauge,
  MAX_DISTINCT_VALUES,
  METRICS_HOST_OPTIONS,
  MetricsHostService,
  OTHER_LABEL,
  OtelMetricsModule,
  shapeLabel,
  telemetryGate,
  UNKNOWN_LABEL,
  type AppMetricDef,
  type MetricsHostOptions,
} from '../../src/otel-core/index';

// =============================================================================
// MetricsHostService: the generic half of the reference app's AppMetricsService
// (issue #600, #680; split out by issue #700)
// =============================================================================
//
// Proven against a REAL in-memory SDK MeterProvider, collected on demand: the
// names, units, buckets and attribute sets asserted here are exactly what the
// OTLP exporter would send. The domain recorders and the database gauges stay
// in the app (apps/api/src/common/otel/app-metrics.service.spec.ts).
// =============================================================================

class TestReader extends MetricReader {
  protected async onForceFlush(): Promise<void> {}
  protected async onShutdown(): Promise<void> {}
}

async function collect(reader: TestReader): Promise<MetricData[]> {
  const { resourceMetrics, errors } = await reader.collect();
  expect(errors).toEqual([]);
  return resourceMetrics.scopeMetrics.flatMap((scope) => scope.metrics);
}

function metric(all: MetricData[], name: string): MetricData {
  const found = all.find((m) => m.descriptor.name === name);
  if (!found) throw new Error(`metric ${name} not collected; got ${all.map((m) => m.descriptor.name).join(', ')}`);
  return found;
}

function points(all: MetricData[], name: string): Array<{ attributes: Record<string, unknown>; value: unknown }> {
  return metric(all, name).dataPoints.map((dp) => ({ attributes: { ...dp.attributes }, value: dp.value }));
}

interface CreatedInstrument {
  kind: 'counter' | 'histogram' | 'gauge';
  name: string;
  options: unknown;
}

/** A meter that records every create call verbatim and delegates to a real SDK meter. */
function recordingMeter(): { meter: MetricsHostOptions['meter']; created: CreatedInstrument[] } {
  const inner = new MeterProvider({ readers: [new TestReader()] }).getMeter('app');
  const created: CreatedInstrument[] = [];
  const meter = {
    createCounter: (name: string, options?: unknown) => {
      created.push({ kind: 'counter', name, options });
      return inner.createCounter(name, options as never);
    },
    createHistogram: (name: string, options?: unknown) => {
      created.push({ kind: 'histogram', name, options });
      return inner.createHistogram(name, options as never);
    },
    createObservableGauge: (name: string, options?: unknown) => {
      created.push({ kind: 'gauge', name, options });
      return inner.createObservableGauge(name, options as never);
    },
  };
  return { meter: meter as unknown as MetricsHostOptions['meter'], created };
}

const APP_COUNTER: AppMetricDef = {
  key: 'testWidgetsMade',
  name: 'app.test.widgets.made',
  kind: 'counter',
  unit: '{widget}',
  description: 'Test widgets made, by kind and outcome.',
  attributes: { widget_kind: { kind: 'free' }, outcome: { kind: 'enum', values: ['ok', 'failed'] } },
};

const APP_HISTOGRAM: AppMetricDef = {
  key: 'testWidgetLatency',
  name: 'app.test.widgets.latency',
  kind: 'histogram',
  unit: 's',
  description: 'Time to make one test widget.',
  buckets: [0.1, 1, 10],
  attributes: { outcome: { kind: 'enum', values: ['ok', 'failed'] } },
};

const APP_GAUGE: AppMetricDef = {
  key: 'testWidgetBacklog',
  name: 'app.test.widgets.backlog',
  kind: 'gauge',
  unit: '{widget}',
  description: 'Test widgets waiting.',
};

function setup(options: Partial<MetricsHostOptions> = {}) {
  const reader = new TestReader();
  const provider = new MeterProvider({ readers: [reader] });
  const host = new MetricsHostService({ meter: provider.getMeter(APP_METER_NAME), now: () => 1_000, gateOpen: () => true, ...options });
  return { host, reader };
}

/** Registers the metrics, THEN constructs the host (it reads the registry at construction). */
async function withMetrics(fn: (t: ReturnType<typeof setup>) => Promise<void> | void): Promise<void> {
  await withTemporaryEntries(appMetricRegistry, [APP_COUNTER, APP_HISTOGRAM, APP_GAUGE], async () => fn(setup()));
}

describe('MetricsHostService', () => {
  describe('instruments from the registry', () => {
    it('creates every registered counter and histogram with its declared name, unit, description and buckets', async () => {
      await withTemporaryEntries(appMetricRegistry, [APP_COUNTER, APP_HISTOGRAM, APP_GAUGE], async () => {
        const { meter, created } = recordingMeter();
        new MetricsHostService({ meter });

        expect(created).toEqual([
          {
            kind: 'counter',
            name: 'app.test.widgets.made',
            options: { description: 'Test widgets made, by kind and outcome.', unit: '{widget}' },
          },
          {
            kind: 'histogram',
            name: 'app.test.widgets.latency',
            options: { description: 'Time to make one test widget.', unit: 's', advice: { explicitBucketBoundaries: [0.1, 1, 10] } },
          },
        ]);
      });
    });

    it('creates a metric registered after construction on first use', async () => {
      const { meter, created } = recordingMeter();
      const host = new MetricsHostService({ meter });
      await withTemporaryEntries(appMetricRegistry, [APP_COUNTER], async () => {
        expect(created).toEqual([]);
        host.add('testWidgetsMade');
        expect(created.map((c) => c.name)).toEqual(['app.test.widgets.made']);
        expect(host.counter('testWidgetsMade')).toBe(host.counter('testWidgetsMade'));
      });
    });

    it('counter() and histogram() refuse an unknown key or the wrong kind', async () => {
      await withMetrics(({ host }) => {
        expect(() => host.counter('noSuchMetric')).toThrow(/"noSuchMetric" is not registered/);
        expect(() => host.counter('testWidgetLatency')).toThrow(/is a histogram, not a counter/);
        expect(() => host.histogram('testWidgetsMade')).toThrow(/is a counter, not a histogram/);
        expect(() => host.histogram('testWidgetBacklog')).toThrow(/is a gauge, not a histogram/);
      });
    });
  });

  describe('generic add/record', () => {
    it('exports a counter through add() with bounded, declared attributes only', async () => {
      await withMetrics(async ({ host, reader }) => {
        host.add('testWidgetsMade', 2, { widget_kind: 'sprocket', outcome: 'ok', user_id: 'u-123' });
        host.add('testWidgetsMade', undefined, { widget_kind: 'sprocket', outcome: 'ok' });
        host.add('testWidgetsMade', 1, { widget_kind: 'someone@example.com', outcome: 'exploded' });
        host.add('testWidgetsMade');

        const all = await collect(reader);
        expect(metric(all, 'app.test.widgets.made').descriptor.unit).toBe('{widget}');
        expect(points(all, 'app.test.widgets.made')).toEqual(
          expect.arrayContaining([
            { attributes: { widget_kind: 'sprocket', outcome: 'ok' }, value: 3 },
            { attributes: { widget_kind: OTHER_LABEL, outcome: OTHER_LABEL }, value: 1 },
            { attributes: {}, value: 1 },
          ]),
        );
        expect(points(all, 'app.test.widgets.made')).toHaveLength(3);
      });
    });

    it('exports a histogram through record() with its declared buckets', async () => {
      await withMetrics(async ({ host, reader }) => {
        host.record('testWidgetLatency', 0.5, { outcome: 'ok', widget_kind: 'dropped' });
        host.record('testWidgetLatency', 20, { outcome: 'failed' });

        const all = await collect(reader);
        const data = metric(all, 'app.test.widgets.latency');
        expect(data.dataPointType).toBe(DataPointType.HISTOGRAM);
        expect(data.descriptor).toEqual(
          expect.objectContaining({ name: 'app.test.widgets.latency', unit: 's', description: 'Time to make one test widget.' }),
        );
        const byOutcome = Object.fromEntries(
          data.dataPoints.map((dp) => [dp.attributes.outcome, dp.value as { count: number; buckets: { boundaries: number[] } }]),
        );
        expect(Object.keys(byOutcome).sort()).toEqual(['failed', 'ok']);
        expect(byOutcome.ok?.buckets.boundaries).toEqual([0.1, 1, 10]);
        expect(data.dataPoints.every((dp) => !('widget_kind' in dp.attributes))).toBe(true);
      });
    });

    it('a free attribute shares the per-key distinct-value budget with boundLabel', async () => {
      await withMetrics(async ({ host, reader }) => {
        for (let i = 0; i < MAX_DISTINCT_VALUES + 5; i += 1) {
          host.add('testWidgetsMade', 1, { widget_kind: `kind-${i}`, outcome: 'ok' });
        }
        expect(host.boundLabel('widget_kind', 'one-more')).toBe(OTHER_LABEL);
        const all = await collect(reader);
        const kinds = new Set(points(all, 'app.test.widgets.made').map((p) => p.attributes.widget_kind));
        expect(kinds.size).toBe(MAX_DISTINCT_VALUES + 1);
      });
    });

    it('ignores an unknown key, a kind mismatch and an invalid value, logging each unknown key once', async () => {
      await withMetrics(async ({ host, reader }) => {
        const debug = jest.spyOn((host as unknown as { logger: { debug: (m: string) => void } }).logger, 'debug');

        expect(() => host.add('noSuchMetric')).not.toThrow();
        expect(() => host.add('noSuchMetric', 5)).not.toThrow();
        expect(() => host.record('testWidgetsMade', 1)).not.toThrow();
        expect(() => host.add('testWidgetLatency')).not.toThrow();
        expect(() => host.add('testWidgetBacklog')).not.toThrow();
        expect(() => host.add('testWidgetsMade', -1)).not.toThrow();
        expect(() => host.add('testWidgetsMade', Number.NaN)).not.toThrow();
        expect(() => host.record('testWidgetLatency', Number.POSITIVE_INFINITY)).not.toThrow();
        expect(() => host.add('testWidgetsMade', 1, 'not-an-object' as never)).not.toThrow();

        expect(debug.mock.calls.filter(([m]) => String(m).includes('"noSuchMetric"'))).toHaveLength(1);
        expect(debug.mock.calls.some(([m]) => String(m).includes('"testWidgetBacklog" is a gauge'))).toBe(true);

        const all = await collect(reader);
        expect(points(all, 'app.test.widgets.made')).toEqual([{ attributes: {}, value: 1 }]);
      });
    });

    it('never throws when the instrument does', async () => {
      await withTemporaryEntries(appMetricRegistry, [APP_COUNTER, APP_HISTOGRAM], async () => {
        const throwing = {
          createCounter: () => ({ add: () => { throw new Error('boom'); } }),
          createHistogram: () => ({ record: () => { throw new Error('boom'); } }),
        } as unknown as MetricsHostOptions['meter'];
        const host = new MetricsHostService({ meter: throwing });
        expect(() => host.add('testWidgetsMade', 1, { outcome: 'ok' })).not.toThrow();
        expect(() => host.record('testWidgetLatency', 1)).not.toThrow();
      });
    });
  });

  describe('OTEL_ENABLED unset: the API no-op meter', () => {
    const saved = process.env.OTEL_ENABLED;
    afterEach(() => {
      if (saved === undefined) delete process.env.OTEL_ENABLED;
      else process.env.OTEL_ENABLED = saved;
    });

    it('records without throwing on the global (no-op) meter, and reports gauges off', async () => {
      delete process.env.OTEL_ENABLED;
      await withTemporaryEntries(appMetricRegistry, [APP_COUNTER, APP_HISTOGRAM, APP_GAUGE], async () => {
        const host = new MetricsHostService();
        expect(host.meter).toBe(metrics.getMeter(APP_METER_NAME));
        expect(() => host.add('testWidgetsMade', 1, { outcome: 'ok' })).not.toThrow();
        expect(() => host.record('testWidgetLatency', 1)).not.toThrow();
        expect(() => host.counter('testWidgetsMade').add(1)).not.toThrow();
        expect(host.gaugesEnabled()).toBe(false);
        expect(host.gaugeContext()).toBeNull();
        const provider = jest.fn();
        expect(host.registerGaugeProvider(provider)).toBe(false);
        expect(provider).not.toHaveBeenCalled();
      });
    });

    it('turns gauges on with OTEL_ENABLED=true, read per call; the option wins either way', () => {
      const host = new MetricsHostService();
      process.env.OTEL_ENABLED = 'true';
      expect(host.gaugesEnabled()).toBe(true);
      expect(new MetricsHostService({ gauges: false }).gaugesEnabled()).toBe(false);
      delete process.env.OTEL_ENABLED;
      expect(new MetricsHostService({ gauges: true }).gaugesEnabled()).toBe(true);
    });

    it('defaults the gate to the telemetry gate and the clock to Date.now', () => {
      const host = new MetricsHostService();
      telemetryGate.setEnabled(true);
      expect(host.gateOpen()).toBe(true);
      telemetryGate.setEnabled(false);
      expect(host.gateOpen()).toBe(false);
      expect(Math.abs(host.now() - Date.now())).toBeLessThan(1_000);
    });
  });

  describe('label bounding', () => {
    it('maps empty, non-identifier and over-long strings to unknown/other', () => {
      const { host } = setup();

      expect(host.boundLabel('k', '')).toBe(UNKNOWN_LABEL);
      expect(host.boundLabel('k', undefined)).toBe(UNKNOWN_LABEL);
      expect(host.boundLabel('k', 'user@example.com')).toBe(OTHER_LABEL);
      expect(host.boundLabel('k', 'model-name@20250101')).toBe('model-name@20250101');
      expect(host.boundLabel('k', 'has spaces in it')).toBe(OTHER_LABEL);
      expect(host.boundLabel('k', 'https://x.test/a?b=c')).toBe(OTHER_LABEL);
      expect(host.boundLabel('k', 'a'.repeat(65))).toBe(OTHER_LABEL);
      expect(host.boundLabel('k', '  db.backup.run  ')).toBe('db.backup.run');
    });

    it('admits at most MAX_DISTINCT_VALUES distinct values per key, then folds into other', () => {
      const { host } = setup();

      for (let i = 0; i < MAX_DISTINCT_VALUES; i += 1) {
        expect(host.boundLabel('job_type', `type.${i}`)).toBe(`type.${i}`);
      }
      expect(host.boundLabel('job_type', 'one.too.many')).toBe(OTHER_LABEL);
      expect(host.boundLabel('job_type', 'type.0')).toBe('type.0');
      expect(host.boundLabel('ai_model', 'one.too.many')).toBe('one.too.many');
    });

    it('shapeLabel is the budget-free shape check', () => {
      expect(shapeLabel(42)).toBe(UNKNOWN_LABEL);
      expect(shapeLabel('  ')).toBe(UNKNOWN_LABEL);
      expect(shapeLabel('a.b@c.d')).toBe(OTHER_LABEL);
      expect(shapeLabel('node-1')).toBe('node-1');
    });
  });

  describe('gauge providers', () => {
    it('runs a provider once with the meter, clock and gate when gauges are on', async () => {
      await withMetrics(() => {
        const { meter, created } = recordingMeter();
        const gateOpen = () => false;
        const host = new MetricsHostService({ meter, now: () => 7, gateOpen, gauges: true });

        const seen: unknown[] = [];
        const ran = host.registerGaugeProvider((context) => {
          seen.push(context);
          createRegisteredGauge(context.meter, 'testWidgetBacklog');
        });

        expect(ran).toBe(true);
        expect(seen).toEqual([{ meter, now: expect.any(Function), gateOpen }]);
        expect(host.gaugeContext()?.now()).toBe(7);
        expect(created.filter((c) => c.kind === 'gauge')).toEqual([
          { kind: 'gauge', name: 'app.test.widgets.backlog', options: { description: 'Test widgets waiting.', unit: '{widget}' } },
        ]);
      });
    });

    it('reports a throwing provider as not registered, never throwing itself', () => {
      const host = new MetricsHostService({ gauges: true });
      expect(
        host.registerGaugeProvider(() => {
          throw new Error('boom');
        }),
      ).toBe(false);
    });

    it('createRegisteredGauge refuses a non-gauge or an unknown key', async () => {
      await withMetrics(() => {
        const { meter } = recordingMeter();
        expect(() => createRegisteredGauge(meter as never, 'testWidgetsMade')).toThrow(/not a gauge/);
        expect(() => createRegisteredGauge(meter as never, 'nope')).toThrow(/Unknown id "nope"/);
      });
    });
  });
});

describe('OtelMetricsModule', () => {
  @Injectable()
  class Consumer {
    constructor(readonly host: MetricsHostService) {}
  }

  it('provides one global MetricsHostService (bare import: every default)', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [OtelMetricsModule], providers: [Consumer] }).compile();
    const host = moduleRef.get(MetricsHostService);
    expect(moduleRef.get(Consumer).host).toBe(host);
    expect(host.meter).toBe(metrics.getMeter(APP_METER_NAME));
  });

  it('forRoot passes fixed options under METRICS_HOST_OPTIONS', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [OtelMetricsModule.forRoot({ gauges: true, now: () => 42 })],
      providers: [Consumer],
    }).compile();
    const host = moduleRef.get(Consumer).host;
    expect(host.gaugesEnabled()).toBe(true);
    expect(host.now()).toBe(42);
    expect(moduleRef.get(METRICS_HOST_OPTIONS)).toEqual({ gauges: true, now: expect.any(Function) });
  });

  it('forRootAsync builds the options with injected dependencies', async () => {
    const CONFIG = Symbol('CONFIG');
    const moduleRef = await Test.createTestingModule({
      imports: [
        OtelMetricsModule.forRootAsync({
          inject: [CONFIG],
          useFactory: (config: { otel: boolean }) => ({ gauges: config.otel }),
        }),
      ],
      providers: [Consumer, { provide: CONFIG, useValue: { otel: true } }],
    })
      .compile()
      .catch(() => null);
    // A factory dependency must be visible to the module: provide it through `imports`.
    expect(moduleRef).toBeNull();

    @Module({ providers: [{ provide: CONFIG, useValue: { otel: true } }], exports: [CONFIG] })
    class ConfigLikeModule {}

    const ok = await Test.createTestingModule({
      imports: [
        OtelMetricsModule.forRootAsync({
          imports: [ConfigLikeModule],
          inject: [CONFIG],
          useFactory: (config: { otel: boolean }) => ({ gauges: config.otel }),
        }),
      ],
      providers: [Consumer],
    }).compile();
    expect(ok.get(Consumer).host.gaugesEnabled()).toBe(true);
  });
});
