import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { MeterProvider, MetricReader, type MetricData } from '@opentelemetry/sdk-metrics';
import { withTemporaryEntries } from '@marinoscar/platform-api/core';
import {
  METRICS_HOST_OPTIONS,
  MetricsHostService,
  OtelMetricsModule,
  appMetricRegistry,
  createRegisteredGauge,
  type AppMetricDef,
  type MetricsHostOptions,
} from '@marinoscar/platform-api/otel-core';

// The app's manifest: the platform's metrics, the slices', then APP_METRICS.
import '../../src/common/otel/app-metric.manifest';

// =============================================================================
// Worked example: the metrics host's extension points, from app code (#700, #867)
// =============================================================================
//
// The reference app's own metrics wiring is the host slice's since #867
// (`PlatformHostCoreModule.forRoot()` imports `OtelMetricsModule` and builds
// the platform's `AppMetricsService` on it). An app that adds a metric of its
// own, or wires the metrics host itself, uses the four seams below, exactly as
// this spec does:
//
//   - `appMetricRegistry`, read back after the manifest (a name table);
//   - `OtelMetricsModule.forRootAsync`, the host's options from the app's config;
//   - `METRICS_HOST_OPTIONS`, an explicit meter, clock and gate (a test seam);
//   - `MetricsHostService.registerGaugeProvider`, a gauge whose callback reads
//     the app's own data, declared first in the registry.
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

/** An app-owned gauge, declared like any `APP_METRICS` entry. */
const EXAMPLE_BACKLOG: AppMetricDef = {
  key: 'exampleBacklog',
  name: 'app.example.backlog',
  kind: 'gauge',
  unit: '{item}',
  description: 'Example items waiting, observed from the app\'s own data.',
};

describe('the metrics host, extended from app code', () => {
  it('appMetricRegistry: the declared metrics, read back as a name table', () => {
    const names = Object.fromEntries(appMetricRegistry.list().map((def) => [def.key, def.name]));

    // The platform's first (the host slice's), then the event bus's.
    expect(appMetricRegistry.ids()[0]).toBe('jobsEnqueued');
    expect(names).toMatchObject({ jobsEnqueued: 'app.jobs.enqueued', eventBusPublished: 'app.event_bus.published' });
  });

  it('OtelMetricsModule.forRootAsync + METRICS_HOST_OPTIONS + registerGaugeProvider: an app gauge, collected', async () => {
    const reader = new TestReader();
    const meter = new MeterProvider({ readers: [reader] }).getMeter('app');

    await withTemporaryEntries(appMetricRegistry, [EXAMPLE_BACKLOG], async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [
          ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [() => ({ otel: { enabled: true } })] }),
          // The host's options from the app's configuration; the meter and the
          // gate are the test seam an app passes the same way.
          OtelMetricsModule.forRootAsync({
            inject: [ConfigService],
            useFactory: (config: ConfigService): MetricsHostOptions => ({
              gauges: config.get<boolean>('otel.enabled') === true,
              meter,
              gateOpen: () => true,
            }),
          }),
        ],
      }).compile();

      expect(moduleRef.get<MetricsHostOptions>(METRICS_HOST_OPTIONS)).toMatchObject({ gauges: true });

      const backlog = [3, 4];
      const registered = moduleRef.get(MetricsHostService).registerGaugeProvider(({ meter: appMeter, gateOpen }) => {
        const gauge = createRegisteredGauge(appMeter, EXAMPLE_BACKLOG.key);
        gauge.addCallback((result) => {
          if (!gateOpen()) return;
          result.observe(backlog.length);
        });
      });
      expect(registered).toBe(true);

      const metric = (await collect(reader)).find((m) => m.descriptor.name === 'app.example.backlog');
      expect(metric?.descriptor.unit).toBe('{item}');
      expect(metric?.dataPoints.map((point) => point.value)).toEqual([2]);
      await moduleRef.close();
    });
  });
});
