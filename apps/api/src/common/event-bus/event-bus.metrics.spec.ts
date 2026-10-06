import { Logger } from '@nestjs/common';
import { MeterProvider, MetricReader, type MetricData } from '@opentelemetry/sdk-metrics';

import type { PrismaService } from '../../prisma/prisma.service';
import { APP_METRIC_NAMES, appMetricRegistry, AppMetricsService } from '../otel/app-metrics.service';
import { EVENT_BUS_APP_METRICS, eventBusMetricsVia } from './event-bus.metrics';
import { createEventBus } from './event-bus.module';

// =============================================================================
// Event bus metrics through the app-metric registry (issue #680)
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

function points(all: MetricData[], name: string) {
  return (all.find((m) => m.descriptor.name === name)?.dataPoints ?? []).map((dp) => ({
    attributes: { ...dp.attributes },
    value: dp.value,
  }));
}

describe('event bus metrics (#680)', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('declares the three counters in the app-metric registry', () => {
    for (const def of EVENT_BUS_APP_METRICS) expect(appMetricRegistry.get(def.key)).toBe(def);
    expect(APP_METRIC_NAMES).toMatchObject({
      eventBusPublished: 'app.event_bus.published',
      eventBusDelivered: 'app.event_bus.delivered',
      eventBusReconnects: 'app.event_bus.reconnects',
    });
  });

  it('createEventBus wires the bus to AppMetricsService.add, with bounded labels', async () => {
    const reader = new TestReader();
    const metrics = new AppMetricsService(undefined, undefined, {
      meter: new MeterProvider({ readers: [reader] }).getMeter('app'),
    });
    const bus = createEventBus(
      { adapter: 'in-process', recognised: true, configured: 'in-process' },
      {} as unknown as PrismaService,
      metrics,
    );

    await bus.publish('notifications.stream', { userId: 'u-1' });
    await bus.publish('notifications.stream', { userId: 'u-2' });
    await bus.publish('Bad Channel!', {});

    const all = await collect(reader);
    expect(points(all, 'app.event_bus.published')).toEqual(
      expect.arrayContaining([
        { attributes: { adapter: 'in-process', channel: 'notifications.stream', outcome: 'published' }, value: 2 },
        // Not identifier-shaped: the channel label is folded into `other`.
        { attributes: { adapter: 'in-process', channel: 'other', outcome: 'rejected' }, value: 1 },
      ]),
    );
    expect(points(all, 'app.event_bus.delivered')).toEqual([
      { attributes: { adapter: 'in-process', channel: 'notifications.stream', origin: 'local' }, value: 2 },
    ]);
    // The payload never becomes a label.
    expect(JSON.stringify(all.flatMap((m) => m.dataPoints.map((dp) => dp.attributes)))).not.toContain('u-1');
  });

  it('a throwing metrics backend never reaches the publisher', async () => {
    const sink = eventBusMetricsVia(() => {
      throw new Error('boom');
    }, 'postgres');
    expect(() => sink.published('a.b', 'published')).not.toThrow();
    expect(() => sink.delivered('a.b', 'remote')).not.toThrow();
    expect(() => sink.reconnect()).not.toThrow();
  });
});
