import { metrics, trace } from '@opentelemetry/api';
import { APP_SLUG } from '@app/shared';
import { MetricsHostService, telemetryGate, Trace } from '@marinoscar/platform-api/otel-core';

import { AppMetricsService } from '@marinoscar/platform-api/host';
import { closeTestApp, createTestApp, type TestContext } from '../helpers/test-app.helper';

// =============================================================================
// The API with OpenTelemetry OFF (issue #700)
// =============================================================================
//
// docs/specs/platform-packages.md: "Apps must still run with OTEL_ENABLED=false
// and no telemetry stack." With OTEL_ENABLED unset, `instrumentation.ts`
// installs no SDK, the full AppModule (mocked database) boots, the one metrics
// host is the package's, on the API's no-op meter, with gauges off, and every
// AppMetricsService method is a safe no-op. The CI `smoke` job proves the same
// for the compiled API (`OTEL_ENABLED: 'false'`).
// =============================================================================

describe('API with OTEL_ENABLED unset', () => {
  const saved = process.env.OTEL_ENABLED;
  let ctx: TestContext;

  beforeAll(async () => {
    delete process.env.OTEL_ENABLED;
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await closeTestApp(ctx);
    if (saved === undefined) delete process.env.OTEL_ENABLED;
    else process.env.OTEL_ENABLED = saved;
  });

  it('instrumentation.ts installs no SDK and logs the disabled line', () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { sdk } = require('../../src/instrumentation') as { sdk: unknown };
        expect(sdk).toBeNull();
      });
      expect(log).toHaveBeenCalledWith('OpenTelemetry disabled (OTEL_ENABLED !== true)');
    } finally {
      log.mockRestore();
    }
  });

  it('boots, with the API no-op providers and the export gate closed', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/health/live' });
    expect(res.statusCode).toBe(200);
    expect(trace.getActiveSpan()).toBeUndefined();
    expect(telemetryGate.isEnabled()).toBe(false);
    expect(telemetryGate.instanceId()).toBe(APP_SLUG);
  });

  it('wires AppMetricsService onto the one global metrics host, on the no-op meter, gauges off', () => {
    const appMetrics = ctx.module.get(AppMetricsService);
    const host = ctx.module.get(MetricsHostService);

    expect(host.meter).toBe(metrics.getMeter('app'));
    expect((appMetrics as unknown as { host: MetricsHostService }).host).toBe(host);
    expect(host.gaugesEnabled()).toBe(false);
    expect(appMetrics.gaugeContext()).toBeNull();
  });

  it('makes every AppMetricsService method a safe no-op', async () => {
    const m = ctx.module.get(AppMetricsService);

    expect(() => {
      m.jobEnqueued('db.backup.run');
      m.jobsClaimedBy('server', ['db.backup.run']);
      m.jobSettled('db.backup.run', 'succeeded', 1200, 'server');
      m.leaseReaped('requeued', 2);
      m.leaseReaped('failed', 1, 'ai.image');
      m.backupSettled('completed', 5_000, BigInt(4096));
      m.authLogin('success');
      m.authRefresh('reuse_detected');
      m.aiUsage({ provider: 'openai', model: 'm', operation: 'responses', status: 'succeeded', latencyMs: 10, inputTokens: 5 });
      m.notificationDelivery('email', 'sent', 'job.failed');
      m.add('eventBusPublished', 1, { adapter: 'memory', channel: 'c', outcome: 'ok' });
      m.record('jobsDuration', 1);
      m.add('noSuchMetric');
      m.boundLabel('job_type', 'x');
      m.registerGauges();
    }).not.toThrow();

    await expect(m.gaugeSnapshot()).resolves.toBeNull();
  });

  it('runs a @Trace() method unchanged (a no-op span)', async () => {
    class Report {
      @Trace('report.build')
      async build(id: string): Promise<string> {
        return `report-${id}`;
      }
    }

    await expect(new Report().build('7')).resolves.toBe('report-7');
  });
});
