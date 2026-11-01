import { Logger, NotFoundException } from '@nestjs/common';
import { DASHBOARD_PANEL_PAYLOAD_MAX_BYTES } from '@marinoscar/platform-contract/telemetry';

import { withTemporaryEntries } from '../../../core/index';
import { TELEMETRY_ERROR_REASONS, TelemetryHttpError } from '../../query/telemetry-query.errors';
import { GREPTIME_SQL_DIALECT } from '../../stores/greptime/greptime.dialect';
import { dashboardPanelRegistry, registerDashboardPanel, type DashboardPanelContext, type DashboardPanelDef } from './dashboard-panels';
import { PANEL_TIME_BUDGET_MS, TelemetryDashboardPanelService } from './telemetry-dashboard-panel.service';

// =============================================================================
// TelemetryDashboardPanelService (PP-14.18)
// =============================================================================
//
// The panel's `data` function is app code. What it can reach, what it can
// return and how it fails are all pinned here.
// =============================================================================

const WINDOW = {
  from: new Date('2026-01-01T00:00:00.000Z'),
  to: new Date('2026-01-01T01:00:00.000Z'),
  previousFrom: new Date('2025-12-31T23:00:00.000Z'),
  bucketSeconds: 60,
};

function setup(scope: { filters?: { service?: string; instance?: string } } = {}) {
  const panelScope = jest.fn(async () => ({ window: WINDOW, filters: scope.filters ?? {} }));
  const timeseries = jest.fn(async (_userId: string, query: { panel: string }) => ({ series: query.panel }));
  const run = jest.fn(async () => ({ columns: [{ name: 'n', type: 'int8' }], rows: [['4']], rowCount: 1, truncated: false, elapsedMs: 1 }));
  const service = new TelemetryDashboardPanelService(
    { panelScope, timeseries } as never,
    { run } as never,
    GREPTIME_SQL_DIALECT,
  );
  return { service, panelScope, timeseries, run };
}

const QUERY = { range: '1h' } as never;

async function withPanel<T>(data: DashboardPanelDef['data'], fn: () => Promise<T>): Promise<T> {
  return withTemporaryEntries(dashboardPanelRegistry, [], () => {
    registerDashboardPanel({ id: 'probe', label: 'Probe', order: 100, data });
    return fn();
  });
}

describe('TelemetryDashboardPanelService', () => {
  beforeEach(() => {
    // A failing panel is logged on purpose; keep the test output quiet.
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('lists the panels in dashboard order, marking the platform ones', async () => {
    const { service } = setup();
    await withPanel(() => null, async () => {
      expect(service.list().data).toEqual([
        { id: 'api', label: 'API requests', order: 10, builtin: true },
        { id: 'logs', label: 'Log severity', order: 20, builtin: true },
        { id: 'probe', label: 'Probe', order: 100, builtin: false },
      ]);
    });
  });

  it('reads the platform panels from the timeseries, for the same window', async () => {
    const { service, timeseries } = setup();
    const result = await service.read('u1', 'api', QUERY);

    expect(timeseries).toHaveBeenCalledWith('u1', { range: '1h', panel: 'api' });
    expect(result).toMatchObject({ id: 'api', payload: { series: 'api' } });
    expect(Date.parse(result.generatedAt)).not.toBeNaN();
  });

  it('answers an unknown or malformed id as 404 before touching the store', async () => {
    const { service, panelScope } = setup();
    for (const id of ['nope', '../etc/passwd', 'API', '']) {
      await expect(service.read('u1', id, QUERY)).rejects.toBeInstanceOf(NotFoundException);
    }
    expect(panelScope).not.toHaveBeenCalled();
  });

  it('hands the panel a frozen context: the window, the checked filters and the facade, no client', async () => {
    const { service } = setup({ filters: { service: 'my-api' } });
    let seen: DashboardPanelContext | undefined;
    await withPanel(
      (ctx) => {
        seen = ctx;
        return { ok: true };
      },
      () => service.read('u1', 'probe', QUERY),
    );

    expect(seen).toBeDefined();
    expect(Object.keys(seen!).sort()).toEqual(['filters', 'id', 'query', 'signal', 'timeseries', 'window']);
    expect(Object.isFrozen(seen)).toBe(true);
    expect(Object.isFrozen(seen!.window)).toBe(true);
    expect(Object.isFrozen(seen!.filters)).toBe(true);
    expect(seen!.filters).toEqual({ service: 'my-api' });
    expect(seen!.window.bucketSeconds).toBe(60);
    expect(Object.keys(seen!.query).sort()).toEqual(['dialect', 'query', 'sql']);
  });

  it('runs the panel\'s statements as the caller, with the panel source', async () => {
    const { service, run } = setup();
    const result = await withPanel(
      async (ctx) => {
        const rows = await ctx.query.query('SELECT count(*) AS n FROM opentelemetry_logs');
        return { total: Number(rows.rows[0]![0]) };
      },
      () => service.read('u1', 'probe', QUERY),
    );

    expect(result.payload).toEqual({ total: 4 });
    expect(run).toHaveBeenCalledWith('u1', 'SELECT count(*) AS n FROM opentelemetry_logs', expect.objectContaining({ source: 'panel' }));
  });

  it('returns plain JSON: a Date becomes text, undefined fields vanish, undefined becomes null', async () => {
    const { service } = setup();
    const payloadOf = (value: unknown) => withPanel(() => value, () => service.read('u1', 'probe', QUERY)).then((r) => r.payload);

    expect(await payloadOf({ at: new Date('2026-01-01T00:00:00.000Z'), gone: undefined, n: 1 })).toEqual({ at: '2026-01-01T00:00:00.000Z', n: 1 });
    expect(await payloadOf(undefined)).toBeNull();
    expect(await payloadOf([1, 'a', null])).toEqual([1, 'a', null]);
  });

  it.each([
    ['a cycle', () => { const a: Record<string, unknown> = {}; a.self = a; return a; }],
    ['a BigInt', () => ({ n: BigInt(1) })],
    ['a function', () => () => 1],
    ['more than the byte bound', () => ({ blob: 'x'.repeat(DASHBOARD_PANEL_PAYLOAD_MAX_BYTES) })],
  ])('refuses a payload that is %s, as a generic TELEMETRY_PANEL_FAILED', async (_name, make) => {
    const { service } = setup();
    const error = await withPanel(make as never, () => service.read('u1', 'probe', QUERY)).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(TelemetryHttpError);
    expect((error as TelemetryHttpError).reason).toBe(TELEMETRY_ERROR_REASONS.PANEL_FAILED);
    expect((error as TelemetryHttpError).getStatus()).toBe(500);
  });

  it('never shows the viewer what the panel threw, and logs it', async () => {
    const { service } = setup();
    const secret = 'connect ECONNREFUSED 10.1.2.3:5432 password=hunter2';
    const logged = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    const error = (await withPanel(
      () => {
        throw new Error(secret);
      },
      () => service.read('u1', 'probe', QUERY),
    ).catch((e: unknown) => e)) as TelemetryHttpError;

    expect(error.reason).toBe(TELEMETRY_ERROR_REASONS.PANEL_FAILED);
    expect(JSON.stringify(error.getResponse())).not.toContain('hunter2');
    expect(error.message).toBe('The dashboard panel could not be read.');
    expect(logged.mock.calls[0]![0]).toContain('probe');
    expect(String(logged.mock.calls[0]![0])).toContain(secret);
  });

  it('passes a store failure through unchanged: it is about the store, and says so', async () => {
    const { service } = setup();
    const off = new TelemetryHttpError(TELEMETRY_ERROR_REASONS.DISABLED, 'Telemetry is disabled.');
    const error = await withPanel(
      () => {
        throw off;
      },
      () => service.read('u1', 'probe', QUERY),
    ).catch((e: unknown) => e);

    expect(error).toBe(off);
  });

  it('gives up after its time budget and aborts the panel\'s signal', async () => {
    jest.useFakeTimers();
    try {
      const { service } = setup();
      let signal: AbortSignal | undefined;
      const pending = withPanel(
        (ctx) => {
          signal = ctx.signal;
          return new Promise(() => undefined);
        },
        () => service.read('u1', 'probe', QUERY),
      );
      const outcome = pending.catch((e: unknown) => e);
      await jest.advanceTimersByTimeAsync(PANEL_TIME_BUDGET_MS + 1);

      expect(((await outcome) as TelemetryHttpError).reason).toBe(TELEMETRY_ERROR_REASONS.PANEL_FAILED);
      expect(signal?.aborted).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not read the panel when the dashboard scope is refused (store off, bad filter)', async () => {
    const { service, panelScope } = setup();
    const refusal = new TelemetryHttpError(TELEMETRY_ERROR_REASONS.DASHBOARD_BAD_FILTER, 'Not seen.');
    panelScope.mockRejectedValueOnce(refusal);
    const data = jest.fn();

    const error = await withPanel(data, () => service.read('u1', 'probe', QUERY)).catch((e: unknown) => e);

    expect(error).toBe(refusal);
    expect(data).not.toHaveBeenCalled();
  });
});
