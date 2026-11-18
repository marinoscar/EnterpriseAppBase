import { MeterProvider, MetricReader } from '@opentelemetry/sdk-metrics';
import { NotFoundException } from '@nestjs/common';
import type { EventEmitter2 } from '@nestjs/event-emitter';

import { MetricsHostService, appMetricRegistry, registerAppMetrics } from '../../src/otel-core/index';
import { NODES_APP_METRICS } from '../../src/nodes/nodes.metrics';
import type { JobsPrisma } from '../../src/jobs/data/jobs-db';
import { NODE_EVENT_REPORTED, NodeEventReportedEvent } from '../../src/nodes/events/node-event.event';
import {
  NODE_EVENTS_PER_HOUR,
  NodeEventRateLimiter,
  NodeEventsService,
  clampOccurredAt,
} from '../../src/nodes/node-events.service';

// =============================================================================
// NodeEventsService (issue #1045): heartbeat event ingestion and the list read
// =============================================================================

if (!appMetricRegistry.list().some((def) => def.key === 'nodesEvents')) registerAppMetrics(NODES_APP_METRICS);

class TestReader extends MetricReader {
  protected async onForceFlush(): Promise<void> {}
  protected async onShutdown(): Promise<void> {}
}

const NODE = { id: '00000000-0000-4000-8000-000000000001', name: 'laptop-a', createdById: 'user-1' };
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

function event(overrides: Record<string, unknown> = {}) {
  return { type: 'power.battery_low', severity: 'warning' as const, at: iso(-1000), attrs: { batteryPercent: 9 }, ...overrides };
}

function setup() {
  const order: string[] = [];
  const createMany = jest.fn(async () => {
    order.push('write');
    return { count: 0 };
  });
  const prisma = {
    workerNodeEvent: { createMany, count: jest.fn(), findMany: jest.fn() },
    workerNode: { findUnique: jest.fn() },
  };
  const emit = jest.fn(() => {
    order.push('emit');
    return true;
  });
  const reader = new TestReader();
  const provider = new MeterProvider({ readers: [reader] });
  const metrics = new MetricsHostService({ meter: provider.getMeter('app'), gateOpen: () => true, gauges: true });
  const service = new NodeEventsService(
    prisma as unknown as JobsPrisma,
    { emit } as unknown as EventEmitter2,
    metrics,
  );

  return { service, prisma, createMany, emit, order, reader };
}

describe('NodeEventsService.ingest', () => {
  it('persists each event with the server clock as receivedAt and the node attrs', async () => {
    const { service, createMany } = setup();

    const outcome = await service.ingest(NODE, [event(), event({ type: 'node.sleep_resumed', severity: 'info', attrs: undefined })]);

    expect(outcome).toEqual({ accepted: 2, dropped: 0 });
    const rows = (createMany.mock.calls[0] as unknown as [{ data: any[] }])[0].data;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ nodeId: NODE.id, type: 'power.battery_low', severity: 'warning', attrs: { batteryPercent: 9 } });
    expect(rows[0].receivedAt).toBeInstanceOf(Date);
    expect(rows[1].attrs).toBeNull();
    expect(rows[0].receivedAt).toBe(rows[1].receivedAt);
  });

  it('does nothing for a heartbeat without events', async () => {
    const { service, createMany } = setup();

    expect(await service.ingest(NODE, undefined)).toEqual({ accepted: 0, dropped: 0 });
    expect(await service.ingest(NODE, [])).toEqual({ accepted: 0, dropped: 0 });
    expect(createMany).not.toHaveBeenCalled();
  });

  it('replaces an occurredAt outside [now-24h, now+5m] with receivedAt, keeps one inside', async () => {
    const { service, createMany } = setup();
    const inside = iso(-3_600_000);

    await service.ingest(NODE, [event({ at: iso(-25 * 3_600_000) }), event({ at: iso(10 * 60_000) }), event({ at: inside })]);

    const rows = (createMany.mock.calls[0] as unknown as [{ data: any[] }])[0].data;
    expect(rows[0].occurredAt).toBe(rows[0].receivedAt);
    expect(rows[1].occurredAt).toBe(rows[1].receivedAt);
    expect(rows[2].occurredAt.toISOString()).toBe(inside);
  });

  it('clampOccurredAt treats an unparseable timestamp as receivedAt', () => {
    const received = new Date();
    expect(clampOccurredAt('not a date', received)).toBe(received);
  });

  it('caps a node at the hourly budget: the excess is dropped and counted, never an error', async () => {
    const { service, createMany } = setup();
    const batch = Array.from({ length: 50 }, () => event());

    const first = await service.ingest(NODE, batch);
    const second = await service.ingest(NODE, batch);
    const third = await service.ingest(NODE, batch);

    expect(first.accepted + second.accepted + third.accepted).toBe(NODE_EVENTS_PER_HOUR);
    expect(third).toEqual({ accepted: NODE_EVENTS_PER_HOUR - 100, dropped: 50 - (NODE_EVENTS_PER_HOUR - 100) });
    const fourth = await service.ingest(NODE, batch);
    expect(fourth).toEqual({ accepted: 0, dropped: 50 });
    expect(createMany).toHaveBeenCalledTimes(3);
  });

  it('the budget is per node and refills over the hour', () => {
    const limiter = new NodeEventRateLimiter();
    const t0 = 1_000_000;
    expect(limiter.take('a', NODE_EVENTS_PER_HOUR, t0)).toBe(NODE_EVENTS_PER_HOUR);
    expect(limiter.take('a', 5, t0)).toBe(0);
    expect(limiter.take('b', 5, t0)).toBe(5);
    // Half an hour later, half the budget is back.
    expect(limiter.take('a', NODE_EVENTS_PER_HOUR, t0 + 1_800_000)).toBe(NODE_EVENTS_PER_HOUR / 2);
  });

  it('emits the domain event AFTER the write, once per accepted row, with the registered payload', async () => {
    const { service, emit, order } = setup();

    await service.ingest(NODE, [event(), event({ type: 'power.source_changed', severity: 'warning', attrs: { from: 'ac', to: 'battery' } })]);

    expect(order).toEqual(['write', 'emit', 'emit']);
    expect(emit).toHaveBeenCalledTimes(2);
    const [key, payload] = emit.mock.calls[1] as unknown as [string, NodeEventReportedEvent];
    expect(key).toBe(NODE_EVENT_REPORTED);
    expect(key).toBe('nodes.node.event');
    expect(payload).toBeInstanceOf(NodeEventReportedEvent);
    expect(payload).toMatchObject({
      nodeId: NODE.id,
      nodeName: 'laptop-a',
      ownerUserId: 'user-1',
      type: 'power.source_changed',
      severity: 'warning',
      attrs: { from: 'ac', to: 'battery' },
    });
    expect(payload.occurredAt).toBeInstanceOf(Date);
  });

  it('emits nothing when the write fails, and never rejects', async () => {
    const { service, createMany, emit } = setup();
    createMany.mockRejectedValueOnce(new Error('db down'));

    await expect(service.ingest(NODE, [event()])).resolves.toEqual({ accepted: 0, dropped: 0 });
    expect(emit).not.toHaveBeenCalled();
  });

  it('survives a throwing listener', async () => {
    const { service, emit } = setup();
    emit.mockImplementation(() => {
      throw new Error('listener bug');
    });

    await expect(service.ingest(NODE, [event()])).resolves.toEqual({ accepted: 1, dropped: 0 });
  });

  it('counts app.nodes.events by bounded type and severity; an unknown type is `other`', async () => {
    const { service, reader } = setup();

    await service.ingest(NODE, [event(), event({ type: 'custom.thing_happened', severity: 'info' })]);

    const { resourceMetrics } = await reader.collect();
    const metric = resourceMetrics.scopeMetrics.flatMap((s) => s.metrics).find((m) => m.descriptor.name === 'app.nodes.events');
    const points = (metric?.dataPoints ?? []).map((p) => ({ ...p.attributes, value: p.value }));
    expect(points).toEqual(
      expect.arrayContaining([
        { type: 'power.battery_low', severity: 'warning', value: 1 },
        { type: 'other', severity: 'info', value: 1 },
      ]),
    );
    expect(metric?.descriptor.unit).toBe('{event}');
  });
});

describe('NodeEventsService.list', () => {
  it('pages newest first, filters by type and severity, and maps the wire shape', async () => {
    const { service, prisma } = setup();
    prisma.workerNode.findUnique.mockResolvedValue({ id: NODE.id });
    prisma.workerNodeEvent.count.mockResolvedValue(45);
    const at = new Date('2026-01-01T00:00:00.000Z');
    prisma.workerNodeEvent.findMany.mockResolvedValue([
      { id: 'e1', nodeId: NODE.id, type: 'power.battery_low', severity: 'warning', attrs: null, occurredAt: at, receivedAt: at },
    ]);

    const page = await service.list(NODE.id, { page: 2, pageSize: 20, type: 'power.battery_low', severity: 'warning' });

    expect(prisma.workerNodeEvent.findMany).toHaveBeenCalledWith({
      where: { nodeId: NODE.id, type: 'power.battery_low', severity: 'warning' },
      orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }],
      skip: 20,
      take: 20,
    });
    expect(page).toEqual({
      items: [{ id: 'e1', nodeId: NODE.id, type: 'power.battery_low', severity: 'warning', attrs: {}, occurredAt: at.toISOString(), receivedAt: at.toISOString() }],
      total: 45,
      page: 2,
      pageSize: 20,
      totalPages: 3,
    });
  });

  it('answers 404 for a node that does not exist', async () => {
    const { service, prisma } = setup();
    prisma.workerNode.findUnique.mockResolvedValue(null);

    await expect(service.list(NODE.id, { page: 1, pageSize: 20 })).rejects.toBeInstanceOf(NotFoundException);
  });
});
