import { ConfigService } from '@nestjs/config';
import {
  DataPointType,
  MeterProvider,
  MetricReader,
  type MetricData,
} from '@opentelemetry/sdk-metrics';

import type { PrismaService } from '../../prisma/prisma.service';
import { withTemporaryEntries } from '../registry';
import {
  APP_METRIC_NAMES,
  appMetricRegistry,
  createRegisteredGauge,
  type AppMetricDef,
  AppMetricsService,
  GAUGE_CACHE_TTL_MS,
  MAX_DISTINCT_VALUES,
  OTHER_LABEL,
  UNKNOWN_LABEL,
  fallbackAppMetrics,
  type AppMetricsOptions,
} from './app-metrics.service';

// =============================================================================
// AppMetricsService (issue #600)
// =============================================================================
//
// Proven against a REAL in-memory SDK MeterProvider, collected on demand: the
// names, units and attribute sets asserted here are exactly what the OTLP
// exporter would send to the collector.
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
  return metric(all, name).dataPoints.map((dp) => ({
    attributes: { ...dp.attributes },
    value: dp.value,
  }));
}

interface PrismaStub {
  job: { groupBy: jest.Mock };
  databaseBackupRun: { findFirst: jest.Mock };
}

function prismaStub(): PrismaStub {
  return {
    job: {
      groupBy: jest.fn(async (args: { by: string[] }) =>
        args.by.length === 2
          ? [
              { type: 'db.backup.run', status: 'pending', _count: { _all: 3 } },
              { type: 'db.backup.run', status: 'running', _count: { _all: 1 } },
            ]
          : [{ type: 'db.backup.run', _min: { createdAt: new Date(1_000_000 - 90_000) } }],
      ),
    },
    databaseBackupRun: {
      findFirst: jest.fn(async () => ({
        finishedAt: new Date(1_700_000_000_500),
        sizeBytes: BigInt(4096),
      })),
    },
  };
}

function setup(
  opts: { prisma?: PrismaStub; otelEnabled?: boolean; options?: Partial<AppMetricsOptions> } = {},
) {
  const reader = new TestReader();
  const provider = new MeterProvider({ readers: [reader] });
  let now = 1_000_000;
  let gate = true;
  const config = { get: jest.fn((key: string) => (key === 'otel.enabled' ? opts.otelEnabled ?? true : undefined)) };

  const service = new AppMetricsService(
    opts.prisma as unknown as PrismaService,
    config as unknown as ConfigService,
    {
      meter: provider.getMeter('app'),
      now: () => now,
      gateOpen: () => gate,
      ...opts.options,
    },
  );

  return {
    service,
    reader,
    provider,
    advance: (ms: number) => {
      now += ms;
    },
    setGate: (open: boolean) => {
      gate = open;
    },
  };
}

describe('AppMetricsService', () => {
  describe('counters and histograms', () => {
    it('records job lifecycle metrics with their names, units and low-cardinality attributes', async () => {
      const { service, reader } = setup();

      service.jobEnqueued('db.backup.run');
      service.jobEnqueued('db.backup.run');
      service.jobsClaimedBy('server', ['db.backup.run', 'db.backup.run', 'ai.image']);
      service.jobSettled('db.backup.run', 'succeeded', 2500, 'node');
      service.jobSettled('db.backup.run', 'retry-scheduled', null, null);
      service.leaseReaped('failed', 1, 'ai.image');
      service.leaseReaped('requeued', 4);
      service.leaseReaped('requeued', 0); // a no-op sweep records nothing

      const all = await collect(reader);

      expect(metric(all, APP_METRIC_NAMES.jobsEnqueued).descriptor.unit).toBe('{job}');
      expect(points(all, 'app.jobs.enqueued')).toEqual([
        { attributes: { job_type: 'db.backup.run' }, value: 2 },
      ]);

      expect(points(all, 'app.jobs.claimed')).toEqual(
        expect.arrayContaining([
          { attributes: { job_type: 'db.backup.run', executor: 'server' }, value: 2 },
          { attributes: { job_type: 'ai.image', executor: 'server' }, value: 1 },
        ]),
      );

      expect(points(all, 'app.jobs.settled')).toEqual(
        expect.arrayContaining([
          { attributes: { job_type: 'db.backup.run', outcome: 'succeeded', executor: 'node' }, value: 1 },
          {
            attributes: { job_type: 'db.backup.run', outcome: 'retry-scheduled', executor: UNKNOWN_LABEL },
            value: 1,
          },
        ]),
      );

      const duration = metric(all, 'app.jobs.duration');
      expect(duration.descriptor.unit).toBe('s');
      expect(duration.dataPointType).toBe(DataPointType.HISTOGRAM);
      // Only the settlement with a known start contributed, in SECONDS.
      expect(duration.dataPoints).toHaveLength(1);
      expect((duration.dataPoints[0].value as { sum: number; count: number }).sum).toBeCloseTo(2.5);
      expect((duration.dataPoints[0].value as { count: number }).count).toBe(1);

      expect(points(all, 'app.jobs.reaped')).toEqual(
        expect.arrayContaining([
          { attributes: { outcome: 'failed', job_type: 'ai.image' }, value: 1 },
          { attributes: { outcome: 'requeued' }, value: 4 },
        ]),
      );
    });

    it('records backup outcomes, duration in seconds and size in bytes (completed only)', async () => {
      const { service, reader } = setup();

      service.backupSettled('completed', 120_000, BigInt(5_000_000));
      service.backupSettled('failed', 30_000, BigInt(9_999));
      service.backupSettled('failed', null);

      const all = await collect(reader);

      expect(metric(all, 'app.backup.runs').descriptor.unit).toBe('{run}');
      expect(points(all, 'app.backup.runs')).toEqual(
        expect.arrayContaining([
          { attributes: { outcome: 'completed' }, value: 1 },
          { attributes: { outcome: 'failed' }, value: 2 },
        ]),
      );

      expect(metric(all, 'app.backup.duration').descriptor.unit).toBe('s');
      const size = metric(all, 'app.backup.size');
      expect(size.descriptor.unit).toBe('By');
      expect(size.dataPoints).toHaveLength(1);
      expect(size.dataPoints[0].attributes).toEqual({ outcome: 'completed' });
      expect((size.dataPoints[0].value as { sum: number }).sum).toBe(5_000_000);
    });

    it('records auth logins and refreshes by outcome', async () => {
      const { service, reader } = setup();

      service.authLogin('success');
      service.authLogin('allowlist_rejected');
      service.authRefresh('expired');
      service.authRefresh('bogus' as never);

      const all = await collect(reader);

      expect(points(all, 'app.auth.logins')).toEqual(
        expect.arrayContaining([
          { attributes: { provider: 'google', outcome: 'success' }, value: 1 },
          { attributes: { provider: 'google', outcome: 'allowlist_rejected' }, value: 1 },
        ]),
      );
      expect(points(all, 'app.auth.refreshes')).toEqual(
        expect.arrayContaining([
          { attributes: { outcome: 'expired' }, value: 1 },
          { attributes: { outcome: OTHER_LABEL }, value: 1 },
        ]),
      );
    });

    it('records AI requests, tokens by type and latency in seconds', async () => {
      const { service, reader } = setup();

      service.aiUsage({
        provider: 'openai',
        model: 'gpt-5-mini',
        operation: 'responses',
        status: 'succeeded',
        keySource: 'org',
        inputTokens: 120,
        outputTokens: 30,
        latencyMs: 1500,
      });
      service.aiUsage({
        provider: 'openai',
        model: 'gpt-5-mini',
        operation: 'responses',
        status: 'failed',
        inputTokens: null,
        outputTokens: 0,
        latencyMs: 200,
      });

      const all = await collect(reader);
      const base = { provider: 'openai', model: 'gpt-5-mini', operation: 'responses' };

      expect(points(all, 'app.ai.requests')).toEqual(
        expect.arrayContaining([
          { attributes: { ...base, status: 'succeeded', key_source: 'org' }, value: 1 },
          { attributes: { ...base, status: 'failed', key_source: UNKNOWN_LABEL }, value: 1 },
        ]),
      );
      expect(metric(all, 'app.ai.tokens').descriptor.unit).toBe('{token}');
      expect(points(all, 'app.ai.tokens')).toEqual(
        expect.arrayContaining([
          { attributes: { ...base, token_type: 'input' }, value: 120 },
          { attributes: { ...base, token_type: 'output' }, value: 30 },
        ]),
      );
      expect(points(all, 'app.ai.tokens')).toHaveLength(2);
      const latency = metric(all, 'app.ai.request.duration');
      expect(latency.descriptor.unit).toBe('s');
      expect(latency.dataPoints).toHaveLength(2);
    });

    it('records notification deliveries by channel, event and outcome', async () => {
      const { service, reader } = setup();

      service.notificationDelivery('email', 'sent', 'user.welcome');
      service.notificationDelivery('push', 'rate_limited');

      const all = await collect(reader);

      expect(points(all, 'app.notifications.deliveries')).toEqual(
        expect.arrayContaining([
          { attributes: { channel: 'email', event: 'user.welcome', outcome: 'sent' }, value: 1 },
          { attributes: { channel: 'push', event: UNKNOWN_LABEL, outcome: 'rate_limited' }, value: 1 },
        ]),
      );
    });
  });

  describe('label bounding', () => {
    it('maps empty, non-identifier and over-long strings to unknown/other', () => {
      const { service } = setup();

      expect(service.boundLabel('k', '')).toBe(UNKNOWN_LABEL);
      expect(service.boundLabel('k', undefined)).toBe(UNKNOWN_LABEL);
      expect(service.boundLabel('k', 'user@example.com')).toBe(OTHER_LABEL);
      expect(service.boundLabel('k', 'claude-sonnet@20250101')).toBe('claude-sonnet@20250101');
      expect(service.boundLabel('k', 'has spaces in it')).toBe(OTHER_LABEL);
      expect(service.boundLabel('k', 'https://x.test/a?b=c')).toBe(OTHER_LABEL);
      expect(service.boundLabel('k', 'a'.repeat(65))).toBe(OTHER_LABEL);
      expect(service.boundLabel('k', '  db.backup.run  ')).toBe('db.backup.run');
    });

    it('admits at most MAX_DISTINCT_VALUES distinct values per key, then folds into other', () => {
      const { service } = setup();

      for (let i = 0; i < MAX_DISTINCT_VALUES; i += 1) {
        expect(service.boundLabel('job_type', `type.${i}`)).toBe(`type.${i}`);
      }

      expect(service.boundLabel('job_type', 'one.too.many')).toBe(OTHER_LABEL);
      // Already-seen values keep their own label; other keys have their own budget.
      expect(service.boundLabel('job_type', 'type.0')).toBe('type.0');
      expect(service.boundLabel('ai_model', 'one.too.many')).toBe('one.too.many');
    });

    it('maps an unknown enumerated outcome to other rather than passing it through', async () => {
      const { service, reader } = setup();

      service.jobSettled('t', 'Error: connection refused for user 42', 10, 'server');

      const all = await collect(reader);
      expect(points(all, 'app.jobs.settled')[0].attributes).toEqual({
        job_type: 't',
        outcome: OTHER_LABEL,
        executor: 'server',
      });
    });
  });

  describe('never throws', () => {
    it('swallows a failing instrument', () => {
      const broken = {
        createCounter: () => ({ add: () => { throw new Error('boom'); } }),
        createHistogram: () => ({ record: () => { throw new Error('boom'); } }),
      };
      const service = new AppMetricsService(undefined, undefined, { meter: broken as never });

      expect(() => service.jobEnqueued('x')).not.toThrow();
      expect(() => service.jobSettled('x', 'succeeded', 1, 'server')).not.toThrow();
      expect(() => service.backupSettled('completed', 1, 1)).not.toThrow();
      expect(() => service.authLogin('success')).not.toThrow();
      expect(() =>
        service.aiUsage({ provider: 'p', model: 'm', operation: 'o', status: 'succeeded', latencyMs: 1, inputTokens: 1 }),
      ).not.toThrow();
      expect(() => service.notificationDelivery('email', 'sent')).not.toThrow();
    });

    it('the fallback instance (no DI) works against the global no-op meter', () => {
      expect(() => fallbackAppMetrics().jobEnqueued('x')).not.toThrow();
      expect(fallbackAppMetrics()).toBe(fallbackAppMetrics());
    });
  });

  describe('observable gauges', () => {
    it('observes queue depth, oldest pending age and last backup from one cached snapshot', async () => {
      const prisma = prismaStub();
      const { service, reader } = setup({ prisma });
      service.onModuleInit();

      const all = await collect(reader);

      expect(metric(all, APP_METRIC_NAMES.jobsQueueDepth).descriptor.unit).toBe('{job}');
      expect(points(all, 'app.jobs.queue.depth')).toEqual(
        expect.arrayContaining([
          { attributes: { job_type: 'db.backup.run', status: 'pending' }, value: 3 },
          { attributes: { job_type: 'db.backup.run', status: 'running' }, value: 1 },
        ]),
      );

      expect(metric(all, 'app.jobs.oldest_pending.age').descriptor.unit).toBe('s');
      expect(points(all, 'app.jobs.oldest_pending.age')).toEqual([
        { attributes: { job_type: 'db.backup.run' }, value: 90 },
      ]);

      expect(metric(all, 'app.backup.last_success.timestamp').descriptor.unit).toBe('s');
      expect(points(all, 'app.backup.last_success.timestamp')).toEqual([
        { attributes: {}, value: 1_700_000_000 },
      ]);
      expect(metric(all, 'app.backup.last_success.size').descriptor.unit).toBe('By');
      expect(points(all, 'app.backup.last_success.size')).toEqual([{ attributes: {}, value: 4096 }]);

      // Depth is restricted to live statuses; oldest-age to due pending rows.
      const [depthArgs] = prisma.job.groupBy.mock.calls.find(([a]) => a.by.length === 2)!;
      expect(depthArgs.where).toEqual({ status: { in: ['pending', 'running'] } });
      const [ageArgs] = prisma.job.groupBy.mock.calls.find(([a]) => a.by.length === 1)!;
      expect(ageArgs.where.status).toBe('pending');
      expect(ageArgs._min).toEqual({ createdAt: true });
    });

    it('reuses the snapshot within the TTL and shares one in-flight read', async () => {
      const prisma = prismaStub();
      const { service, advance } = setup({ prisma });

      const [a, b] = await Promise.all([service.gaugeSnapshot(), service.gaugeSnapshot()]);
      expect(a).toBe(b);
      expect(prisma.databaseBackupRun.findFirst).toHaveBeenCalledTimes(1);

      advance(GAUGE_CACHE_TTL_MS - 1);
      await service.gaugeSnapshot();
      expect(prisma.databaseBackupRun.findFirst).toHaveBeenCalledTimes(1);

      advance(2);
      await service.gaugeSnapshot();
      expect(prisma.databaseBackupRun.findFirst).toHaveBeenCalledTimes(2);
    });

    it('queries nothing while the export gate is closed', async () => {
      const prisma = prismaStub();
      const { service, reader, setGate } = setup({ prisma });
      service.onModuleInit();
      setGate(false);

      const all = await collect(reader);

      expect(all.find((m) => m.descriptor.name === 'app.jobs.queue.depth')?.dataPoints ?? []).toEqual([]);
      expect(prisma.job.groupBy).not.toHaveBeenCalled();
    });

    it('never throws from the callback when the database read fails', async () => {
      const prisma = prismaStub();
      prisma.job.groupBy.mockRejectedValue(new Error('connection lost'));
      const { service, reader } = setup({ prisma });
      service.onModuleInit();

      const all = await collect(reader); // `collect` asserts no callback errors

      expect(all.find((m) => m.descriptor.name === 'app.jobs.queue.depth')?.dataPoints ?? []).toEqual([]);
      // The failure is not cached: the next collection tries again.
      prisma.job.groupBy.mockImplementation(prismaStub().job.groupBy);
      const again = await collect(reader);
      expect(points(again, 'app.jobs.queue.depth').length).toBeGreaterThan(0);
    });

    it('registers no gauge (and so runs no query) when OTEL is not enabled', async () => {
      const prisma = prismaStub();
      const { service, reader } = setup({ prisma, otelEnabled: false });
      service.onModuleInit();

      const all = await collect(reader);

      expect(all.map((m) => m.descriptor.name)).not.toContain('app.jobs.queue.depth');
      expect(prisma.job.groupBy).not.toHaveBeenCalled();
    });

    it('registers no gauge without a database (the fallback instance)', async () => {
      const { service, reader } = setup();
      service.onModuleInit();

      const all = await collect(reader);
      expect(all.map((m) => m.descriptor.name)).not.toContain('app.jobs.queue.depth');
    });
  });
});

// =============================================================================
// Baseline pinned on `main` before the app-metric registry (issue #680)
// =============================================================================
//
// Every instrument must keep its exact name, kind, unit, description and
// bucket boundaries: they are the OTLP descriptor, and so the GreptimeDB table
// name and every dashboard query that reads it. A recording meter captures the
// create calls verbatim and delegates to a real SDK meter.
// =============================================================================

interface CreatedInstrument {
  kind: 'counter' | 'histogram' | 'gauge';
  name: string;
  options: unknown;
}

function recordingMeter(): { meter: AppMetricsOptions['meter']; created: CreatedInstrument[] } {
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
    addBatchObservableCallback: (...args: Parameters<typeof inner.addBatchObservableCallback>) =>
      inner.addBatchObservableCallback(...args),
  };
  return { meter: meter as unknown as AppMetricsOptions['meter'], created };
}

const BASELINE_APP_METRIC_NAMES = {
  jobsEnqueued: 'app.jobs.enqueued',
  jobsClaimed: 'app.jobs.claimed',
  jobsSettled: 'app.jobs.settled',
  jobsDuration: 'app.jobs.duration',
  jobsReaped: 'app.jobs.reaped',
  jobsQueueDepth: 'app.jobs.queue.depth',
  jobsOldestPendingAge: 'app.jobs.oldest_pending.age',
  backupRuns: 'app.backup.runs',
  backupDuration: 'app.backup.duration',
  backupSize: 'app.backup.size',
  backupLastSuccessTimestamp: 'app.backup.last_success.timestamp',
  backupLastSuccessSize: 'app.backup.last_success.size',
  authLogins: 'app.auth.logins',
  authRefreshes: 'app.auth.refreshes',
  aiRequests: 'app.ai.requests',
  aiTokens: 'app.ai.tokens',
  aiDuration: 'app.ai.request.duration',
  notificationDeliveries: 'app.notifications.deliveries',
  nodesCount: 'app.nodes.count',
  nodesCpuUtilization: 'app.nodes.cpu.utilization',
  nodesMemoryRss: 'app.nodes.memory.rss',
  nodesHeapUsed: 'app.nodes.heap.used',
  nodesHeapLimit: 'app.nodes.heap.limit',
  nodesEventLoopDelayP99: 'app.nodes.event_loop.delay.p99',
  nodesStateDirFree: 'app.nodes.state_dir.free',
  nodesStateDirTotal: 'app.nodes.state_dir.total',
  nodesSlotsUsed: 'app.nodes.slots.used',
  nodesSlotsTotal: 'app.nodes.slots.total',
  nodesUptime: 'app.nodes.uptime',
  nodesCounter: 'app.nodes.counter',
  nodesTypesNoEligibleNode: 'app.nodes.types.no_eligible_node',
};

describe('AppMetricsService baseline (#680)', () => {
  it('keeps APP_METRIC_NAMES (31 names, same keys)', () => {
    expect(APP_METRIC_NAMES).toEqual(BASELINE_APP_METRIC_NAMES);
    expect(Object.keys(APP_METRIC_NAMES)).toHaveLength(31);
  });

  it('creates every counter, histogram and gauge with its exact name, unit, description and buckets', () => {
    const { meter, created } = recordingMeter();
    const config = { get: jest.fn((key: string) => (key === 'otel.enabled' ? true : undefined)) };
    const service = new AppMetricsService(
      prismaStub() as unknown as PrismaService,
      config as unknown as ConfigService,
      { meter, now: () => 0, gateOpen: () => false },
    );
    service.registerGauges();

    expect(created).toEqual([
      { kind: 'counter', name: 'app.jobs.enqueued', options: { description: 'Jobs inserted into the queue (dedup hits excluded).', unit: '{job}' } },
      { kind: 'counter', name: 'app.jobs.claimed', options: { description: 'Jobs claimed by an executor.', unit: '{job}' } },
      { kind: 'counter', name: 'app.jobs.settled', options: { description: 'Executor reports settled by the terminal state machine, by outcome.', unit: '{job}' } },
      {
        kind: 'histogram',
        name: 'app.jobs.duration',
        options: {
          description: 'Run time of one job attempt, from claim to settlement.',
          unit: 's',
          advice: { explicitBucketBoundaries: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120, 300, 600, 1800, 3600] },
        },
      },
      { kind: 'counter', name: 'app.jobs.reaped', options: { description: 'Abandoned running jobs recovered by the lease reaper.', unit: '{job}' } },
      { kind: 'counter', name: 'app.backup.runs', options: { description: 'Database backup runs settled, by outcome.', unit: '{run}' } },
      {
        kind: 'histogram',
        name: 'app.backup.duration',
        options: {
          description: 'Wall time of a settled database backup run.',
          unit: 's',
          advice: { explicitBucketBoundaries: [1, 5, 15, 30, 60, 120, 300, 600, 1200, 1800, 3600, 7200, 14400] },
        },
      },
      {
        kind: 'histogram',
        name: 'app.backup.size',
        options: {
          description: 'Size of a completed, verified database backup archive.',
          unit: 'By',
          advice: { explicitBucketBoundaries: [1e6, 1e7, 5e7, 1e8, 5e8, 1e9, 5e9, 1e10, 5e10, 1e11] },
        },
      },
      { kind: 'counter', name: 'app.auth.logins', options: { description: 'Interactive sign-in attempts, by provider and outcome.', unit: '{login}' } },
      { kind: 'counter', name: 'app.auth.refreshes', options: { description: 'Refresh-token rotations, by outcome.', unit: '{refresh}' } },
      { kind: 'counter', name: 'app.ai.requests', options: { description: 'AI provider round-trips, by provider, model, operation and status.', unit: '{request}' } },
      { kind: 'counter', name: 'app.ai.tokens', options: { description: 'AI tokens reported by the provider, by token_type (input|output).', unit: '{token}' } },
      {
        kind: 'histogram',
        name: 'app.ai.request.duration',
        options: {
          description: 'Latency of one AI provider round-trip.',
          unit: 's',
          advice: { explicitBucketBoundaries: [0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 30, 60, 120, 300] },
        },
      },
      { kind: 'counter', name: 'app.notifications.deliveries', options: { description: 'Notification delivery attempts, by channel, event and outcome.', unit: '{delivery}' } },
      { kind: 'gauge', name: 'app.jobs.queue.depth', options: { description: 'Jobs currently pending or running, by type and status.', unit: '{job}' } },
      { kind: 'gauge', name: 'app.jobs.oldest_pending.age', options: { description: 'Age of the oldest runnable pending job, by type.', unit: 's' } },
      { kind: 'gauge', name: 'app.backup.last_success.timestamp', options: { description: 'When the most recent completed database backup finished (unix seconds).', unit: 's' } },
      { kind: 'gauge', name: 'app.backup.last_success.size', options: { description: 'Size of the most recent completed database backup archive.', unit: 'By' } },
    ]);
  });
});

// =============================================================================
// App metrics through the registry: generic add/record (issue #680)
// =============================================================================

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

describe('AppMetricsService generic add/record (#680)', () => {
  /** Registers the app metrics, THEN constructs the service (it reads the registry at construction). */
  async function withAppMetrics(fn: (t: ReturnType<typeof setup>) => Promise<void>): Promise<void> {
    await withTemporaryEntries(appMetricRegistry, [APP_COUNTER, APP_HISTOGRAM, APP_GAUGE], async () => fn(setup()));
  }

  it('creates the app counter and histogram with their declared name, unit, description and buckets', async () => {
    await withTemporaryEntries(appMetricRegistry, [APP_COUNTER, APP_HISTOGRAM, APP_GAUGE], async () => {
      const { meter, created } = recordingMeter();
      new AppMetricsService(undefined, undefined, { meter });

      expect(created.slice(-2)).toEqual([
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
      // A gauge is declared, not created: its provider creates it.
      expect(created.map((c) => c.name)).not.toContain('app.test.widgets.backlog');
    });
  });

  it('exports an app counter through add() with bounded, declared attributes only', async () => {
    await withAppMetrics(async ({ service, reader }) => {
      service.add('testWidgetsMade', 2, { widget_kind: 'sprocket', outcome: 'ok', user_id: 'u-123' });
      service.add('testWidgetsMade', undefined, { widget_kind: 'sprocket', outcome: 'ok' });
      service.add('testWidgetsMade', 1, { widget_kind: 'someone@example.com', outcome: 'exploded' });
      service.add('testWidgetsMade');

      const all = await collect(reader);
      expect(metric(all, 'app.test.widgets.made').descriptor.unit).toBe('{widget}');
      expect(points(all, 'app.test.widgets.made')).toEqual(
        expect.arrayContaining([
          // The undeclared `user_id` was dropped; value defaults to 1.
          { attributes: { widget_kind: 'sprocket', outcome: 'ok' }, value: 3 },
          // An address-shaped free value and an out-of-set enum value become `other`.
          { attributes: { widget_kind: OTHER_LABEL, outcome: OTHER_LABEL }, value: 1 },
          { attributes: {}, value: 1 },
        ]),
      );
      expect(points(all, 'app.test.widgets.made')).toHaveLength(3);
    });
  });

  it('exports an app histogram through record() with its declared buckets', async () => {
    await withAppMetrics(async ({ service, reader }) => {
      service.record('testWidgetLatency', 0.5, { outcome: 'ok', widget_kind: 'dropped' });
      service.record('testWidgetLatency', 20, { outcome: 'failed' });

      const all = await collect(reader);
      const data = metric(all, 'app.test.widgets.latency');
      expect(data.dataPointType).toBe(DataPointType.HISTOGRAM);
      const byOutcome = Object.fromEntries(
        data.dataPoints.map((dp) => [dp.attributes.outcome, dp.value as { count: number; buckets: { boundaries: number[] } }]),
      );
      expect(Object.keys(byOutcome).sort()).toEqual(['failed', 'ok']);
      expect(byOutcome.ok?.count).toBe(1);
      expect(byOutcome.ok?.buckets.boundaries).toEqual([0.1, 1, 10]);
      expect(data.dataPoints.every((dp) => !('widget_kind' in dp.attributes))).toBe(true);
    });
  });

  it('a free attribute shares the per-key distinct-value budget', async () => {
    await withAppMetrics(async ({ service, reader }) => {
      for (let i = 0; i < MAX_DISTINCT_VALUES + 5; i += 1) {
        service.add('testWidgetsMade', 1, { widget_kind: `kind-${i}`, outcome: 'ok' });
      }
      const all = await collect(reader);
      const kinds = new Set(points(all, 'app.test.widgets.made').map((p) => p.attributes.widget_kind));
      expect(kinds.size).toBe(MAX_DISTINCT_VALUES + 1);
      expect(kinds.has(OTHER_LABEL)).toBe(true);
    });
  });

  it('ignores an unknown key, a kind mismatch and an invalid value, logging each unknown key once', async () => {
    await withAppMetrics(async ({ service, reader }) => {
      const debug = jest.spyOn((service as unknown as { logger: { debug: (m: string) => void } }).logger, 'debug');

      expect(() => service.add('noSuchMetric')).not.toThrow();
      expect(() => service.add('noSuchMetric', 5)).not.toThrow();
      expect(() => service.record('testWidgetsMade', 1)).not.toThrow(); // a counter
      expect(() => service.add('testWidgetLatency')).not.toThrow(); // a histogram
      expect(() => service.add('testWidgetBacklog')).not.toThrow(); // a gauge
      expect(() => service.add('testWidgetsMade', -1)).not.toThrow();
      expect(() => service.add('testWidgetsMade', Number.NaN)).not.toThrow();
      expect(() => service.record('testWidgetLatency', Number.POSITIVE_INFINITY)).not.toThrow();
      expect(() => service.add('testWidgetsMade', 1, 'not-an-object' as never)).not.toThrow();

      const unknown = debug.mock.calls.filter(([m]) => String(m).includes('"noSuchMetric"'));
      expect(unknown).toHaveLength(1);
      expect(debug.mock.calls.some(([m]) => String(m).includes('"testWidgetBacklog" is a gauge'))).toBe(true);

      const all = await collect(reader);
      expect(points(all, 'app.test.widgets.made')).toEqual([{ attributes: {}, value: 1 }]);
      expect(all.find((m) => m.descriptor.name === 'app.test.widgets.latency')?.dataPoints ?? []).toEqual([]);
    });
  });

  it('never throws when the instrument does', async () => {
    await withAppMetrics(async () => {
      const throwing = {
        createCounter: () => ({ add: () => { throw new Error('boom'); } }),
        createHistogram: () => ({ record: () => { throw new Error('boom'); } }),
      } as unknown as AppMetricsOptions['meter'];
      const service = new AppMetricsService(undefined, undefined, { meter: throwing });
      expect(() => service.add('testWidgetsMade', 1, { outcome: 'ok' })).not.toThrow();
      expect(() => service.record('testWidgetLatency', 1)).not.toThrow();
      expect(() => service.jobEnqueued('x')).not.toThrow();
    });
  });

  it('is a no-op against the global no-op meter (OTEL_ENABLED unset)', async () => {
    await withTemporaryEntries(appMetricRegistry, [APP_COUNTER, APP_HISTOGRAM], async () => {
      const service = new AppMetricsService();
      expect(() => service.add('testWidgetsMade', 1, { outcome: 'ok' })).not.toThrow();
      expect(() => service.record('testWidgetLatency', 1)).not.toThrow();
    });
  });

  it('createRegisteredGauge creates a declared gauge with its descriptor, and refuses anything else', async () => {
    await withTemporaryEntries(appMetricRegistry, [APP_COUNTER, APP_GAUGE], async () => {
      const { meter, created } = recordingMeter();
      createRegisteredGauge(meter as never, 'testWidgetBacklog' as never);
      expect(created).toEqual([
        { kind: 'gauge', name: 'app.test.widgets.backlog', options: { description: 'Test widgets waiting.', unit: '{widget}' } },
      ]);
      expect(() => createRegisteredGauge(meter as never, 'testWidgetsMade' as never)).toThrow(/not a gauge/);
      expect(() => createRegisteredGauge(meter as never, 'nope' as never)).toThrow(/Unknown id "nope"/);
    });
  });
});
