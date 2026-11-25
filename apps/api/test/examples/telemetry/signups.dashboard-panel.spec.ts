import { withTemporaryEntries } from '@marinoscar/platform-api/core';
import {
  TELEMETRY_ERROR_REASONS,
  TelemetryHttpError,
  analyzeStatement,
  GREPTIME_SQL_DIALECT,
  dashboardPanelRegistry,
  registerDashboardPanel,
} from '@marinoscar/platform-api/telemetry';

// Importing the seam registers the reference app's panel exactly as the app does.
import '../../../src/app-registrations/telemetry';
import { SIGNUPS_DASHBOARD_PANEL, type SignupsPayload } from '../../../src/platform-extensions/telemetry/signups.dashboard-panel';
import { createQueryFacade } from '@marinoscar/platform-api/telemetry/testing';


// =============================================================================
// An app-registered dashboard panel, driven through the real facade (PP-14.18)
// =============================================================================
//
// `signups` (platform-extensions/telemetry/signups.dashboard-panel.ts) is
// registered by the app's own seam, with no edit under packages/. Its `data`
// function runs here against the REAL guarded query facade over a recording
// query service, so what is proved is what it asks the store: single read-only
// statements, values quoted, the dashboard's filters applied.
// =============================================================================

const WINDOW = {
  from: new Date('2026-01-01T00:00:00.000Z'),
  to: new Date('2026-01-01T01:00:00.000Z'),
  previousFrom: new Date('2025-12-31T23:00:00.000Z'),
  bucketSeconds: 60,
};

type Answer = (sql: string) => { columns?: Array<{ name: string; type: string }>; rows: unknown[][] } | Error;

function ctxWith(answer: Answer, filters: { service?: string; instance?: string } = {}) {
  const statements: string[] = [];
  const queries = {
    run: jest.fn(async (_userId: string, sql: string) => {
      statements.push(sql);
      const result = answer(sql);
      if (result instanceof Error) throw result;
      return { columns: result.columns ?? [], rows: result.rows, rowCount: result.rows.length, truncated: false, elapsedMs: 1 };
    }),
  };
  const query = createQueryFacade(queries as never, 'u1', { source: 'panel', dialect: GREPTIME_SQL_DIALECT });
  return { ctx: { id: 'signups', window: WINDOW, filters, query, timeseries: jest.fn(), signal: new AbortController().signal }, statements, queries };
}

const TAGS = ['app_instance_id', 'outcome', 'provider', 'service_name'];
const answerTags: Answer = (sql) =>
  sql.includes('information_schema.columns') ? { rows: TAGS.map((name) => [name]) } : { rows: [['2026-01-01 00:10:00.000000', '3'], ['2026-01-01 00:11:00.000000', '0'], ['2026-01-01 00:12:00.000000', '4']] };

describe('the reference app panel "signups"', () => {
  it('is registered by the app seam, after the platform panels, and is not a platform panel', () => {
    expect(dashboardPanelRegistry.ids()).toEqual(['api', 'logs', 'signups']);
    expect(dashboardPanelRegistry.get('signups')).toBe(SIGNUPS_DASHBOARD_PANEL);
    expect(SIGNUPS_DASHBOARD_PANEL).toMatchObject({ id: 'signups', label: 'Sign-ups', order: 100 });
  });

  it('computes the increase per bucket from the counter, as the platform does: per series, reset-aware', async () => {
    const { ctx, statements } = ctxWith(answerTags);
    const payload = (await SIGNUPS_DASHBOARD_PANEL.data(ctx as never)) as SignupsPayload;

    expect(payload).toMatchObject({ available: true, total: 7, bucketSeconds: 60 });
    // A bucket with no sign-in is left out; the others are ISO instants.
    expect(payload.buckets).toEqual([
      { t: '2026-01-01T00:10:00.000Z', signIns: 3 },
      { t: '2026-01-01T00:12:00.000Z', signIns: 4 },
    ]);
    expect(statements).toHaveLength(2);
    const sql = statements[1]!;
    expect(sql).toContain('FROM "app_auth_logins_total"');
    expect(sql).toContain('PARTITION BY "app_instance_id", "outcome", "provider", "service_name"');
    expect(sql).toContain('CASE WHEN p IS NULL THEN 0 WHEN v >= p THEN v - p ELSE v END');
    expect(sql).toContain(`"outcome" = 'success'`);
    expect(sql).toContain(`'${WINDOW.from.toISOString()}'`);
    expect(payload.sql).toBe(sql);
  });

  it('every statement it sends is one read-only statement the explorer\'s guard admits', async () => {
    const { ctx, statements } = ctxWith(answerTags, { service: 'my-api', instance: 'inst-1' });
    await SIGNUPS_DASHBOARD_PANEL.data(ctx as never);

    expect(statements.length).toBeGreaterThan(0);
    for (const statement of statements) expect(() => analyzeStatement(statement)).not.toThrow();
  });

  it('applies the dashboard\'s filters, quoted: a hostile value cannot end its literal', async () => {
    const hostile = "x' OR '1'='1'; DROP TABLE app_auth_logins_total; --";
    const { ctx, statements } = ctxWith(answerTags, { service: hostile });
    await SIGNUPS_DASHBOARD_PANEL.data(ctx as never);

    const sql = statements[1]!;
    expect(sql).toContain(`"service_name" = 'x'' OR ''1''=''1''; DROP TABLE app_auth_logins_total; --'`);
    // The whole text is still ONE statement as far as the guard can tell.
    expect(() => analyzeStatement(sql)).not.toThrow();
  });

  it('ignores a filter on a column the table does not have', async () => {
    const { ctx, statements } = ctxWith(
      (sql) => (sql.includes('information_schema') ? { rows: [['outcome'], ['provider']] } : { rows: [] }),
      { service: 'my-api' },
    );
    await SIGNUPS_DASHBOARD_PANEL.data(ctx as never);

    expect(statements[1]).not.toContain('service_name');
  });

  it('answers "no data yet" on a fresh stack: the table does not exist (no tag columns)', async () => {
    const { ctx, statements } = ctxWith((sql) => (sql.includes('information_schema') ? { rows: [] } : { rows: [] }));
    const payload = (await SIGNUPS_DASHBOARD_PANEL.data(ctx as never)) as SignupsPayload;

    expect(payload).toEqual({ available: false, total: 0, buckets: [], bucketSeconds: 60 });
    expect(statements).toHaveLength(1);
  });

  it('answers "no data yet" when the store refuses the schema read as a failed query', async () => {
    const { ctx } = ctxWith(() => new TelemetryHttpError(TELEMETRY_ERROR_REASONS.QUERY_FAILED, 'no such table'));
    expect(((await SIGNUPS_DASHBOARD_PANEL.data(ctx as never)) as SignupsPayload).available).toBe(false);
  });

  it.each([TELEMETRY_ERROR_REASONS.DISABLED, TELEMETRY_ERROR_REASONS.UNREACHABLE, TELEMETRY_ERROR_REASONS.NOT_CONFIGURED])(
    'lets a store that is off or unreachable (%s) say so, instead of "no data yet"',
    async (reason) => {
      const refusal = new TelemetryHttpError(reason, 'store is off');
      const { ctx } = ctxWith(() => refusal);
      await expect(SIGNUPS_DASHBOARD_PANEL.data(ctx as never)).rejects.toBe(refusal);
    },
  );

  it('can be registered into an isolated registry and refuses its own id twice', async () => {
    await withTemporaryEntries(dashboardPanelRegistry, [], () => {
      expect(() => registerDashboardPanel({ ...SIGNUPS_DASHBOARD_PANEL, id: 'signups-copy' })).not.toThrow();
      expect(() => registerDashboardPanel(SIGNUPS_DASHBOARD_PANEL)).toThrow(/Duplicate dashboard panel id "signups"/);
    });
  });
});
